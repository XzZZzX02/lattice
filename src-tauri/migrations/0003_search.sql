CREATE VIRTUAL TABLE search_index USING fts5(
  entity_type UNINDEXED,
  entity_id UNINDEXED,
  project_id UNINDEXED,
  title,
  content,
  tokenize = 'unicode61'
);

INSERT INTO search_index(entity_type,entity_id,project_id,title,content)
SELECT 'project',id,id,title,description FROM projects;
INSERT INTO search_index(entity_type,entity_id,project_id,title,content)
SELECT 'card',id,project_id,title,summary FROM cards;
INSERT INTO search_index(entity_type,entity_id,project_id,title,content)
SELECT 'turn',turns.id,cards.project_id,turns.user_content,turns.assistant_content
FROM turns JOIN cards ON cards.id = turns.card_id;

CREATE TRIGGER projects_search_insert AFTER INSERT ON projects BEGIN
  INSERT INTO search_index VALUES('project',new.id,new.id,new.title,new.description);
END;
CREATE TRIGGER projects_search_update AFTER UPDATE ON projects BEGIN
  DELETE FROM search_index WHERE entity_type='project' AND entity_id=old.id;
  INSERT INTO search_index VALUES('project',new.id,new.id,new.title,new.description);
END;
CREATE TRIGGER projects_search_delete AFTER DELETE ON projects BEGIN
  DELETE FROM search_index WHERE entity_type='project' AND entity_id=old.id;
END;

CREATE TRIGGER cards_search_insert AFTER INSERT ON cards BEGIN
  INSERT INTO search_index VALUES('card',new.id,new.project_id,new.title,new.summary);
END;
CREATE TRIGGER cards_search_update AFTER UPDATE ON cards BEGIN
  DELETE FROM search_index WHERE entity_type='card' AND entity_id=old.id;
  INSERT INTO search_index VALUES('card',new.id,new.project_id,new.title,new.summary);
END;
CREATE TRIGGER cards_search_delete AFTER DELETE ON cards BEGIN
  DELETE FROM search_index WHERE entity_type='card' AND entity_id=old.id;
END;

CREATE TRIGGER turns_search_insert AFTER INSERT ON turns BEGIN
  INSERT INTO search_index
  SELECT 'turn',new.id,cards.project_id,new.user_content,new.assistant_content
  FROM cards WHERE cards.id = new.card_id;
END;
CREATE TRIGGER turns_search_update AFTER UPDATE ON turns BEGIN
  DELETE FROM search_index WHERE entity_type='turn' AND entity_id=old.id;
  INSERT INTO search_index
  SELECT 'turn',new.id,cards.project_id,new.user_content,new.assistant_content
  FROM cards WHERE cards.id = new.card_id;
END;
CREATE TRIGGER turns_search_delete AFTER DELETE ON turns BEGIN
  DELETE FROM search_index WHERE entity_type='turn' AND entity_id=old.id;
END;
