CREATE VIRTUAL TABLE document_chunk_search USING fts5(
  chunk_id UNINDEXED,
  document_id UNINDEXED,
  project_id UNINDEXED,
  document_name,
  heading_path,
  content,
  tokenize = 'unicode61'
);

INSERT INTO document_chunk_search(chunk_id,document_id,project_id,document_name,heading_path,content)
SELECT document_chunks.id,documents.id,documents.project_id,documents.name,
       document_chunks.heading_path,document_chunks.content
FROM document_chunks
JOIN documents ON documents.id=document_chunks.document_id;

CREATE TRIGGER document_chunks_search_insert AFTER INSERT ON document_chunks BEGIN
  INSERT INTO document_chunk_search
  SELECT new.id,documents.id,documents.project_id,documents.name,new.heading_path,new.content
  FROM documents WHERE documents.id=new.document_id;
END;

CREATE TRIGGER document_chunks_search_update AFTER UPDATE ON document_chunks BEGIN
  DELETE FROM document_chunk_search WHERE chunk_id=old.id;
  INSERT INTO document_chunk_search
  SELECT new.id,documents.id,documents.project_id,documents.name,new.heading_path,new.content
  FROM documents WHERE documents.id=new.document_id;
END;

CREATE TRIGGER document_chunks_search_delete AFTER DELETE ON document_chunks BEGIN
  DELETE FROM document_chunk_search WHERE chunk_id=old.id;
END;

CREATE TABLE document_citations (
  id TEXT PRIMARY KEY NOT NULL,
  turn_id TEXT NOT NULL REFERENCES turns(id) ON DELETE CASCADE,
  chunk_id TEXT REFERENCES document_chunks(id) ON DELETE SET NULL,
  document_id TEXT NOT NULL,
  document_name TEXT NOT NULL,
  page_number INTEGER,
  heading_path TEXT NOT NULL DEFAULT '[]',
  excerpt TEXT NOT NULL,
  start_offset INTEGER NOT NULL,
  end_offset INTEGER NOT NULL,
  created_at TEXT NOT NULL
);

CREATE INDEX idx_document_citations_turn ON document_citations(turn_id, created_at);
