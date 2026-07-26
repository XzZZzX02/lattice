use std::path::Path;

use chrono::Utc;
use sqlx::{sqlite::SqliteConnectOptions, SqlitePool};
use uuid::Uuid;

use crate::models::{Card, ModelProfile, Project, ProjectWorkspace, SaveModelProfileInput, Turn};

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
}
