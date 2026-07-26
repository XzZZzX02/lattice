ALTER TABLE mind_node_sources RENAME TO mind_node_sources_legacy;
DROP INDEX idx_mind_node_sources_node;

CREATE TABLE mind_node_sources (
  id TEXT PRIMARY KEY NOT NULL,
  mind_node_id TEXT NOT NULL REFERENCES mind_nodes(id) ON DELETE CASCADE,
  card_id TEXT REFERENCES cards(id) ON DELETE CASCADE,
  turn_id TEXT REFERENCES turns(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL,
  CHECK(card_id IS NOT NULL OR turn_id IS NOT NULL)
);

CREATE INDEX idx_mind_node_sources_node ON mind_node_sources(mind_node_id);

INSERT INTO mind_node_sources(id,mind_node_id,card_id,turn_id,created_at)
SELECT id,mind_node_id,card_id,turn_id,created_at
FROM mind_node_sources_legacy
WHERE card_id IS NOT NULL OR turn_id IS NOT NULL;

DROP TABLE mind_node_sources_legacy;
