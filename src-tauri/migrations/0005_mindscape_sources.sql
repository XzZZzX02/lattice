CREATE TABLE mind_node_sources (
  id TEXT PRIMARY KEY NOT NULL,
  mind_node_id TEXT NOT NULL REFERENCES mind_nodes(id) ON DELETE CASCADE,
  card_id TEXT REFERENCES cards(id) ON DELETE SET NULL,
  turn_id TEXT REFERENCES turns(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL,
  CHECK(card_id IS NOT NULL OR turn_id IS NOT NULL)
);

CREATE INDEX idx_mind_node_sources_node ON mind_node_sources(mind_node_id);

INSERT INTO mind_node_sources(id,mind_node_id,card_id,turn_id,created_at)
SELECT lower(hex(randomblob(16))),id,source_card_id,source_turn_id,created_at
FROM mind_nodes
WHERE source_card_id IS NOT NULL OR source_turn_id IS NOT NULL;
