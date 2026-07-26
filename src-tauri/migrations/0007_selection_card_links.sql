CREATE TABLE selection_card_links (
  id TEXT PRIMARY KEY NOT NULL,
  source_turn_id TEXT NOT NULL REFERENCES turns(id) ON DELETE CASCADE,
  target_card_id TEXT NOT NULL REFERENCES cards(id) ON DELETE CASCADE,
  selected_text TEXT NOT NULL CHECK(length(selected_text) BETWEEN 1 AND 8000),
  start_offset INTEGER NOT NULL CHECK(start_offset >= 0),
  end_offset INTEGER NOT NULL CHECK(end_offset > start_offset),
  created_at TEXT NOT NULL,
  UNIQUE(source_turn_id, start_offset, end_offset)
);

CREATE INDEX idx_selection_card_links_source
  ON selection_card_links(source_turn_id);

CREATE INDEX idx_selection_card_links_target
  ON selection_card_links(target_card_id);
