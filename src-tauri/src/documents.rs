use std::path::{Path, PathBuf};

use sha2::{Digest, Sha256};
use uuid::Uuid;

use crate::{
    db::Database,
    models::{Document, DocumentImportResult},
};

const MAX_DOCUMENT_BYTES: u64 = 100 * 1024 * 1024;
const MAX_CHUNK_CHARS: usize = 3_200;
const CHUNK_OVERLAP_CHARS: usize = 400;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ChunkDraft {
    pub content: String,
    pub page_number: Option<i64>,
    pub heading_path: Vec<String>,
    pub start_offset: i64,
    pub end_offset: i64,
}

#[derive(Clone)]
pub struct DocumentStore {
    root: PathBuf,
}

impl DocumentStore {
    pub fn new(root: PathBuf) -> Result<Self, String> {
        std::fs::create_dir_all(&root)
            .map_err(|_| "Unable to create the local document directory".to_owned())?;
        Ok(Self { root })
    }

    pub async fn ingest(
        &self,
        database: &Database,
        project_id: &str,
        source_path: &Path,
    ) -> Result<DocumentImportResult, String> {
        database
            .get_workspace(project_id)
            .await
            .map_err(|_| "Project not found".to_owned())?;
        let source = source_path.to_path_buf();
        let validated = tauri::async_runtime::spawn_blocking(move || validate_source(&source))
            .await
            .map_err(|_| "Document import was interrupted".to_owned())??;
        if let Some(document) = database
            .find_document_by_hash(project_id, &validated.content_hash)
            .await
            .map_err(|_| "Unable to inspect existing documents".to_owned())?
        {
            return Ok(DocumentImportResult {
                document,
                duplicate: true,
            });
        }

        let id = Uuid::now_v7().to_string();
        let destination = self.root.join(format!("{id}.{}", validated.extension));
        let temporary = self.root.join(format!(".{id}.importing"));
        let bytes = validated.bytes;
        let temporary_for_write = temporary.clone();
        let destination_for_write = destination.clone();
        tauri::async_runtime::spawn_blocking(move || {
            std::fs::write(&temporary_for_write, bytes)
                .and_then(|_| std::fs::rename(&temporary_for_write, &destination_for_write))
        })
        .await
        .map_err(|_| "Document copy was interrupted".to_owned())?
        .map_err(|_| "Unable to copy document into local storage".to_owned())?;

        match database
            .insert_document(
                &id,
                project_id,
                &validated.name,
                &validated.mime_type,
                &destination.to_string_lossy(),
                &validated.content_hash,
            )
            .await
        {
            Ok(document) => match process_document(database, &document).await {
                Ok(document) => Ok(DocumentImportResult {
                    document,
                    duplicate: false,
                }),
                Err(message) => {
                    let _ = database
                        .set_document_status(project_id, &document.id, "failed")
                        .await;
                    Err(message)
                }
            },
            Err(_) => {
                let _ = std::fs::remove_file(&destination);
                if let Some(document) = database
                    .find_document_by_hash(project_id, &validated.content_hash)
                    .await
                    .map_err(|_| "Unable to recover duplicate document".to_owned())?
                {
                    Ok(DocumentImportResult {
                        document,
                        duplicate: true,
                    })
                } else {
                    Err("Unable to register local document".to_owned())
                }
            }
        }
    }

    pub async fn delete(
        &self,
        database: &Database,
        project_id: &str,
        document_id: &str,
    ) -> Result<(), String> {
        let document = database
            .get_document(project_id, document_id)
            .await
            .map_err(|_| "Document not found".to_owned())?;
        let path = PathBuf::from(&document.local_path);
        if path.parent() != Some(self.root.as_path()) {
            return Err("Document path is outside local storage".to_owned());
        }
        let staged = self.root.join(format!(".{document_id}.deleting"));
        let existed = path.exists();
        if existed {
            std::fs::rename(&path, &staged)
                .map_err(|_| "Unable to stage document deletion".to_owned())?;
        }
        if database
            .delete_document(project_id, document_id)
            .await
            .is_err()
        {
            if existed {
                let _ = std::fs::rename(&staged, &path);
            }
            return Err("Unable to delete document".to_owned());
        }
        if existed {
            let _ = std::fs::remove_file(staged);
        }
        Ok(())
    }
}

async fn process_document(database: &Database, document: &Document) -> Result<Document, String> {
    let path = PathBuf::from(&document.local_path);
    let mime_type = document.mime_type.clone();
    let pages = tauri::async_runtime::spawn_blocking(move || extract_pages(&path, &mime_type))
        .await
        .map_err(|_| "Document processing was interrupted".to_owned())??;
    let chunks = structured_chunks(pages, document.mime_type == "text/markdown");
    if chunks.is_empty() {
        return Err("Document did not produce any searchable text".to_owned());
    }
    database
        .replace_document_chunks(document, &chunks)
        .await
        .map_err(|_| "Unable to store document chunks".to_owned())
}

fn extract_pages(path: &Path, mime_type: &str) -> Result<Vec<(Option<i64>, String)>, String> {
    if mime_type == "application/pdf" {
        return pdf_extract::extract_text_by_pages(path)
            .map_err(|_| "Unable to extract PDF pages".to_owned())
            .map(|pages| {
                pages
                    .into_iter()
                    .enumerate()
                    .map(|(index, page)| (Some(index as i64 + 1), page))
                    .collect()
            });
    }
    let text =
        std::fs::read_to_string(path).map_err(|_| "Unable to read text document".to_owned())?;
    Ok(vec![(None, text)])
}

fn structured_chunks(pages: Vec<(Option<i64>, String)>, markdown: bool) -> Vec<ChunkDraft> {
    let mut chunks = Vec::new();
    for (page_number, text) in pages {
        let mut heading_path = Vec::<String>::new();
        let mut paragraph = String::new();
        let mut paragraph_start = 0usize;
        let mut offset = 0usize;
        for line in text.split_inclusive('\n') {
            let line_length = line.chars().count();
            let trimmed = line.trim();
            if markdown {
                if let Some((depth, heading)) = markdown_heading(trimmed) {
                    flush_paragraph(
                        &mut chunks,
                        &mut paragraph,
                        page_number,
                        &heading_path,
                        paragraph_start,
                        offset,
                    );
                    heading_path.truncate(depth.saturating_sub(1));
                    heading_path.push(heading.to_owned());
                    offset += line_length;
                    continue;
                }
            }
            if trimmed.is_empty() {
                flush_paragraph(
                    &mut chunks,
                    &mut paragraph,
                    page_number,
                    &heading_path,
                    paragraph_start,
                    offset,
                );
            } else {
                if paragraph.is_empty() {
                    paragraph_start = offset;
                }
                paragraph.push_str(line);
            }
            offset += line_length;
        }
        flush_paragraph(
            &mut chunks,
            &mut paragraph,
            page_number,
            &heading_path,
            paragraph_start,
            text.chars().count(),
        );
    }
    chunks
}

fn markdown_heading(line: &str) -> Option<(usize, &str)> {
    let depth = line
        .chars()
        .take_while(|character| *character == '#')
        .count();
    if !(1..=6).contains(&depth) {
        return None;
    }
    line.get(depth..)
        .map(str::trim)
        .filter(|heading| !heading.is_empty())
        .map(|heading| (depth, heading))
}

fn flush_paragraph(
    chunks: &mut Vec<ChunkDraft>,
    paragraph: &mut String,
    page_number: Option<i64>,
    heading_path: &[String],
    start_offset: usize,
    end_offset: usize,
) {
    if paragraph.trim().is_empty() {
        paragraph.clear();
        return;
    }
    let characters = paragraph.chars().collect::<Vec<_>>();
    let mut start = 0usize;
    while start < characters.len() {
        let end = (start + MAX_CHUNK_CHARS).min(characters.len());
        chunks.push(ChunkDraft {
            content: characters[start..end].iter().collect(),
            page_number,
            heading_path: heading_path.to_vec(),
            start_offset: (start_offset + start) as i64,
            end_offset: if end == characters.len() {
                (start_offset + characters.len()).min(end_offset) as i64
            } else {
                (start_offset + end) as i64
            },
        });
        if end == characters.len() {
            break;
        }
        start = end.saturating_sub(CHUNK_OVERLAP_CHARS);
    }
    paragraph.clear();
}

struct ValidatedSource {
    bytes: Vec<u8>,
    name: String,
    extension: String,
    mime_type: String,
    content_hash: String,
}

fn validate_source(path: &Path) -> Result<ValidatedSource, String> {
    if !path.is_absolute() {
        return Err("Document path must be absolute".to_owned());
    }
    let metadata = std::fs::metadata(path).map_err(|_| "Unable to inspect document".to_owned())?;
    if !metadata.is_file() || metadata.len() == 0 || metadata.len() > MAX_DOCUMENT_BYTES {
        return Err("Document must be a non-empty file smaller than 100 MB".to_owned());
    }
    let extension = path
        .extension()
        .and_then(|value| value.to_str())
        .map(str::to_ascii_lowercase)
        .ok_or_else(|| "Document type is not supported".to_owned())?;
    let mime_type = match extension.as_str() {
        "pdf" => "application/pdf",
        "md" => "text/markdown",
        "txt" => "text/plain",
        _ => return Err("Only PDF, Markdown and TXT documents are supported".to_owned()),
    }
    .to_owned();
    let name = path
        .file_name()
        .and_then(|value| value.to_str())
        .filter(|value| !value.trim().is_empty() && value.chars().count() <= 240)
        .ok_or_else(|| "Document filename is invalid".to_owned())?
        .to_owned();
    let bytes = std::fs::read(path).map_err(|_| "Unable to read document".to_owned())?;
    match extension.as_str() {
        "pdf" => {
            let text = pdf_extract::extract_text_from_mem(&bytes)
                .map_err(|_| "PDF is damaged, encrypted, or unsupported".to_owned())?;
            if text.trim().is_empty() {
                return Err("PDF does not contain an extractable text layer".to_owned());
            }
        }
        _ => {
            std::str::from_utf8(&bytes)
                .map_err(|_| "Text document must use UTF-8 encoding".to_owned())?;
        }
    }
    let content_hash = format!("{:x}", Sha256::digest(&bytes));
    Ok(ValidatedSource {
        bytes,
        name,
        extension,
        mime_type,
        content_hash,
    })
}

#[cfg(test)]
mod tests {
    use super::DocumentStore;
    use crate::db::Database;
    use lopdf::{
        content::{Content, Operation},
        dictionary, Document as PdfDocument, Object, Stream,
    };

    #[tokio::test]
    async fn imports_deduplicates_and_deletes_utf8_documents() {
        let database = Database::in_memory().await.expect("database");
        let workspace = database.create_project("Documents").await.expect("project");
        let directory = tempfile::tempdir().expect("directory");
        let source = directory.path().join("notes.md");
        std::fs::write(&source, "# Heading\n\nLocal knowledge.").expect("write source");
        let store = DocumentStore::new(directory.path().join("managed")).expect("document store");

        let imported = store
            .ingest(&database, &workspace.project.id, &source)
            .await
            .expect("import");
        assert!(!imported.duplicate);
        assert!(Path::new(&imported.document.local_path).exists());
        let chunks = database
            .list_document_chunks(&workspace.project.id, &imported.document.id)
            .await
            .expect("chunks");
        assert_eq!(chunks.len(), 1);
        assert_eq!(
            serde_json::from_str::<Vec<String>>(&chunks[0].heading_path).expect("heading path"),
            vec!["Heading"]
        );
        assert_eq!(chunks[0].content, "Local knowledge.");
        assert_eq!(chunks[0].start_offset, 11);
        assert_eq!(chunks[0].end_offset, 27);

        let duplicate = store
            .ingest(&database, &workspace.project.id, &source)
            .await
            .expect("duplicate");
        assert!(duplicate.duplicate);
        assert_eq!(duplicate.document.id, imported.document.id);

        store
            .delete(&database, &workspace.project.id, &imported.document.id)
            .await
            .expect("delete");
        assert!(!Path::new(&imported.document.local_path).exists());
        assert!(database
            .list_documents(&workspace.project.id)
            .await
            .expect("documents")
            .is_empty());
    }

    #[tokio::test]
    async fn rejects_invalid_files_and_cross_project_deletion() {
        let database = Database::in_memory().await.expect("database");
        let first = database.create_project("First").await.expect("first");
        let second = database.create_project("Second").await.expect("second");
        let directory = tempfile::tempdir().expect("directory");
        let invalid = directory.path().join("binary.txt");
        std::fs::write(&invalid, [0xff, 0xfe]).expect("write invalid");
        let source = directory.path().join("notes.txt");
        std::fs::write(&source, "valid").expect("write valid");
        let store = DocumentStore::new(directory.path().join("managed")).expect("document store");

        assert!(store
            .ingest(&database, &first.project.id, &invalid)
            .await
            .is_err());
        let imported = store
            .ingest(&database, &first.project.id, &source)
            .await
            .expect("import");
        assert!(store
            .delete(&database, &second.project.id, &imported.document.id)
            .await
            .is_err());
    }

    #[tokio::test]
    async fn accepts_a_pdf_with_an_extractable_text_layer() {
        let database = Database::in_memory().await.expect("database");
        let workspace = database.create_project("PDF").await.expect("project");
        let directory = tempfile::tempdir().expect("directory");
        let source = directory.path().join("paper.pdf");
        write_text_pdf(&source);
        let store = DocumentStore::new(directory.path().join("managed")).expect("document store");

        let imported = store
            .ingest(&database, &workspace.project.id, &source)
            .await
            .expect("PDF import");
        assert_eq!(imported.document.mime_type, "application/pdf");
        let chunks = database
            .list_document_chunks(&workspace.project.id, &imported.document.id)
            .await
            .expect("PDF chunks");
        assert_eq!(chunks[0].page_number, Some(1));
    }

    fn write_text_pdf(path: &Path) {
        let mut document = PdfDocument::with_version("1.5");
        let pages_id = document.new_object_id();
        let font_id = document.add_object(dictionary! {
            "Type" => "Font",
            "Subtype" => "Type1",
            "BaseFont" => "Courier",
        });
        let resources_id = document.add_object(dictionary! {
            "Font" => dictionary! { "F1" => font_id },
        });
        let content = Content {
            operations: vec![
                Operation::new("BT", vec![]),
                Operation::new("Tf", vec!["F1".into(), 12.into()]),
                Operation::new("Td", vec![72.into(), 720.into()]),
                Operation::new("Tj", vec![Object::string_literal("Hello PDF")]),
                Operation::new("ET", vec![]),
            ],
        }
        .encode()
        .expect("encode content");
        let content_id = document.add_object(Stream::new(dictionary! {}, content));
        let page_id = document.add_object(dictionary! {
            "Type" => "Page",
            "Parent" => pages_id,
            "Contents" => content_id,
            "Resources" => resources_id,
            "MediaBox" => vec![0.into(), 0.into(), 612.into(), 792.into()],
        });
        document.objects.insert(
            pages_id,
            Object::Dictionary(dictionary! {
                "Type" => "Pages",
                "Kids" => vec![page_id.into()],
                "Count" => 1,
            }),
        );
        let catalog_id = document.add_object(dictionary! {
            "Type" => "Catalog",
            "Pages" => pages_id,
        });
        document.trailer.set("Root", catalog_id);
        document.compress();
        document.save(path).expect("save PDF");
    }

    #[test]
    fn long_paragraphs_overlap_and_preserve_source_ranges() {
        let content = "a".repeat(4_000);
        let chunks = super::structured_chunks(vec![(None, content)], false);
        assert_eq!(chunks.len(), 2);
        assert_eq!(chunks[0].start_offset, 0);
        assert_eq!(chunks[0].end_offset, 3_200);
        assert_eq!(chunks[1].start_offset, 2_800);
        assert_eq!(chunks[1].end_offset, 4_000);
    }

    use std::path::Path;
}
