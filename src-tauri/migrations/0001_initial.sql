PRAGMA foreign_keys = ON;

CREATE TABLE folders (
  id TEXT PRIMARY KEY NOT NULL,
  name TEXT NOT NULL CHECK(length(name) BETWEEN 1 AND 120),
  position INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE projects (
  id TEXT PRIMARY KEY NOT NULL,
  folder_id TEXT REFERENCES folders(id) ON DELETE SET NULL,
  title TEXT NOT NULL CHECK(length(title) BETWEEN 1 AND 200),
  description TEXT NOT NULL DEFAULT '',
  system_prompt TEXT NOT NULL DEFAULT '',
  default_model_profile_id TEXT,
  root_card_id TEXT,
  archived INTEGER NOT NULL DEFAULT 0 CHECK(archived IN (0, 1)),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE cards (
  id TEXT PRIMARY KEY NOT NULL,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  parent_id TEXT REFERENCES cards(id) ON DELETE CASCADE,
  relation TEXT NOT NULL CHECK(relation IN ('root', 'child', 'divergent', 'branch')),
  branch_from_turn_id TEXT,
  title TEXT NOT NULL CHECK(length(title) BETWEEN 1 AND 240),
  summary TEXT NOT NULL DEFAULT '',
  context_snapshot_hash TEXT NOT NULL DEFAULT '',
  context_stale INTEGER NOT NULL DEFAULT 0 CHECK(context_stale IN (0, 1)),
  unread INTEGER NOT NULL DEFAULT 0 CHECK(unread IN (0, 1)),
  position_x REAL NOT NULL DEFAULT 0,
  position_y REAL NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX idx_cards_project ON cards(project_id);
CREATE INDEX idx_cards_parent ON cards(parent_id);

CREATE TABLE turns (
  id TEXT PRIMARY KEY NOT NULL,
  card_id TEXT NOT NULL REFERENCES cards(id) ON DELETE CASCADE,
  user_content TEXT NOT NULL,
  assistant_content TEXT NOT NULL DEFAULT '',
  model_profile_id TEXT,
  status TEXT NOT NULL CHECK(status IN ('idle','streaming','completed','cancelled','failed','interrupted')),
  error_message TEXT,
  request_id TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX idx_turns_card ON turns(card_id, created_at);

CREATE TABLE quotes (
  id TEXT PRIMARY KEY NOT NULL,
  turn_id TEXT NOT NULL REFERENCES turns(id) ON DELETE CASCADE,
  target_turn_id TEXT REFERENCES turns(id) ON DELETE CASCADE,
  selected_text TEXT NOT NULL CHECK(length(selected_text) > 0),
  start_offset INTEGER NOT NULL,
  end_offset INTEGER NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE favorites (
  id TEXT PRIMARY KEY NOT NULL,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  card_id TEXT REFERENCES cards(id) ON DELETE CASCADE,
  turn_id TEXT REFERENCES turns(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL,
  CHECK(card_id IS NOT NULL OR turn_id IS NOT NULL)
);

CREATE TABLE model_profiles (
  id TEXT PRIMARY KEY NOT NULL,
  name TEXT NOT NULL CHECK(length(name) BETWEEN 1 AND 120),
  provider TEXT NOT NULL CHECK(provider IN ('ollama', 'openai_compatible')),
  base_url TEXT NOT NULL,
  model TEXT NOT NULL,
  keychain_ref TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE documents (
  id TEXT PRIMARY KEY NOT NULL,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  mime_type TEXT NOT NULL,
  local_path TEXT NOT NULL,
  content_hash TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'ready',
  created_at TEXT NOT NULL,
  UNIQUE(project_id, content_hash)
);

CREATE TABLE document_chunks (
  id TEXT PRIMARY KEY NOT NULL,
  document_id TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  content TEXT NOT NULL,
  page_number INTEGER,
  heading_path TEXT NOT NULL DEFAULT '',
  start_offset INTEGER NOT NULL,
  end_offset INTEGER NOT NULL
);

CREATE INDEX idx_chunks_document ON document_chunks(document_id);

CREATE TABLE mind_nodes (
  id TEXT PRIMARY KEY NOT NULL,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  label TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  source_card_id TEXT REFERENCES cards(id) ON DELETE SET NULL,
  source_turn_id TEXT REFERENCES turns(id) ON DELETE SET NULL,
  position_x REAL NOT NULL DEFAULT 0,
  position_y REAL NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);

CREATE TABLE mind_edges (
  id TEXT PRIMARY KEY NOT NULL,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  source_id TEXT NOT NULL REFERENCES mind_nodes(id) ON DELETE CASCADE,
  target_id TEXT NOT NULL REFERENCES mind_nodes(id) ON DELETE CASCADE,
  relation TEXT NOT NULL,
  created_at TEXT NOT NULL,
  CHECK(source_id <> target_id)
);
