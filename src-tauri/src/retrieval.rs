use crate::{db::Database, models::RetrievedDocumentChunk};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum RetrievalBackend {
    FullText,
}

pub async fn retrieve(
    database: &Database,
    project_id: &str,
    query: &str,
    limit: i64,
    backend: RetrievalBackend,
) -> Result<Vec<RetrievedDocumentChunk>, String> {
    match backend {
        RetrievalBackend::FullText => database
            .retrieve_document_chunks(project_id, query, limit)
            .await
            .map_err(|_| "Unable to search project documents".to_owned()),
    }
}

pub fn context_block(chunks: &[RetrievedDocumentChunk]) -> Option<String> {
    if chunks.is_empty() {
        return None;
    }
    let sources = chunks
        .iter()
        .enumerate()
        .map(|(index, chunk)| {
            let page = chunk
                .page_number
                .map(|page| format!(", page {page}"))
                .unwrap_or_default();
            format!(
                "[Source {}: {}{}]\n{}",
                index + 1,
                chunk.document_name,
                page,
                chunk.content
            )
        })
        .collect::<Vec<_>>()
        .join("\n\n");
    Some(format!(
        "Use the following local sources when relevant. Cite them as [Source N]. \
         Do not claim a source supports anything outside its excerpt.\n\n{sources}"
    ))
}

#[cfg(test)]
mod tests {
    use super::context_block;
    use crate::models::RetrievedDocumentChunk;

    #[test]
    fn renders_traceable_source_labels() {
        let block = context_block(&[RetrievedDocumentChunk {
            chunk_id: "c1".to_owned(),
            document_id: "d1".to_owned(),
            document_name: "paper.pdf".to_owned(),
            content: "Evidence".to_owned(),
            page_number: Some(4),
            heading_path: "[]".to_owned(),
            start_offset: 2,
            end_offset: 10,
            score: -1.0,
        }])
        .expect("context");
        assert!(block.contains("[Source 1: paper.pdf, page 4]"));
        assert!(block.contains("Evidence"));
    }
}
