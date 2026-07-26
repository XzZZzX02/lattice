CREATE TABLE turn_revisions (
  id TEXT PRIMARY KEY NOT NULL,
  turn_id TEXT NOT NULL,
  revision_kind TEXT NOT NULL CHECK(revision_kind IN ('edit', 'delete')),
  user_content TEXT NOT NULL,
  assistant_content TEXT NOT NULL,
  status TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE INDEX idx_turn_revisions_turn ON turn_revisions(turn_id, created_at);
