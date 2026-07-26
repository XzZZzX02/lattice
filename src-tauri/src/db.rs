use std::path::Path;

use chrono::Utc;
use sqlx::{sqlite::SqliteConnectOptions, SqlitePool};
use uuid::Uuid;

use crate::models::{Card, Project, ProjectWorkspace, Turn};

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
}
