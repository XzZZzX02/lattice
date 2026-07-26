use std::path::Path;

use chrono::Utc;
use sqlx::{sqlite::SqliteConnectOptions, SqlitePool};
use uuid::Uuid;

use crate::models::{
    Card, CardDeletionResult, CreateCardInput, CreateMindEdgeInput, CreateMindNodeInput,
    CreateQuoteInput, CreateSelectionCardInput, Document, DocumentChunk, DocumentCitation,
    MindEdge, MindNode, MindscapeGraph, ModelProfile, Project, ProjectWorkspace, Quote,
    RetrievedDocumentChunk, SaveModelProfileInput, SearchResult, SelectionCardCreation,
    SelectionCardLink, Turn,
};

#[derive(Clone)]
pub struct Database {
    pool: SqlitePool,
}

impl Database {
    pub async fn open(path: &Path) -> Result<Self, sqlx::Error> {
        let options = SqliteConnectOptions::new()
            .filename(path)
            .create_if_missing(true)
            .foreign_keys(true);
        let pool = SqlitePool::connect_with(options).await?;
        sqlx::migrate!("./migrations").run(&pool).await?;
        let database = Self { pool };
        database.recover_interrupted_turns().await?;
        database.recover_interrupted_documents().await?;
        Ok(database)
    }

    pub async fn in_memory() -> Result<Self, sqlx::Error> {
        let pool = SqlitePool::connect("sqlite::memory:").await?;
        sqlx::migrate!("./migrations").run(&pool).await?;
        Ok(Self { pool })
    }

    pub async fn create_project(&self, title: &str) -> Result<ProjectWorkspace, sqlx::Error> {
        let now = Utc::now().to_rfc3339();
        let project_id = Uuid::now_v7().to_string();
        let card_id = Uuid::now_v7().to_string();
        let mut tx = self.pool.begin().await?;
        sqlx::query(
            "INSERT INTO projects (id,title,root_card_id,created_at,updated_at) VALUES (?,?,?,?,?)",
        )
        .bind(&project_id)
        .bind(title)
        .bind(&card_id)
        .bind(&now)
        .bind(&now)
        .execute(&mut *tx)
        .await?;
        sqlx::query(
            "INSERT INTO cards (id,project_id,relation,title,created_at,updated_at) VALUES (?,?,'root',?,?,?)",
        )
        .bind(&card_id)
        .bind(&project_id)
        .bind(title)
        .bind(&now)
        .bind(&now)
        .execute(&mut *tx)
        .await?;
        tx.commit().await?;
        self.get_workspace(&project_id).await
    }

    pub async fn list_projects(&self, include_archived: bool) -> Result<Vec<Project>, sqlx::Error> {
        let query = if include_archived {
            "SELECT * FROM projects ORDER BY updated_at DESC"
        } else {
            "SELECT * FROM projects WHERE archived = 0 ORDER BY updated_at DESC"
        };
        sqlx::query_as(query).fetch_all(&self.pool).await
    }

    pub async fn get_workspace(&self, project_id: &str) -> Result<ProjectWorkspace, sqlx::Error> {
        let project = sqlx::query_as::<_, Project>("SELECT * FROM projects WHERE id = ?")
            .bind(project_id)
            .fetch_one(&self.pool)
            .await?;
        let cards = sqlx::query_as::<_, Card>(
            "SELECT * FROM cards WHERE project_id = ? ORDER BY created_at",
        )
        .bind(project_id)
        .fetch_all(&self.pool)
        .await?;
        let turns = sqlx::query_as::<_, Turn>(
            "SELECT turns.* FROM turns JOIN cards ON cards.id = turns.card_id WHERE cards.project_id = ? ORDER BY turns.created_at",
        )
        .bind(project_id)
        .fetch_all(&self.pool)
        .await?;
        let selection_card_links = sqlx::query_as::<_, SelectionCardLink>(
            "SELECT selection_card_links.*
             FROM selection_card_links
             JOIN turns ON turns.id = selection_card_links.source_turn_id
             JOIN cards ON cards.id = turns.card_id
             WHERE cards.project_id = ?
             ORDER BY selection_card_links.created_at",
        )
        .bind(project_id)
        .fetch_all(&self.pool)
        .await?;
        Ok(ProjectWorkspace {
            project,
            cards,
            turns,
            selection_card_links,
        })
    }

    pub async fn rename_project(&self, id: &str, title: &str) -> Result<(), sqlx::Error> {
        sqlx::query("UPDATE projects SET title = ?, updated_at = ? WHERE id = ?")
            .bind(title)
            .bind(Utc::now().to_rfc3339())
            .bind(id)
            .execute(&self.pool)
            .await?;
        Ok(())
    }

    pub async fn set_project_archived(&self, id: &str, archived: bool) -> Result<(), sqlx::Error> {
        sqlx::query("UPDATE projects SET archived = ?, updated_at = ? WHERE id = ?")
            .bind(archived)
            .bind(Utc::now().to_rfc3339())
            .bind(id)
            .execute(&self.pool)
            .await?;
        Ok(())
    }

    async fn recover_interrupted_turns(&self) -> Result<(), sqlx::Error> {
        sqlx::query(
            "UPDATE turns SET status = 'interrupted', updated_at = ? WHERE status = 'streaming'",
        )
        .bind(Utc::now().to_rfc3339())
        .execute(&self.pool)
        .await?;
        Ok(())
    }

    async fn recover_interrupted_documents(&self) -> Result<(), sqlx::Error> {
        sqlx::query("UPDATE documents SET status='failed' WHERE status='processing'")
            .execute(&self.pool)
            .await?;
        Ok(())
    }

    pub fn pool(&self) -> &SqlitePool {
        &self.pool
    }

    pub async fn list_model_profiles(&self) -> Result<Vec<ModelProfile>, sqlx::Error> {
        sqlx::query_as("SELECT * FROM model_profiles ORDER BY created_at")
            .fetch_all(&self.pool)
            .await
    }

    pub async fn get_model_profile(&self, id: &str) -> Result<ModelProfile, sqlx::Error> {
        sqlx::query_as("SELECT * FROM model_profiles WHERE id = ?")
            .bind(id)
            .fetch_one(&self.pool)
            .await
    }

    pub async fn save_model_profile(
        &self,
        input: &SaveModelProfileInput,
        keychain_ref: Option<&str>,
    ) -> Result<ModelProfile, sqlx::Error> {
        let id = input
            .id
            .clone()
            .unwrap_or_else(|| Uuid::now_v7().to_string());
        let now = Utc::now().to_rfc3339();
        sqlx::query(
            "INSERT INTO model_profiles (id,name,provider,base_url,model,keychain_ref,created_at,updated_at)
             VALUES (?,?,?,?,?,?,?,?)
             ON CONFLICT(id) DO UPDATE SET name=excluded.name, provider=excluded.provider,
             base_url=excluded.base_url, model=excluded.model,
             keychain_ref=COALESCE(excluded.keychain_ref, model_profiles.keychain_ref),
             updated_at=excluded.updated_at",
        )
        .bind(&id)
        .bind(&input.name)
        .bind(&input.provider)
        .bind(input.base_url.trim_end_matches('/'))
        .bind(&input.model)
        .bind(keychain_ref)
        .bind(&now)
        .bind(&now)
        .execute(&self.pool)
        .await?;
        self.get_model_profile(&id).await
    }

    pub async fn create_streaming_turn(
        &self,
        card_id: &str,
        user_content: &str,
        model_profile_id: &str,
        request_id: &str,
    ) -> Result<Turn, sqlx::Error> {
        let id = Uuid::now_v7().to_string();
        let now = Utc::now().to_rfc3339();
        sqlx::query(
            "INSERT INTO turns (id,card_id,user_content,model_profile_id,status,request_id,created_at,updated_at)
             VALUES (?,?,?,?,'streaming',?,?,?)",
        )
        .bind(&id)
        .bind(card_id)
        .bind(user_content)
        .bind(model_profile_id)
        .bind(request_id)
        .bind(&now)
        .bind(&now)
        .execute(&self.pool)
        .await?;
        self.get_turn(&id).await
    }

    pub async fn get_turn(&self, id: &str) -> Result<Turn, sqlx::Error> {
        sqlx::query_as("SELECT * FROM turns WHERE id = ?")
            .bind(id)
            .fetch_one(&self.pool)
            .await
    }

    pub async fn update_turn(
        &self,
        id: &str,
        content: &str,
        status: &str,
        error_message: Option<&str>,
    ) -> Result<Turn, sqlx::Error> {
        sqlx::query(
            "UPDATE turns SET assistant_content = ?, status = ?, error_message = ?, updated_at = ? WHERE id = ?",
        )
        .bind(content)
        .bind(status)
        .bind(error_message)
        .bind(Utc::now().to_rfc3339())
        .bind(id)
        .execute(&self.pool)
        .await?;
        self.get_turn(id).await
    }

    pub async fn turns_for_card(&self, card_id: &str) -> Result<Vec<Turn>, sqlx::Error> {
        sqlx::query_as("SELECT * FROM turns WHERE card_id = ? ORDER BY created_at")
            .bind(card_id)
            .fetch_all(&self.pool)
            .await
    }

    pub async fn create_quote(&self, input: &CreateQuoteInput) -> Result<Quote, sqlx::Error> {
        let source = self.get_turn(&input.turn_id).await?;
        let selected_length = input.selected_text.encode_utf16().count() as i64;
        let source_length = source.assistant_content.encode_utf16().count() as i64;
        if input.start_offset < 0
            || selected_length == 0
            || input.end_offset - input.start_offset != selected_length
            || input.end_offset > source_length
        {
            return Err(sqlx::Error::RowNotFound);
        }
        let id = Uuid::now_v7().to_string();
        let now = Utc::now().to_rfc3339();
        sqlx::query(
            "INSERT INTO quotes (id,turn_id,selected_text,start_offset,end_offset,created_at)
             VALUES (?,?,?,?,?,?)",
        )
        .bind(&id)
        .bind(&input.turn_id)
        .bind(&input.selected_text)
        .bind(input.start_offset)
        .bind(input.end_offset)
        .bind(&now)
        .execute(&self.pool)
        .await?;
        sqlx::query_as("SELECT * FROM quotes WHERE id = ?")
            .bind(id)
            .fetch_one(&self.pool)
            .await
    }

    pub async fn attach_quotes(
        &self,
        quote_ids: &[String],
        target_turn_id: &str,
    ) -> Result<(), sqlx::Error> {
        let mut tx = self.pool.begin().await?;
        let target_project_id: String = sqlx::query_scalar(
            "SELECT cards.project_id FROM turns
             JOIN cards ON cards.id=turns.card_id WHERE turns.id=?",
        )
        .bind(target_turn_id)
        .fetch_one(&mut *tx)
        .await?;
        for quote_id in quote_ids {
            let result = sqlx::query(
                "UPDATE quotes SET target_turn_id = ?
                 WHERE id = ? AND target_turn_id IS NULL
                 AND EXISTS (
                   SELECT 1 FROM turns source_turn
                   JOIN cards source_card ON source_card.id=source_turn.card_id
                   WHERE source_turn.id=quotes.turn_id
                     AND source_card.project_id=?
                 )",
            )
            .bind(target_turn_id)
            .bind(quote_id)
            .bind(&target_project_id)
            .execute(&mut *tx)
            .await?;
            if result.rows_affected() != 1 {
                return Err(sqlx::Error::RowNotFound);
            }
        }
        tx.commit().await?;
        Ok(())
    }

    pub async fn quotes_for_target(&self, target_turn_id: &str) -> Result<Vec<Quote>, sqlx::Error> {
        sqlx::query_as("SELECT * FROM quotes WHERE target_turn_id = ? ORDER BY created_at")
            .bind(target_turn_id)
            .fetch_all(&self.pool)
            .await
    }

    pub async fn create_card(&self, input: &CreateCardInput) -> Result<Card, sqlx::Error> {
        let id = Uuid::now_v7().to_string();
        let now = Utc::now().to_rfc3339();
        let mut tx = self.pool.begin().await?;
        let source: Card = sqlx::query_as("SELECT * FROM cards WHERE id = ? AND project_id = ?")
            .bind(&input.source_card_id)
            .bind(&input.project_id)
            .fetch_one(&mut *tx)
            .await?;
        if let Some(turn_id) = &input.branch_from_turn_id {
            sqlx::query("SELECT id FROM turns WHERE id = ? AND card_id = ?")
                .bind(turn_id)
                .bind(&source.id)
                .fetch_one(&mut *tx)
                .await?;
        }
        sqlx::query(
            "INSERT INTO cards
             (id,project_id,parent_id,relation,branch_from_turn_id,title,unread,position_x,position_y,created_at,updated_at)
             VALUES (?,?,?,?,?,?,1,?,?,?,?)",
        )
        .bind(&id)
        .bind(&input.project_id)
        .bind(&source.id)
        .bind(&input.relation)
        .bind(&input.branch_from_turn_id)
        .bind(&input.title)
        .bind(source.position_x + if input.relation == "divergent" { 260.0 } else { 0.0 })
        .bind(source.position_y + if input.relation == "child" { 180.0 } else { 120.0 })
        .bind(&now)
        .bind(&now)
        .execute(&mut *tx)
        .await?;
        if let Some(selected_text) = input.selected_text.as_deref() {
            sqlx::query("UPDATE cards SET summary = ? WHERE id = ?")
                .bind(format!("Focus excerpt: {selected_text}"))
                .bind(&id)
                .execute(&mut *tx)
                .await?;
        }
        tx.commit().await?;
        sqlx::query_as("SELECT * FROM cards WHERE id = ?")
            .bind(id)
            .fetch_one(&self.pool)
            .await
    }

    pub async fn create_card_from_selection(
        &self,
        input: &CreateSelectionCardInput,
    ) -> Result<SelectionCardCreation, sqlx::Error> {
        let card_id = Uuid::now_v7().to_string();
        let link_id = Uuid::now_v7().to_string();
        let now = Utc::now().to_rfc3339();
        let mut tx = self.pool.begin().await?;
        let source: Card = sqlx::query_as(
            "SELECT cards.* FROM cards
             JOIN turns ON turns.card_id = cards.id
             WHERE cards.id = ? AND cards.project_id = ? AND turns.id = ?",
        )
        .bind(&input.source_card_id)
        .bind(&input.project_id)
        .bind(&input.source_turn_id)
        .fetch_one(&mut *tx)
        .await?;
        let source_content: String =
            sqlx::query_scalar("SELECT assistant_content FROM turns WHERE id = ? AND card_id = ?")
                .bind(&input.source_turn_id)
                .bind(&source.id)
                .fetch_one(&mut *tx)
                .await?;
        let selected_length = i64::try_from(input.selected_text.encode_utf16().count())
            .map_err(|_| sqlx::Error::RowNotFound)?;
        let source_length = i64::try_from(source_content.encode_utf16().count())
            .map_err(|_| sqlx::Error::RowNotFound)?;
        if input.start_offset < 0
            || selected_length == 0
            || input.end_offset.checked_sub(input.start_offset) != Some(selected_length)
            || input.end_offset > source_length
        {
            return Err(sqlx::Error::RowNotFound);
        }
        sqlx::query(
            "INSERT INTO cards
             (id,project_id,parent_id,relation,title,summary,unread,
              position_x,position_y,created_at,updated_at)
             VALUES (?,?,?,'child',?,?,1,?,?,?,?)",
        )
        .bind(&card_id)
        .bind(&input.project_id)
        .bind(&source.id)
        .bind(&input.title)
        .bind(format!("Focus excerpt: {}", input.selected_text))
        .bind(source.position_x)
        .bind(source.position_y + 180.0)
        .bind(&now)
        .bind(&now)
        .execute(&mut *tx)
        .await?;
        sqlx::query(
            "INSERT INTO selection_card_links
             (id,source_turn_id,target_card_id,selected_text,start_offset,end_offset,created_at)
             VALUES (?,?,?,?,?,?,?)",
        )
        .bind(&link_id)
        .bind(&input.source_turn_id)
        .bind(&card_id)
        .bind(&input.selected_text)
        .bind(input.start_offset)
        .bind(input.end_offset)
        .bind(&now)
        .execute(&mut *tx)
        .await?;
        tx.commit().await?;
        let card = self.get_card(&card_id).await?;
        let link = sqlx::query_as("SELECT * FROM selection_card_links WHERE id = ?")
            .bind(link_id)
            .fetch_one(&self.pool)
            .await?;
        Ok(SelectionCardCreation { card, link })
    }

    pub async fn get_card(&self, id: &str) -> Result<Card, sqlx::Error> {
        sqlx::query_as("SELECT * FROM cards WHERE id = ?")
            .bind(id)
            .fetch_one(&self.pool)
            .await
    }

    pub async fn ancestor_chain(&self, card_id: &str) -> Result<Vec<Card>, sqlx::Error> {
        sqlx::query_as(
            "WITH RECURSIVE ancestors AS (
                SELECT *, 0 AS level FROM cards WHERE id = ?
                UNION ALL
                SELECT cards.*, ancestors.level + 1
                FROM cards JOIN ancestors ON cards.id = ancestors.parent_id
             )
             SELECT id,project_id,parent_id,relation,branch_from_turn_id,title,summary,
                    context_snapshot_hash,context_stale,unread,position_x,position_y,created_at,updated_at
             FROM ancestors ORDER BY level DESC",
        )
        .bind(card_id)
        .fetch_all(&self.pool)
        .await
    }

    pub async fn set_context_snapshot(
        &self,
        card_id: &str,
        snapshot_hash: &str,
    ) -> Result<(), sqlx::Error> {
        sqlx::query(
            "UPDATE cards SET context_snapshot_hash = ?, context_stale = 0, updated_at = ? WHERE id = ?",
        )
        .bind(snapshot_hash)
        .bind(Utc::now().to_rfc3339())
        .bind(card_id)
        .execute(&self.pool)
        .await?;
        Ok(())
    }

    pub async fn rename_card(
        &self,
        card_id: &str,
        title: &str,
    ) -> Result<ProjectWorkspace, sqlx::Error> {
        let card = self.get_card(card_id).await?;
        let mut tx = self.pool.begin().await?;
        sqlx::query("UPDATE cards SET title = ?, updated_at = ? WHERE id = ?")
            .bind(title)
            .bind(Utc::now().to_rfc3339())
            .bind(card_id)
            .execute(&mut *tx)
            .await?;
        sqlx::query(
            "WITH RECURSIVE descendants(id) AS (
                SELECT id FROM cards WHERE parent_id = ?
                UNION ALL
                SELECT cards.id FROM cards JOIN descendants ON cards.parent_id = descendants.id
             )
             UPDATE cards SET context_stale = 1 WHERE id IN (SELECT id FROM descendants)",
        )
        .bind(card_id)
        .execute(&mut *tx)
        .await?;
        tx.commit().await?;
        self.get_workspace(&card.project_id).await
    }

    pub async fn delete_card(&self, card_id: &str) -> Result<CardDeletionResult, sqlx::Error> {
        let card = self.get_card(card_id).await?;
        if card.relation == "root" {
            return Err(sqlx::Error::RowNotFound);
        }
        let mut tx = self.pool.begin().await?;
        let streaming_count: i64 = sqlx::query_scalar(
            "WITH RECURSIVE subtree(id) AS (
                SELECT id FROM cards WHERE id = ?
                UNION ALL
                SELECT cards.id FROM cards JOIN subtree ON cards.parent_id = subtree.id
             )
             SELECT COUNT(*) FROM turns
             WHERE card_id IN (SELECT id FROM subtree) AND status = 'streaming'",
        )
        .bind(card_id)
        .fetch_one(&mut *tx)
        .await?;
        if streaming_count > 0 {
            return Err(sqlx::Error::RowNotFound);
        }
        let deleted = sqlx::query("DELETE FROM cards WHERE id = ? AND relation <> 'root'")
            .bind(card_id)
            .execute(&mut *tx)
            .await?;
        if deleted.rows_affected() != 1 {
            return Err(sqlx::Error::RowNotFound);
        }
        sqlx::query(
            "DELETE FROM mind_nodes
             WHERE project_id = ?
             AND NOT EXISTS (
                SELECT 1 FROM mind_node_sources
                WHERE mind_node_sources.mind_node_id = mind_nodes.id
             )",
        )
        .bind(&card.project_id)
        .execute(&mut *tx)
        .await?;
        sqlx::query("UPDATE projects SET updated_at = ? WHERE id = ?")
            .bind(Utc::now().to_rfc3339())
            .bind(&card.project_id)
            .execute(&mut *tx)
            .await?;
        tx.commit().await?;
        Ok(CardDeletionResult {
            workspace: self.get_workspace(&card.project_id).await?,
            mindscape: self.get_mindscape(&card.project_id).await?,
        })
    }

    pub async fn edit_turn(
        &self,
        turn_id: &str,
        user_content: &str,
    ) -> Result<ProjectWorkspace, sqlx::Error> {
        let turn = self.get_turn(turn_id).await?;
        let card = self.get_card(&turn.card_id).await?;
        let mut tx = self.pool.begin().await?;
        archive_turn_revision(&mut tx, &turn, "edit").await?;
        sqlx::query(
            "UPDATE turns SET user_content = ?, assistant_content = '', status = 'idle',
             error_message = NULL, request_id = NULL, updated_at = ? WHERE id = ?",
        )
        .bind(user_content)
        .bind(Utc::now().to_rfc3339())
        .bind(turn_id)
        .execute(&mut *tx)
        .await?;
        mark_card_tree_stale(&mut tx, &card.id).await?;
        tx.commit().await?;
        self.get_workspace(&card.project_id).await
    }

    pub async fn delete_turn(&self, turn_id: &str) -> Result<ProjectWorkspace, sqlx::Error> {
        let turn = self.get_turn(turn_id).await?;
        let card = self.get_card(&turn.card_id).await?;
        let mut tx = self.pool.begin().await?;
        archive_turn_revision(&mut tx, &turn, "delete").await?;
        sqlx::query("DELETE FROM turns WHERE id = ?")
            .bind(turn_id)
            .execute(&mut *tx)
            .await?;
        mark_card_tree_stale(&mut tx, &card.id).await?;
        tx.commit().await?;
        self.get_workspace(&card.project_id).await
    }

    pub async fn regenerate_turn(&self, turn_id: &str) -> Result<(Card, Turn), sqlx::Error> {
        let turn = self.get_turn(turn_id).await?;
        let card = self.get_card(&turn.card_id).await?;
        let branch = self
            .create_card(&CreateCardInput {
                project_id: card.project_id,
                source_card_id: card.id,
                relation: "branch".to_owned(),
                title: format!("Alternative · {}", card.title),
                branch_from_turn_id: Some(turn.id.clone()),
                selected_text: None,
            })
            .await?;
        Ok((branch, turn))
    }

    pub async fn search(
        &self,
        query: &str,
        project_id: Option<&str>,
    ) -> Result<Vec<SearchResult>, sqlx::Error> {
        let escaped = query.replace('"', "\"\"");
        let fts_query = format!("\"{escaped}\"");
        sqlx::query_as(
            "SELECT entity_type,entity_id,project_id,
             CASE
               WHEN entity_type='turn' THEN (SELECT card_id FROM turns WHERE turns.id=entity_id)
               WHEN entity_type='card' THEN entity_id
               ELSE NULL
             END AS card_id,
             title,substr(content,1,240) AS excerpt
             FROM search_index
             WHERE search_index MATCH ? AND (? IS NULL OR project_id = ?)
             ORDER BY rank LIMIT 50",
        )
        .bind(fts_query)
        .bind(project_id)
        .bind(project_id)
        .fetch_all(&self.pool)
        .await
    }

    pub async fn toggle_turn_favorite(
        &self,
        project_id: &str,
        card_id: &str,
        turn_id: &str,
    ) -> Result<bool, sqlx::Error> {
        sqlx::query(
            "SELECT 1 FROM turns
             JOIN cards ON cards.id=turns.card_id
             WHERE turns.id=? AND turns.card_id=? AND cards.project_id=?",
        )
        .bind(turn_id)
        .bind(card_id)
        .bind(project_id)
        .fetch_one(&self.pool)
        .await?;
        let existing: Option<String> =
            sqlx::query_scalar("SELECT id FROM favorites WHERE project_id=? AND turn_id=? LIMIT 1")
                .bind(project_id)
                .bind(turn_id)
                .fetch_optional(&self.pool)
                .await?;
        if let Some(id) = existing {
            sqlx::query("DELETE FROM favorites WHERE id=?")
                .bind(id)
                .execute(&self.pool)
                .await?;
            return Ok(false);
        }
        sqlx::query(
            "INSERT INTO favorites (id,project_id,card_id,turn_id,created_at) VALUES (?,?,?,?,?)",
        )
        .bind(Uuid::now_v7().to_string())
        .bind(project_id)
        .bind(card_id)
        .bind(turn_id)
        .bind(Utc::now().to_rfc3339())
        .execute(&self.pool)
        .await?;
        Ok(true)
    }

    pub async fn favorite_turn_ids(&self, project_id: &str) -> Result<Vec<String>, sqlx::Error> {
        sqlx::query_scalar(
            "SELECT turn_id FROM favorites WHERE project_id=? AND turn_id IS NOT NULL ORDER BY created_at",
        )
        .bind(project_id)
        .fetch_all(&self.pool)
            .await
    }

    pub async fn list_documents(&self, project_id: &str) -> Result<Vec<Document>, sqlx::Error> {
        sqlx::query_as("SELECT * FROM documents WHERE project_id=? ORDER BY created_at")
            .bind(project_id)
            .fetch_all(&self.pool)
            .await
    }

    pub async fn find_document_by_hash(
        &self,
        project_id: &str,
        content_hash: &str,
    ) -> Result<Option<Document>, sqlx::Error> {
        sqlx::query_as("SELECT * FROM documents WHERE project_id=? AND content_hash=?")
            .bind(project_id)
            .bind(content_hash)
            .fetch_optional(&self.pool)
            .await
    }

    pub async fn get_document(
        &self,
        project_id: &str,
        document_id: &str,
    ) -> Result<Document, sqlx::Error> {
        sqlx::query_as("SELECT * FROM documents WHERE project_id=? AND id=?")
            .bind(project_id)
            .bind(document_id)
            .fetch_one(&self.pool)
            .await
    }

    pub async fn find_document_by_id(
        &self,
        document_id: &str,
    ) -> Result<Option<Document>, sqlx::Error> {
        sqlx::query_as("SELECT * FROM documents WHERE id=?")
            .bind(document_id)
            .fetch_optional(&self.pool)
            .await
    }

    #[allow(clippy::too_many_arguments)]
    pub async fn insert_document(
        &self,
        id: &str,
        project_id: &str,
        name: &str,
        mime_type: &str,
        local_path: &str,
        content_hash: &str,
    ) -> Result<Document, sqlx::Error> {
        sqlx::query(
            "INSERT INTO documents
             (id,project_id,name,mime_type,local_path,content_hash,status,created_at)
             VALUES (?,?,?,?,?,?,'processing',?)",
        )
        .bind(id)
        .bind(project_id)
        .bind(name)
        .bind(mime_type)
        .bind(local_path)
        .bind(content_hash)
        .bind(Utc::now().to_rfc3339())
        .execute(&self.pool)
        .await?;
        self.get_document(project_id, id).await
    }

    pub async fn delete_document(
        &self,
        project_id: &str,
        document_id: &str,
    ) -> Result<(), sqlx::Error> {
        let result = sqlx::query("DELETE FROM documents WHERE project_id=? AND id=?")
            .bind(project_id)
            .bind(document_id)
            .execute(&self.pool)
            .await?;
        if result.rows_affected() != 1 {
            return Err(sqlx::Error::RowNotFound);
        }
        Ok(())
    }

    pub async fn list_document_chunks(
        &self,
        project_id: &str,
        document_id: &str,
    ) -> Result<Vec<DocumentChunk>, sqlx::Error> {
        sqlx::query_as(
            "SELECT document_chunks.* FROM document_chunks
             JOIN documents ON documents.id=document_chunks.document_id
             WHERE documents.project_id=? AND documents.id=?
             ORDER BY COALESCE(page_number,0),start_offset",
        )
        .bind(project_id)
        .bind(document_id)
        .fetch_all(&self.pool)
        .await
    }

    pub async fn replace_document_chunks(
        &self,
        document: &Document,
        chunks: &[crate::documents::ChunkDraft],
    ) -> Result<Document, sqlx::Error> {
        let mut tx = self.pool.begin().await?;
        sqlx::query("DELETE FROM document_chunks WHERE document_id=?")
            .bind(&document.id)
            .execute(&mut *tx)
            .await?;
        for chunk in chunks {
            let heading_path = serde_json::to_string(&chunk.heading_path)
                .map_err(|error| sqlx::Error::Encode(Box::new(error)))?;
            sqlx::query(
                "INSERT INTO document_chunks
                 (id,document_id,content,page_number,heading_path,start_offset,end_offset)
                 VALUES (?,?,?,?,?,?,?)",
            )
            .bind(Uuid::now_v7().to_string())
            .bind(&document.id)
            .bind(&chunk.content)
            .bind(chunk.page_number)
            .bind(heading_path)
            .bind(chunk.start_offset)
            .bind(chunk.end_offset)
            .execute(&mut *tx)
            .await?;
        }
        sqlx::query("UPDATE documents SET status='ready' WHERE id=? AND project_id=?")
            .bind(&document.id)
            .bind(&document.project_id)
            .execute(&mut *tx)
            .await?;
        tx.commit().await?;
        self.get_document(&document.project_id, &document.id).await
    }

    pub async fn set_document_status(
        &self,
        project_id: &str,
        document_id: &str,
        status: &str,
    ) -> Result<(), sqlx::Error> {
        sqlx::query("UPDATE documents SET status=? WHERE id=? AND project_id=?")
            .bind(status)
            .bind(document_id)
            .bind(project_id)
            .execute(&self.pool)
            .await?;
        Ok(())
    }

    pub async fn retrieve_document_chunks(
        &self,
        project_id: &str,
        query: &str,
        limit: i64,
    ) -> Result<Vec<RetrievedDocumentChunk>, sqlx::Error> {
        let fts_query = document_fts_query(query);
        if fts_query.is_empty() {
            return Ok(Vec::new());
        }
        sqlx::query_as(
            "SELECT document_chunks.id AS chunk_id,
                    documents.id AS document_id,
                    documents.name AS document_name,
                    document_chunks.content,
                    document_chunks.page_number,
                    document_chunks.heading_path,
                    document_chunks.start_offset,
                    document_chunks.end_offset,
                    bm25(document_chunk_search) AS score
             FROM document_chunk_search
             JOIN document_chunks ON document_chunks.id=document_chunk_search.chunk_id
             JOIN documents ON documents.id=document_chunks.document_id
             WHERE document_chunk_search MATCH ?
               AND document_chunk_search.project_id=?
             ORDER BY score LIMIT ?",
        )
        .bind(fts_query)
        .bind(project_id)
        .bind(limit.clamp(1, 10))
        .fetch_all(&self.pool)
        .await
    }

    pub async fn create_document_citations(
        &self,
        turn_id: &str,
        chunks: &[RetrievedDocumentChunk],
    ) -> Result<Vec<DocumentCitation>, sqlx::Error> {
        let mut tx = self.pool.begin().await?;
        sqlx::query("DELETE FROM document_citations WHERE turn_id=?")
            .bind(turn_id)
            .execute(&mut *tx)
            .await?;
        for chunk in chunks {
            sqlx::query(
                "INSERT INTO document_citations
                 (id,turn_id,chunk_id,document_id,document_name,page_number,heading_path,
                  excerpt,start_offset,end_offset,created_at)
                 VALUES (?,?,?,?,?,?,?,?,?,?,?)",
            )
            .bind(Uuid::now_v7().to_string())
            .bind(turn_id)
            .bind(&chunk.chunk_id)
            .bind(&chunk.document_id)
            .bind(&chunk.document_name)
            .bind(chunk.page_number)
            .bind(&chunk.heading_path)
            .bind(&chunk.content)
            .bind(chunk.start_offset)
            .bind(chunk.end_offset)
            .bind(Utc::now().to_rfc3339())
            .execute(&mut *tx)
            .await?;
        }
        tx.commit().await?;
        self.document_citations_for_turn(turn_id).await
    }

    pub async fn document_citations_for_project(
        &self,
        project_id: &str,
    ) -> Result<Vec<DocumentCitation>, sqlx::Error> {
        sqlx::query_as(
            "SELECT document_citations.*,
                    document_citations.chunk_id IS NOT NULL AS available
             FROM document_citations
             JOIN turns ON turns.id=document_citations.turn_id
             JOIN cards ON cards.id=turns.card_id
             WHERE cards.project_id=?
             ORDER BY document_citations.created_at",
        )
        .bind(project_id)
        .fetch_all(&self.pool)
        .await
    }

    async fn document_citations_for_turn(
        &self,
        turn_id: &str,
    ) -> Result<Vec<DocumentCitation>, sqlx::Error> {
        sqlx::query_as(
            "SELECT document_citations.*,
                    document_citations.chunk_id IS NOT NULL AS available
             FROM document_citations WHERE turn_id=? ORDER BY created_at",
        )
        .bind(turn_id)
        .fetch_all(&self.pool)
        .await
    }

    pub async fn get_mindscape(&self, project_id: &str) -> Result<MindscapeGraph, sqlx::Error> {
        let nodes =
            sqlx::query_as("SELECT * FROM mind_nodes WHERE project_id=? ORDER BY created_at")
                .bind(project_id)
                .fetch_all(&self.pool)
                .await?;
        let edges =
            sqlx::query_as("SELECT * FROM mind_edges WHERE project_id=? ORDER BY created_at")
                .bind(project_id)
                .fetch_all(&self.pool)
                .await?;
        let sources = sqlx::query_as(
            "SELECT mind_node_sources.* FROM mind_node_sources
             JOIN mind_nodes ON mind_nodes.id=mind_node_sources.mind_node_id
             WHERE mind_nodes.project_id=? ORDER BY mind_node_sources.created_at",
        )
        .bind(project_id)
        .fetch_all(&self.pool)
        .await?;
        Ok(MindscapeGraph {
            nodes,
            edges,
            sources,
        })
    }

    pub async fn create_mind_node(
        &self,
        input: &CreateMindNodeInput,
    ) -> Result<MindNode, sqlx::Error> {
        if input.source_card_id.is_none() && input.source_turn_id.is_none() {
            return Err(sqlx::Error::RowNotFound);
        }
        let source_card_id = if let Some(turn_id) = &input.source_turn_id {
            let turn_card_id: String = sqlx::query_scalar(
                "SELECT turns.card_id FROM turns
                 JOIN cards ON cards.id=turns.card_id
                 WHERE turns.id=? AND cards.project_id=?",
            )
            .bind(turn_id)
            .bind(&input.project_id)
            .fetch_one(&self.pool)
            .await?;
            if input
                .source_card_id
                .as_deref()
                .is_some_and(|card_id| card_id != turn_card_id)
            {
                return Err(sqlx::Error::RowNotFound);
            }
            Some(turn_card_id)
        } else {
            let card_id = input
                .source_card_id
                .as_deref()
                .ok_or(sqlx::Error::RowNotFound)?;
            sqlx::query("SELECT 1 FROM cards WHERE id=? AND project_id=?")
                .bind(card_id)
                .bind(&input.project_id)
                .fetch_one(&self.pool)
                .await?;
            Some(card_id.to_owned())
        };
        if let Some(existing) = sqlx::query_as::<_, MindNode>(
            "SELECT * FROM mind_nodes WHERE project_id=?
             AND ((? IS NOT NULL AND source_turn_id=?)
               OR (? IS NULL AND source_turn_id IS NULL AND source_card_id=?))
             AND label=?
             LIMIT 1",
        )
        .bind(&input.project_id)
        .bind(&input.source_turn_id)
        .bind(&input.source_turn_id)
        .bind(&input.source_turn_id)
        .bind(&source_card_id)
        .bind(&input.label)
        .fetch_optional(&self.pool)
        .await?
        {
            return Ok(existing);
        }
        let id = Uuid::now_v7().to_string();
        let now = Utc::now().to_rfc3339();
        let position: i64 =
            sqlx::query_scalar("SELECT COUNT(*) FROM mind_nodes WHERE project_id=?")
                .bind(&input.project_id)
                .fetch_one(&self.pool)
                .await?;
        let mut tx = self.pool.begin().await?;
        sqlx::query(
            "INSERT INTO mind_nodes
             (id,project_id,label,description,source_card_id,source_turn_id,
              position_x,position_y,created_at)
             VALUES (?,?,?,?,?,?,?,?,?)",
        )
        .bind(&id)
        .bind(&input.project_id)
        .bind(&input.label)
        .bind(&input.description)
        .bind(&source_card_id)
        .bind(&input.source_turn_id)
        .bind((position % 3) as f64 * 180.0)
        .bind((position / 3) as f64 * 120.0)
        .bind(&now)
        .execute(&mut *tx)
        .await?;
        sqlx::query(
            "INSERT INTO mind_node_sources
             (id,mind_node_id,card_id,turn_id,created_at) VALUES (?,?,?,?,?)",
        )
        .bind(Uuid::now_v7().to_string())
        .bind(&id)
        .bind(&source_card_id)
        .bind(&input.source_turn_id)
        .bind(&now)
        .execute(&mut *tx)
        .await?;
        tx.commit().await?;
        sqlx::query_as("SELECT * FROM mind_nodes WHERE id=?")
            .bind(id)
            .fetch_one(&self.pool)
            .await
    }

    pub async fn create_mind_edge(
        &self,
        input: &CreateMindEdgeInput,
    ) -> Result<MindEdge, sqlx::Error> {
        if input.source_id == input.target_id {
            return Err(sqlx::Error::RowNotFound);
        }
        let count: i64 = sqlx::query_scalar(
            "SELECT COUNT(*) FROM mind_nodes
             WHERE project_id=? AND id IN (?,?)",
        )
        .bind(&input.project_id)
        .bind(&input.source_id)
        .bind(&input.target_id)
        .fetch_one(&self.pool)
        .await?;
        if count != 2 {
            return Err(sqlx::Error::RowNotFound);
        }
        let id = Uuid::now_v7().to_string();
        let now = Utc::now().to_rfc3339();
        sqlx::query(
            "INSERT INTO mind_edges
             (id,project_id,source_id,target_id,relation,created_at) VALUES (?,?,?,?,?,?)",
        )
        .bind(&id)
        .bind(&input.project_id)
        .bind(&input.source_id)
        .bind(&input.target_id)
        .bind(&input.relation)
        .bind(&now)
        .execute(&self.pool)
        .await?;
        sqlx::query_as("SELECT * FROM mind_edges WHERE id=?")
            .bind(id)
            .fetch_one(&self.pool)
            .await
    }

    pub async fn update_mind_node(
        &self,
        project_id: &str,
        node_id: &str,
        label: &str,
        description: &str,
        position_x: f64,
        position_y: f64,
    ) -> Result<MindNode, sqlx::Error> {
        let result = sqlx::query(
            "UPDATE mind_nodes
             SET label=?,description=?,position_x=?,position_y=?
             WHERE id=? AND project_id=?",
        )
        .bind(label)
        .bind(description)
        .bind(position_x)
        .bind(position_y)
        .bind(node_id)
        .bind(project_id)
        .execute(&self.pool)
        .await?;
        if result.rows_affected() != 1 {
            return Err(sqlx::Error::RowNotFound);
        }
        sqlx::query_as("SELECT * FROM mind_nodes WHERE id=?")
            .bind(node_id)
            .fetch_one(&self.pool)
            .await
    }

    pub async fn merge_mind_nodes(
        &self,
        project_id: &str,
        source_node_id: &str,
        target_node_id: &str,
    ) -> Result<(), sqlx::Error> {
        if source_node_id == target_node_id {
            return Err(sqlx::Error::RowNotFound);
        }
        let count: i64 = sqlx::query_scalar(
            "SELECT COUNT(*) FROM mind_nodes
             WHERE project_id=? AND id IN (?,?)",
        )
        .bind(project_id)
        .bind(source_node_id)
        .bind(target_node_id)
        .fetch_one(&self.pool)
        .await?;
        if count != 2 {
            return Err(sqlx::Error::RowNotFound);
        }
        let sources = sqlx::query_as::<_, crate::models::MindNodeSource>(
            "SELECT * FROM mind_node_sources WHERE mind_node_id=?",
        )
        .bind(source_node_id)
        .fetch_all(&self.pool)
        .await?;
        let mut tx = self.pool.begin().await?;
        for source in sources {
            sqlx::query(
                "INSERT INTO mind_node_sources
                 (id,mind_node_id,card_id,turn_id,created_at) VALUES (?,?,?,?,?)",
            )
            .bind(Uuid::now_v7().to_string())
            .bind(target_node_id)
            .bind(source.card_id)
            .bind(source.turn_id)
            .bind(source.created_at)
            .execute(&mut *tx)
            .await?;
        }
        sqlx::query(
            "DELETE FROM mind_edges WHERE project_id=?
             AND ((source_id=? AND target_id=?) OR (source_id=? AND target_id=?))",
        )
        .bind(project_id)
        .bind(source_node_id)
        .bind(target_node_id)
        .bind(target_node_id)
        .bind(source_node_id)
        .execute(&mut *tx)
        .await?;
        sqlx::query("UPDATE mind_edges SET source_id=? WHERE project_id=? AND source_id=?")
            .bind(target_node_id)
            .bind(project_id)
            .bind(source_node_id)
            .execute(&mut *tx)
            .await?;
        sqlx::query("UPDATE mind_edges SET target_id=? WHERE project_id=? AND target_id=?")
            .bind(target_node_id)
            .bind(project_id)
            .bind(source_node_id)
            .execute(&mut *tx)
            .await?;
        sqlx::query("DELETE FROM mind_nodes WHERE project_id=? AND id=?")
            .bind(project_id)
            .bind(source_node_id)
            .execute(&mut *tx)
            .await?;
        tx.commit().await?;
        Ok(())
    }
}

fn document_fts_query(query: &str) -> String {
    query
        .split_whitespace()
        .filter_map(|token| {
            let token = token
                .trim_matches(|character: char| !character.is_alphanumeric() && character != '_');
            if token.is_empty() {
                return None;
            }
            let token = token
                .chars()
                .take(100)
                .collect::<String>()
                .replace('"', "\"\"");
            Some(format!("\"{token}\""))
        })
        .take(12)
        .collect::<Vec<_>>()
        .join(" OR ")
}

async fn archive_turn_revision(
    tx: &mut sqlx::Transaction<'_, sqlx::Sqlite>,
    turn: &Turn,
    revision_kind: &str,
) -> Result<(), sqlx::Error> {
    sqlx::query(
        "INSERT INTO turn_revisions
         (id,turn_id,revision_kind,user_content,assistant_content,status,created_at)
         VALUES (?,?,?,?,?,?,?)",
    )
    .bind(Uuid::now_v7().to_string())
    .bind(&turn.id)
    .bind(revision_kind)
    .bind(&turn.user_content)
    .bind(&turn.assistant_content)
    .bind(&turn.status)
    .bind(Utc::now().to_rfc3339())
    .execute(&mut **tx)
    .await?;
    Ok(())
}

async fn mark_card_tree_stale(
    tx: &mut sqlx::Transaction<'_, sqlx::Sqlite>,
    card_id: &str,
) -> Result<(), sqlx::Error> {
    sqlx::query(
        "WITH RECURSIVE affected(id) AS (
            SELECT id FROM cards WHERE id = ?
            UNION ALL
            SELECT cards.id FROM cards JOIN affected ON cards.parent_id = affected.id
         )
         UPDATE cards SET context_stale = 1 WHERE id IN (SELECT id FROM affected)",
    )
    .bind(card_id)
    .execute(&mut **tx)
    .await?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::Database;

    #[tokio::test]
    async fn migrations_are_idempotent_and_project_creation_is_transactional() {
        let database = Database::in_memory().await.expect("database");
        let workspace = database
            .create_project("First principles")
            .await
            .expect("project");

        assert_eq!(workspace.project.title, "First principles");
        assert_eq!(workspace.cards.len(), 1);
        assert_eq!(workspace.cards[0].relation, "root");
        assert_eq!(
            workspace.project.root_card_id.as_deref(),
            Some(workspace.cards[0].id.as_str())
        );
    }

    #[tokio::test]
    async fn active_project_listing_excludes_archived_projects() {
        let database = Database::in_memory().await.expect("database");
        let workspace = database.create_project("Archived").await.expect("project");
        database
            .set_project_archived(&workspace.project.id, true)
            .await
            .expect("archive");

        assert!(database
            .list_projects(false)
            .await
            .expect("list")
            .is_empty());
        assert_eq!(
            database.list_projects(true).await.expect("list all").len(),
            1
        );
    }

    #[tokio::test]
    async fn model_profile_never_persists_api_key() {
        let database = Database::in_memory().await.expect("database");
        let profile = database
            .save_model_profile(
                &crate::models::SaveModelProfileInput {
                    id: None,
                    name: "Local".to_owned(),
                    provider: "openai_compatible".to_owned(),
                    base_url: "https://example.test/v1/".to_owned(),
                    model: "test".to_owned(),
                    api_key: Some("not-persisted".to_owned()),
                },
                Some("credential-ref"),
            )
            .await
            .expect("profile");
        let serialized = serde_json::to_string(&profile).expect("serialize");

        assert!(!serialized.contains("not-persisted"));
        assert_eq!(profile.base_url, "https://example.test/v1");
        assert_eq!(profile.keychain_ref.as_deref(), Some("credential-ref"));
    }

    #[tokio::test]
    async fn streaming_turn_can_be_completed_incrementally() {
        let database = Database::in_memory().await.expect("database");
        let workspace = database.create_project("Chat").await.expect("project");
        let card_id = &workspace.cards[0].id;
        let turn = database
            .create_streaming_turn(card_id, "Hello", "model", "request")
            .await
            .expect("turn");

        assert_eq!(turn.status, "streaming");
        let completed = database
            .update_turn(&turn.id, "World", "completed", None)
            .await
            .expect("complete");
        assert_eq!(completed.assistant_content, "World");
        assert_eq!(completed.status, "completed");
    }

    #[tokio::test]
    async fn reopening_database_marks_streaming_turn_interrupted() {
        let directory = tempfile::tempdir().expect("tempdir");
        let path = directory.path().join("recovery.sqlite3");
        let database = Database::open(&path).await.expect("database");
        let workspace = database.create_project("Recovery").await.expect("project");
        let turn = database
            .create_streaming_turn(&workspace.cards[0].id, "Hello", "model", "request")
            .await
            .expect("turn");
        let document = database
            .insert_document(
                "recovery-document",
                &workspace.project.id,
                "notes.txt",
                "text/plain",
                "/tmp/recovery-document",
                "recovery-hash",
            )
            .await
            .expect("document");
        database.pool().close().await;

        let reopened = Database::open(&path).await.expect("reopen");
        assert_eq!(
            reopened.get_turn(&turn.id).await.expect("recovered").status,
            "interrupted"
        );
        assert_eq!(
            reopened
                .get_document(&workspace.project.id, &document.id)
                .await
                .expect("recovered document")
                .status,
            "failed"
        );
    }

    #[tokio::test]
    async fn creates_all_hierarchical_card_relations() {
        let database = Database::in_memory().await.expect("database");
        let workspace = database.create_project("Tree").await.expect("project");
        let root = &workspace.cards[0];
        for relation in ["child", "divergent"] {
            let card = database
                .create_card(&crate::models::CreateCardInput {
                    project_id: workspace.project.id.clone(),
                    source_card_id: root.id.clone(),
                    relation: relation.to_owned(),
                    title: relation.to_owned(),
                    branch_from_turn_id: None,
                    selected_text: None,
                })
                .await
                .expect("card");
            assert_eq!(card.parent_id.as_deref(), Some(root.id.as_str()));
            assert_eq!(card.relation, relation);
        }
        let turn = database
            .create_streaming_turn(&root.id, "prompt", "model", "request")
            .await
            .expect("turn");
        let branch = database
            .create_card(&crate::models::CreateCardInput {
                project_id: workspace.project.id,
                source_card_id: root.id.clone(),
                relation: "branch".to_owned(),
                title: "branch".to_owned(),
                branch_from_turn_id: Some(turn.id.clone()),
                selected_text: None,
            })
            .await
            .expect("branch");
        assert_eq!(branch.branch_from_turn_id, Some(turn.id));
    }

    #[tokio::test]
    async fn editing_card_marks_only_its_descendants_stale() {
        let database = Database::in_memory().await.expect("database");
        let workspace = database.create_project("Tree").await.expect("project");
        let root = &workspace.cards[0];
        let child = database
            .create_card(&crate::models::CreateCardInput {
                project_id: workspace.project.id.clone(),
                source_card_id: root.id.clone(),
                relation: "child".to_owned(),
                title: "Child".to_owned(),
                branch_from_turn_id: None,
                selected_text: None,
            })
            .await
            .expect("child");
        let sibling = database
            .create_card(&crate::models::CreateCardInput {
                project_id: workspace.project.id.clone(),
                source_card_id: root.id.clone(),
                relation: "divergent".to_owned(),
                title: "Sibling".to_owned(),
                branch_from_turn_id: None,
                selected_text: None,
            })
            .await
            .expect("sibling");
        let grandchild = database
            .create_card(&crate::models::CreateCardInput {
                project_id: workspace.project.id,
                source_card_id: child.id.clone(),
                relation: "child".to_owned(),
                title: "Grandchild".to_owned(),
                branch_from_turn_id: None,
                selected_text: None,
            })
            .await
            .expect("grandchild");

        let updated = database
            .rename_card(&child.id, "Edited child")
            .await
            .expect("rename");
        assert!(
            updated
                .cards
                .iter()
                .find(|card| card.id == grandchild.id)
                .expect("grandchild")
                .context_stale
        );
        assert!(
            !updated
                .cards
                .iter()
                .find(|card| card.id == sibling.id)
                .expect("sibling")
                .context_stale
        );
        assert!(
            !updated
                .cards
                .iter()
                .find(|card| card.id == child.id)
                .expect("child")
                .context_stale
        );
    }

    #[tokio::test]
    async fn quote_keeps_source_offsets_and_attaches_to_target_turn() {
        let database = Database::in_memory().await.expect("database");
        let workspace = database.create_project("Quotes").await.expect("project");
        let source = database
            .create_streaming_turn(&workspace.cards[0].id, "source", "model", "request-1")
            .await
            .expect("source turn");
        database
            .update_turn(&source.id, "someexcerpt text", "completed", None)
            .await
            .expect("source answer");
        let target = database
            .create_streaming_turn(&workspace.cards[0].id, "target", "model", "request-2")
            .await
            .expect("target turn");
        let quote = database
            .create_quote(&crate::models::CreateQuoteInput {
                turn_id: source.id.clone(),
                selected_text: "excerpt".to_owned(),
                start_offset: 4,
                end_offset: 11,
            })
            .await
            .expect("quote");
        database
            .attach_quotes(std::slice::from_ref(&quote.id), &target.id)
            .await
            .expect("attach");

        let attached = database
            .quotes_for_target(&target.id)
            .await
            .expect("quotes");
        assert_eq!(attached[0].selected_text, "excerpt");
        assert_eq!(attached[0].start_offset, 4);
        assert_eq!(
            attached[0].target_turn_id.as_deref(),
            Some(target.id.as_str())
        );

        assert!(database
            .create_quote(&crate::models::CreateQuoteInput {
                turn_id: source.id.clone(),
                selected_text: "wrong!".to_owned(),
                start_offset: 4,
                end_offset: 9,
            })
            .await
            .is_err());

        database
            .update_turn(&source.id, "Alpha **beta** gamma", "completed", None)
            .await
            .expect("formatted answer");
        let formatted_quote = database
            .create_quote(&crate::models::CreateQuoteInput {
                turn_id: source.id.clone(),
                selected_text: "Alpha beta".to_owned(),
                start_offset: 0,
                end_offset: 10,
            })
            .await
            .expect("rendered quote");
        assert_eq!(formatted_quote.selected_text, "Alpha beta");

        let second_quote = database
            .create_quote(&crate::models::CreateQuoteInput {
                turn_id: source.id,
                selected_text: "excerpt".to_owned(),
                start_offset: 4,
                end_offset: 11,
            })
            .await
            .expect("second quote");
        let other = database.create_project("Other").await.expect("other");
        let cross_project_target = database
            .create_streaming_turn(&other.cards[0].id, "target", "model", "request-3")
            .await
            .expect("cross-project target");
        assert!(database
            .attach_quotes(&[second_quote.id], &cross_project_target.id)
            .await
            .is_err());
    }

    #[tokio::test]
    async fn selection_card_creation_is_atomic_unique_and_loaded_with_workspace() {
        let database = Database::in_memory().await.expect("database");
        let workspace = database
            .create_project("Selection links")
            .await
            .expect("project");
        let root = &workspace.cards[0];
        let source = database
            .create_streaming_turn(&root.id, "Explain", "model", "selection-request")
            .await
            .expect("source turn");
        database
            .update_turn(&source.id, "Alpha **beta** gamma", "completed", None)
            .await
            .expect("source answer");
        let input = crate::models::CreateSelectionCardInput {
            project_id: workspace.project.id.clone(),
            source_card_id: root.id.clone(),
            source_turn_id: source.id.clone(),
            title: "beta".to_owned(),
            selected_text: "beta".to_owned(),
            start_offset: 6,
            end_offset: 10,
        };

        let created = database
            .create_card_from_selection(&input)
            .await
            .expect("selection card");
        assert_eq!(created.card.relation, "child");
        assert_eq!(created.card.parent_id.as_deref(), Some(root.id.as_str()));
        assert_eq!(created.link.source_turn_id, source.id);
        assert_eq!(created.link.target_card_id, created.card.id);

        let loaded = database
            .get_workspace(&workspace.project.id)
            .await
            .expect("workspace");
        assert_eq!(loaded.selection_card_links, vec![created.link]);

        let mut invalid_range = input.clone();
        invalid_range.start_offset = 100;
        invalid_range.end_offset = 104;
        assert!(database
            .create_card_from_selection(&invalid_range)
            .await
            .is_err());

        assert!(database.create_card_from_selection(&input).await.is_err());
        let after_duplicate = database
            .get_workspace(&workspace.project.id)
            .await
            .expect("workspace after duplicate");
        assert_eq!(after_duplicate.cards.len(), 2);
        assert_eq!(after_duplicate.selection_card_links.len(), 1);
    }

    #[tokio::test]
    async fn deleting_a_child_cascades_its_subtree_and_keeps_traceable_mind_nodes() {
        let database = Database::in_memory().await.expect("database");
        let workspace = database.create_project("Delete").await.expect("project");
        let root = &workspace.cards[0];
        let child = database
            .create_card(&crate::models::CreateCardInput {
                project_id: workspace.project.id.clone(),
                source_card_id: root.id.clone(),
                relation: "child".to_owned(),
                title: "Child".to_owned(),
                branch_from_turn_id: None,
                selected_text: None,
            })
            .await
            .expect("child");
        let grandchild = database
            .create_card(&crate::models::CreateCardInput {
                project_id: workspace.project.id.clone(),
                source_card_id: child.id.clone(),
                relation: "child".to_owned(),
                title: "Grandchild".to_owned(),
                branch_from_turn_id: None,
                selected_text: None,
            })
            .await
            .expect("grandchild");
        let sibling = database
            .create_card(&crate::models::CreateCardInput {
                project_id: workspace.project.id.clone(),
                source_card_id: root.id.clone(),
                relation: "divergent".to_owned(),
                title: "Sibling".to_owned(),
                branch_from_turn_id: None,
                selected_text: None,
            })
            .await
            .expect("sibling");
        let child_turn = database
            .create_streaming_turn(&child.id, "Child question", "model", "child-request")
            .await
            .expect("child turn");
        database
            .update_turn(&child_turn.id, "Child answer", "completed", None)
            .await
            .expect("complete child");
        database
            .toggle_turn_favorite(&workspace.project.id, &child.id, &child_turn.id)
            .await
            .expect("favorite child");
        database
            .create_quote(&crate::models::CreateQuoteInput {
                turn_id: child_turn.id.clone(),
                selected_text: "Child".to_owned(),
                start_offset: 0,
                end_offset: 5,
            })
            .await
            .expect("quote child");
        let grandchild_turn = database
            .create_streaming_turn(
                &grandchild.id,
                "Grandchild question",
                "model",
                "grandchild-request",
            )
            .await
            .expect("grandchild turn");
        database
            .update_turn(&grandchild_turn.id, "Grandchild answer", "completed", None)
            .await
            .expect("complete grandchild");
        let root_turn = database
            .create_streaming_turn(&root.id, "Root question", "model", "root-request")
            .await
            .expect("root turn");
        let root_turn = database
            .update_turn(&root_turn.id, "Child", "completed", None)
            .await
            .expect("complete root");
        sqlx::query(
            "INSERT INTO selection_card_links
             (id,source_turn_id,target_card_id,selected_text,start_offset,end_offset,created_at)
             VALUES (?,?,?,?,?,?,?)",
        )
        .bind(uuid::Uuid::now_v7().to_string())
        .bind(&root_turn.id)
        .bind(&child.id)
        .bind("Child")
        .bind(0_i64)
        .bind(5_i64)
        .bind(chrono::Utc::now().to_rfc3339())
        .execute(database.pool())
        .await
        .expect("selection link");
        let orphaned_node = database
            .create_mind_node(&crate::models::CreateMindNodeInput {
                project_id: workspace.project.id.clone(),
                label: "Only child".to_owned(),
                description: String::new(),
                source_card_id: Some(child.id.clone()),
                source_turn_id: None,
            })
            .await
            .expect("orphaned node");
        let retained_node = database
            .create_mind_node(&crate::models::CreateMindNodeInput {
                project_id: workspace.project.id.clone(),
                label: "Shared".to_owned(),
                description: String::new(),
                source_card_id: Some(child.id.clone()),
                source_turn_id: None,
            })
            .await
            .expect("retained node");
        sqlx::query(
            "INSERT INTO mind_node_sources
             (id,mind_node_id,card_id,created_at) VALUES (?,?,?,?)",
        )
        .bind(uuid::Uuid::now_v7().to_string())
        .bind(&retained_node.id)
        .bind(&sibling.id)
        .bind(chrono::Utc::now().to_rfc3339())
        .execute(database.pool())
        .await
        .expect("second source");

        let deleted = database.delete_card(&child.id).await.expect("delete");

        assert_eq!(
            deleted
                .workspace
                .cards
                .iter()
                .map(|card| card.id.as_str())
                .collect::<Vec<_>>(),
            vec![root.id.as_str(), sibling.id.as_str()]
        );
        assert_eq!(deleted.workspace.turns, vec![root_turn]);
        assert!(deleted.workspace.selection_card_links.is_empty());
        assert!(database
            .favorite_turn_ids(&workspace.project.id)
            .await
            .expect("favorites")
            .is_empty());
        assert!(database
            .search("Grandchild answer", Some(&workspace.project.id))
            .await
            .expect("search")
            .is_empty());
        assert!(!deleted
            .mindscape
            .nodes
            .iter()
            .any(|node| node.id == orphaned_node.id));
        assert!(deleted
            .mindscape
            .nodes
            .iter()
            .any(|node| node.id == retained_node.id));
        assert!(database.delete_card(&root.id).await.is_err());
    }

    #[tokio::test]
    async fn deleting_a_card_with_a_streaming_turn_is_rejected() {
        let database = Database::in_memory().await.expect("database");
        let workspace = database.create_project("Delete").await.expect("project");
        let root = &workspace.cards[0];
        let child = database
            .create_card(&crate::models::CreateCardInput {
                project_id: workspace.project.id,
                source_card_id: root.id.clone(),
                relation: "child".to_owned(),
                title: "Child".to_owned(),
                branch_from_turn_id: None,
                selected_text: None,
            })
            .await
            .expect("child");
        let turn = database
            .create_streaming_turn(&child.id, "Question", "model", "request")
            .await
            .expect("streaming turn");

        assert!(database.delete_card(&child.id).await.is_err());
        database
            .update_turn(&turn.id, "", "cancelled", None)
            .await
            .expect("cancel");
        assert!(database.delete_card(&child.id).await.is_ok());
    }

    #[tokio::test]
    async fn edit_and_delete_turns_archive_revisions_and_preserve_regeneration_source() {
        let database = Database::in_memory().await.expect("database");
        let workspace = database.create_project("History").await.expect("project");
        let turn = database
            .create_streaming_turn(&workspace.cards[0].id, "original", "model", "request")
            .await
            .expect("turn");
        database
            .update_turn(&turn.id, "answer", "completed", None)
            .await
            .expect("complete");
        let (branch, source) = database
            .regenerate_turn(&turn.id)
            .await
            .expect("regenerate");
        assert_eq!(source.user_content, "original");
        assert_eq!(
            branch.branch_from_turn_id.as_deref(),
            Some(turn.id.as_str())
        );

        let edited = database.edit_turn(&turn.id, "edited").await.expect("edit");
        assert_eq!(edited.turns[0].user_content, "edited");
        assert_eq!(edited.turns[0].status, "idle");
        assert!(edited.cards[0].context_stale);
        let revision_count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM turn_revisions")
            .fetch_one(database.pool())
            .await
            .expect("revisions");
        assert_eq!(revision_count, 1);

        let deleted = database.delete_turn(&turn.id).await.expect("delete");
        assert!(deleted.turns.is_empty());
        let revision_count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM turn_revisions")
            .fetch_one(database.pool())
            .await
            .expect("revisions");
        assert_eq!(revision_count, 2);
    }

    #[tokio::test]
    async fn search_supports_unicode_code_and_favorite_toggling() {
        let database = Database::in_memory().await.expect("database");
        let workspace = database.create_project("中文研究").await.expect("project");
        let turn = database
            .create_streaming_turn(
                &workspace.cards[0].id,
                "解释 attention_map",
                "model",
                "request",
            )
            .await
            .expect("turn");
        database
            .update_turn(&turn.id, "这是一个代码片段", "completed", None)
            .await
            .expect("complete");

        assert!(!database
            .search("attention_map", Some(&workspace.project.id))
            .await
            .expect("code search")
            .is_empty());
        assert!(!database
            .search("中文研究", None)
            .await
            .expect("unicode search")
            .is_empty());
        assert!(database
            .toggle_turn_favorite(&workspace.project.id, &workspace.cards[0].id, &turn.id)
            .await
            .expect("favorite"));
        assert_eq!(
            database
                .favorite_turn_ids(&workspace.project.id)
                .await
                .expect("favorites"),
            vec![turn.id.clone()]
        );
        assert!(!database
            .toggle_turn_favorite(&workspace.project.id, &workspace.cards[0].id, &turn.id)
            .await
            .expect("unfavorite"));

        let other = database.create_project("Other").await.expect("other");
        assert!(database
            .toggle_turn_favorite(&other.project.id, &other.cards[0].id, &turn.id)
            .await
            .is_err());
    }

    #[tokio::test]
    async fn mindscape_nodes_keep_project_scoped_card_and_turn_sources() {
        let database = Database::in_memory().await.expect("database");
        let workspace = database.create_project("Mindscape").await.expect("project");
        let turn = database
            .create_streaming_turn(&workspace.cards[0].id, "Concept", "model", "request")
            .await
            .expect("turn");
        let card_node = database
            .create_mind_node(&crate::models::CreateMindNodeInput {
                project_id: workspace.project.id.clone(),
                label: "Card concept".to_owned(),
                description: "From card".to_owned(),
                source_card_id: Some(workspace.cards[0].id.clone()),
                source_turn_id: None,
            })
            .await
            .expect("card node");
        let turn_node = database
            .create_mind_node(&crate::models::CreateMindNodeInput {
                project_id: workspace.project.id.clone(),
                label: "Turn concept".to_owned(),
                description: "From favorite".to_owned(),
                source_card_id: Some(workspace.cards[0].id.clone()),
                source_turn_id: Some(turn.id.clone()),
            })
            .await
            .expect("turn node");
        database
            .create_mind_edge(&crate::models::CreateMindEdgeInput {
                project_id: workspace.project.id.clone(),
                source_id: card_node.id.clone(),
                target_id: turn_node.id.clone(),
                relation: "supports".to_owned(),
            })
            .await
            .expect("edge");

        let graph = database
            .get_mindscape(&workspace.project.id)
            .await
            .expect("graph");
        assert_eq!(graph.nodes.len(), 2);
        assert_eq!(graph.edges.len(), 1);
        assert_eq!(graph.sources.len(), 2);
        assert!(graph
            .sources
            .iter()
            .any(|source| source.turn_id.as_deref() == Some(turn.id.as_str())));

        let other = database.create_project("Other").await.expect("other");
        assert!(database
            .create_mind_node(&crate::models::CreateMindNodeInput {
                project_id: other.project.id,
                label: "Invalid".to_owned(),
                description: String::new(),
                source_card_id: Some(workspace.cards[0].id.clone()),
                source_turn_id: None,
            })
            .await
            .is_err());
        sqlx::query("DELETE FROM projects WHERE id=?")
            .bind(&workspace.project.id)
            .execute(database.pool())
            .await
            .expect("project cascade");
        let remaining_sources: i64 = sqlx::query_scalar(
            "SELECT COUNT(*) FROM mind_node_sources WHERE mind_node_id IN (?,?)",
        )
        .bind(card_node.id)
        .bind(turn_node.id)
        .fetch_one(database.pool())
        .await
        .expect("remaining sources");
        assert_eq!(remaining_sources, 0);
    }
}
