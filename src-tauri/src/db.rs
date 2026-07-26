use std::path::Path;

use chrono::Utc;
use sqlx::{sqlite::SqliteConnectOptions, SqlitePool};
use uuid::Uuid;

use crate::models::{
    Card, CreateCardInput, CreateQuoteInput, ModelProfile, Project, ProjectWorkspace, Quote,
    SaveModelProfileInput, SearchResult, Turn,
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
        Ok(ProjectWorkspace {
            project,
            cards,
            turns,
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
        for quote_id in quote_ids {
            sqlx::query(
                "UPDATE quotes SET target_turn_id = ? WHERE id = ? AND target_turn_id IS NULL",
            )
            .bind(target_turn_id)
            .bind(quote_id)
            .execute(&mut *tx)
            .await?;
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
        database.pool().close().await;

        let reopened = Database::open(&path).await.expect("reopen");
        assert_eq!(
            reopened.get_turn(&turn.id).await.expect("recovered").status,
            "interrupted"
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
        let target = database
            .create_streaming_turn(&workspace.cards[0].id, "target", "model", "request-2")
            .await
            .expect("target turn");
        let quote = database
            .create_quote(&crate::models::CreateQuoteInput {
                turn_id: source.id,
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
    }
}
