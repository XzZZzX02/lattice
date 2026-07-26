use std::{
    collections::{HashMap, HashSet},
    path::Path,
};

use chrono::Utc;
use serde::{Deserialize, Serialize};
use sqlx::{QueryBuilder, Sqlite};
use uuid::Uuid;

use crate::{
    db::Database,
    models::{Card, Favorite, Project, ProjectWorkspace, Quote, Turn},
};

const SCHEMA_VERSION: u32 = 1;
const MAX_IMPORT_BYTES: u64 = 100 * 1024 * 1024;

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ProjectBackup {
    schema_version: u32,
    exported_at: String,
    project: Project,
    cards: Vec<Card>,
    turns: Vec<Turn>,
    quotes: Vec<Quote>,
    favorites: Vec<Favorite>,
}

pub async fn export_project(
    database: &Database,
    project_id: &str,
    format: &str,
    path: &Path,
) -> Result<(), String> {
    validate_export_path(path, format)?;
    let backup = collect_backup(database, project_id).await?;
    let output = match format {
        "json" => serde_json::to_string_pretty(&backup)
            .map_err(|_| "Unable to serialize project backup".to_owned())?,
        "markdown" => render_markdown(&backup),
        _ => return Err("Unsupported export format".to_owned()),
    };
    std::fs::write(path, output).map_err(|_| "Unable to write export file".to_owned())
}

pub async fn import_project(database: &Database, path: &Path) -> Result<ProjectWorkspace, String> {
    validate_import_path(path)?;
    let content =
        std::fs::read_to_string(path).map_err(|_| "Unable to read project backup".to_owned())?;
    let backup: ProjectBackup =
        serde_json::from_str(&content).map_err(|_| "Project backup is invalid".to_owned())?;
    validate_backup(&backup)?;
    insert_backup(database, backup).await
}

async fn collect_backup(database: &Database, project_id: &str) -> Result<ProjectBackup, String> {
    let workspace = database
        .get_workspace(project_id)
        .await
        .map_err(|_| "Project not found".to_owned())?;
    let quotes = sqlx::query_as::<_, Quote>(
        "SELECT quotes.* FROM quotes
         JOIN turns ON turns.id=quotes.turn_id
         JOIN cards ON cards.id=turns.card_id
         WHERE cards.project_id=? ORDER BY quotes.created_at",
    )
    .bind(project_id)
    .fetch_all(database.pool())
    .await
    .map_err(|_| "Unable to export quotes".to_owned())?;
    let favorites = sqlx::query_as::<_, Favorite>(
        "SELECT * FROM favorites WHERE project_id=? ORDER BY created_at",
    )
    .bind(project_id)
    .fetch_all(database.pool())
    .await
    .map_err(|_| "Unable to export favorites".to_owned())?;
    Ok(ProjectBackup {
        schema_version: SCHEMA_VERSION,
        exported_at: Utc::now().to_rfc3339(),
        project: workspace.project,
        cards: workspace.cards,
        turns: workspace.turns,
        quotes,
        favorites,
    })
}

fn validate_export_path(path: &Path, format: &str) -> Result<(), String> {
    if !path.is_absolute() {
        return Err("Export path must be absolute".to_owned());
    }
    let expected = if format == "markdown" { "md" } else { format };
    if path.extension().and_then(|value| value.to_str()) != Some(expected) {
        return Err(format!("Export filename must end in .{expected}"));
    }
    Ok(())
}

fn validate_import_path(path: &Path) -> Result<(), String> {
    if !path.is_absolute() || path.extension().and_then(|value| value.to_str()) != Some("json") {
        return Err("Import must be an absolute .json file".to_owned());
    }
    let length = std::fs::metadata(path)
        .map_err(|_| "Unable to inspect project backup".to_owned())?
        .len();
    if length > MAX_IMPORT_BYTES {
        return Err("Project backup exceeds the 100 MB limit".to_owned());
    }
    Ok(())
}

fn validate_backup(backup: &ProjectBackup) -> Result<(), String> {
    if backup.schema_version != SCHEMA_VERSION {
        return Err(format!(
            "Unsupported backup schema version {}",
            backup.schema_version
        ));
    }
    if backup.project.title.trim().is_empty()
        || backup.project.title.chars().count() > 200
        || backup.cards.is_empty()
        || backup
            .cards
            .iter()
            .any(|card| card.project_id != backup.project.id)
    {
        return Err("Project backup has invalid card ownership".to_owned());
    }
    let card_ids: HashSet<_> = backup.cards.iter().map(|card| card.id.as_str()).collect();
    if card_ids.len() != backup.cards.len()
        || backup
            .project
            .root_card_id
            .as_deref()
            .is_none_or(|id| !card_ids.contains(id))
        || backup.cards.iter().any(|card| {
            card.title.trim().is_empty()
                || card.title.chars().count() > 240
                || card
                    .parent_id
                    .as_deref()
                    .is_some_and(|id| !card_ids.contains(id) || id == card.id)
                || !matches!(
                    card.relation.as_str(),
                    "root" | "child" | "divergent" | "branch"
                )
        })
    {
        return Err("Project backup has invalid card relationships".to_owned());
    }
    parent_first_cards(backup.cards.clone())?;
    let turn_ids: HashSet<_> = backup.turns.iter().map(|turn| turn.id.as_str()).collect();
    if backup.turns.iter().any(|turn| {
        !card_ids.contains(turn.card_id.as_str())
            || !matches!(
                turn.status.as_str(),
                "idle" | "streaming" | "completed" | "cancelled" | "failed" | "interrupted"
            )
    }) || turn_ids.len() != backup.turns.len()
    {
        return Err("Project backup has orphaned turns".to_owned());
    }
    let quote_ids: HashSet<_> = backup
        .quotes
        .iter()
        .map(|quote| quote.id.as_str())
        .collect();
    if quote_ids.len() != backup.quotes.len()
        || backup.quotes.iter().any(|quote| {
            let source = backup.turns.iter().find(|turn| turn.id == quote.turn_id);
            quote.selected_text.is_empty()
                || quote.start_offset < 0
                || quote.end_offset <= quote.start_offset
                || !turn_ids.contains(quote.turn_id.as_str())
                || source.is_none_or(|turn| {
                    !utf16_slice_matches(
                        &turn.assistant_content,
                        quote.start_offset,
                        quote.end_offset,
                        &quote.selected_text,
                    )
                })
                || quote
                    .target_turn_id
                    .as_deref()
                    .is_some_and(|id| !turn_ids.contains(id))
        })
    {
        return Err("Project backup has invalid quotes".to_owned());
    }
    let favorite_ids: HashSet<_> = backup
        .favorites
        .iter()
        .map(|favorite| favorite.id.as_str())
        .collect();
    if favorite_ids.len() != backup.favorites.len()
        || backup.favorites.iter().any(|favorite| {
            favorite.project_id != backup.project.id
                || (favorite.card_id.is_none() && favorite.turn_id.is_none())
                || favorite
                    .card_id
                    .as_deref()
                    .is_some_and(|id| !card_ids.contains(id))
                || favorite
                    .turn_id
                    .as_deref()
                    .is_some_and(|id| !turn_ids.contains(id))
        })
    {
        return Err("Project backup has invalid favorites".to_owned());
    }
    Ok(())
}

async fn insert_backup(
    database: &Database,
    backup: ProjectBackup,
) -> Result<ProjectWorkspace, String> {
    let collision = backup_has_collision(database, &backup).await?;
    let project_id = if collision {
        Uuid::now_v7().to_string()
    } else {
        backup.project.id.clone()
    };
    let card_map = id_map(backup.cards.iter().map(|card| card.id.as_str()), collision);
    let turn_map = id_map(backup.turns.iter().map(|turn| turn.id.as_str()), collision);
    let quote_map = id_map(
        backup.quotes.iter().map(|quote| quote.id.as_str()),
        collision,
    );
    let mut tx = database.pool().begin().await.map_err(db_error)?;
    sqlx::query(
        "INSERT INTO projects
         (id,title,description,system_prompt,root_card_id,archived,created_at,updated_at)
         VALUES (?,?,?,?,?,0,?,?)",
    )
    .bind(&project_id)
    .bind(if collision {
        format!("{} (imported)", backup.project.title)
    } else {
        backup.project.title
    })
    .bind(backup.project.description)
    .bind(backup.project.system_prompt)
    .bind(
        backup
            .project
            .root_card_id
            .as_deref()
            .and_then(|id| card_map.get(id)),
    )
    .bind(backup.project.created_at)
    .bind(Utc::now().to_rfc3339())
    .execute(&mut *tx)
    .await
    .map_err(db_error)?;
    for card in parent_first_cards(backup.cards)? {
        sqlx::query(
            "INSERT INTO cards
             (id,project_id,parent_id,relation,branch_from_turn_id,title,summary,
              context_snapshot_hash,context_stale,unread,position_x,position_y,created_at,updated_at)
             VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
        )
        .bind(&card_map[card.id.as_str()])
        .bind(&project_id)
        .bind(card.parent_id.as_deref().and_then(|id| card_map.get(id)))
        .bind(card.relation)
        .bind(
            card.branch_from_turn_id
                .as_deref()
                .and_then(|id| turn_map.get(id)),
        )
        .bind(card.title)
        .bind(card.summary)
        .bind(card.context_snapshot_hash)
        .bind(card.context_stale)
        .bind(card.unread)
        .bind(card.position_x)
        .bind(card.position_y)
        .bind(card.created_at)
        .bind(card.updated_at)
        .execute(&mut *tx)
        .await
        .map_err(db_error)?;
    }
    for turn in backup.turns {
        sqlx::query(
            "INSERT INTO turns
             (id,card_id,user_content,assistant_content,model_profile_id,status,error_message,
              request_id,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?)",
        )
        .bind(&turn_map[turn.id.as_str()])
        .bind(&card_map[turn.card_id.as_str()])
        .bind(turn.user_content)
        .bind(turn.assistant_content)
        .bind(turn.model_profile_id)
        .bind(if turn.status == "streaming" {
            "interrupted".to_owned()
        } else {
            turn.status
        })
        .bind(turn.error_message)
        .bind(turn.request_id)
        .bind(turn.created_at)
        .bind(turn.updated_at)
        .execute(&mut *tx)
        .await
        .map_err(db_error)?;
    }
    for quote in backup.quotes {
        sqlx::query(
            "INSERT INTO quotes
             (id,turn_id,target_turn_id,selected_text,start_offset,end_offset,created_at)
             VALUES (?,?,?,?,?,?,?)",
        )
        .bind(&quote_map[quote.id.as_str()])
        .bind(&turn_map[quote.turn_id.as_str()])
        .bind(
            quote
                .target_turn_id
                .as_deref()
                .and_then(|id| turn_map.get(id)),
        )
        .bind(quote.selected_text)
        .bind(quote.start_offset)
        .bind(quote.end_offset)
        .bind(quote.created_at)
        .execute(&mut *tx)
        .await
        .map_err(db_error)?;
    }
    for favorite in backup.favorites {
        sqlx::query(
            "INSERT INTO favorites (id,project_id,card_id,turn_id,created_at) VALUES (?,?,?,?,?)",
        )
        .bind(if collision {
            Uuid::now_v7().to_string()
        } else {
            favorite.id
        })
        .bind(&project_id)
        .bind(favorite.card_id.as_deref().and_then(|id| card_map.get(id)))
        .bind(favorite.turn_id.as_deref().and_then(|id| turn_map.get(id)))
        .bind(favorite.created_at)
        .execute(&mut *tx)
        .await
        .map_err(db_error)?;
    }
    tx.commit().await.map_err(db_error)?;
    database.get_workspace(&project_id).await.map_err(db_error)
}

async fn backup_has_collision(database: &Database, backup: &ProjectBackup) -> Result<bool, String> {
    if ids_collide(
        database,
        "projects",
        std::slice::from_ref(&backup.project.id),
    )
    .await?
        || ids_collide(
            database,
            "cards",
            &backup
                .cards
                .iter()
                .map(|card| card.id.clone())
                .collect::<Vec<_>>(),
        )
        .await?
        || ids_collide(
            database,
            "turns",
            &backup
                .turns
                .iter()
                .map(|turn| turn.id.clone())
                .collect::<Vec<_>>(),
        )
        .await?
        || ids_collide(
            database,
            "quotes",
            &backup
                .quotes
                .iter()
                .map(|quote| quote.id.clone())
                .collect::<Vec<_>>(),
        )
        .await?
        || ids_collide(
            database,
            "favorites",
            &backup
                .favorites
                .iter()
                .map(|favorite| favorite.id.clone())
                .collect::<Vec<_>>(),
        )
        .await?
    {
        return Ok(true);
    }
    Ok(false)
}

async fn ids_collide(
    database: &Database,
    table: &'static str,
    ids: &[String],
) -> Result<bool, String> {
    for chunk in ids.chunks(500) {
        if chunk.is_empty() {
            continue;
        }
        let mut query = QueryBuilder::<Sqlite>::new("SELECT EXISTS(SELECT 1 FROM ");
        query.push(table).push(" WHERE id IN (");
        let mut separated = query.separated(", ");
        for id in chunk {
            separated.push_bind(id);
        }
        separated.push_unseparated("))");
        if query
            .build_query_scalar::<bool>()
            .fetch_one(database.pool())
            .await
            .map_err(|_| "Unable to inspect project conflicts".to_owned())?
        {
            return Ok(true);
        }
    }
    Ok(false)
}

fn parent_first_cards(cards: Vec<Card>) -> Result<Vec<Card>, String> {
    let mut remaining = cards;
    let mut ordered = Vec::with_capacity(remaining.len());
    let mut inserted = HashSet::new();
    while !remaining.is_empty() {
        let index = remaining.iter().position(|card| {
            card.parent_id
                .as_deref()
                .is_none_or(|parent_id| inserted.contains(parent_id))
        });
        let Some(index) = index else {
            return Err("Project backup contains a cyclic card tree".to_owned());
        };
        let card = remaining.remove(index);
        inserted.insert(card.id.clone());
        ordered.push(card);
    }
    Ok(ordered)
}

fn utf16_slice_matches(content: &str, start: i64, end: i64, selected: &str) -> bool {
    let (Ok(start), Ok(end)) = (usize::try_from(start), usize::try_from(end)) else {
        return false;
    };
    content
        .encode_utf16()
        .collect::<Vec<_>>()
        .get(start..end)
        .is_some_and(|slice| slice == selected.encode_utf16().collect::<Vec<_>>())
}

fn id_map<'a>(ids: impl Iterator<Item = &'a str>, remap: bool) -> HashMap<String, String> {
    ids.map(|id| {
        (
            id.to_owned(),
            if remap {
                Uuid::now_v7().to_string()
            } else {
                id.to_owned()
            },
        )
    })
    .collect()
}

fn render_markdown(backup: &ProjectBackup) -> String {
    let mut output = format!("# {}\n\n", backup.project.title);
    for card in &backup.cards {
        output.push_str(&format!("## {} · {}\n\n", card.relation, card.title));
        for turn in backup.turns.iter().filter(|turn| turn.card_id == card.id) {
            output.push_str(&format!(
                "### Question\n\n{}\n\n### Answer\n\n{}\n\n",
                turn.user_content, turn.assistant_content
            ));
        }
    }
    output
}

fn db_error(_: impl std::fmt::Display) -> String {
    "Unable to restore project backup".to_owned()
}

#[cfg(test)]
mod tests {
    use super::{export_project, import_project, ProjectBackup, SCHEMA_VERSION};
    use crate::db::Database;
    use chrono::Utc;

    #[tokio::test]
    async fn json_round_trip_preserves_ids_in_empty_database_and_remaps_conflicts() {
        let source = Database::in_memory().await.expect("source");
        let workspace = source.create_project("Backup").await.expect("project");
        let directory = tempfile::tempdir().expect("tempdir");
        let path = directory.path().join("backup.json");
        export_project(&source, &workspace.project.id, "json", &path)
            .await
            .expect("export");

        let target = Database::in_memory().await.expect("target");
        let imported = import_project(&target, &path).await.expect("import");
        assert_eq!(imported.project.id, workspace.project.id);
        assert_eq!(imported.cards[0].id, workspace.cards[0].id);

        let duplicate = import_project(&target, &path).await.expect("duplicate");
        assert_ne!(duplicate.project.id, workspace.project.id);
        assert_ne!(duplicate.cards[0].id, workspace.cards[0].id);
        assert!(duplicate.project.title.ends_with("(imported)"));
    }

    #[tokio::test]
    async fn markdown_export_contains_readable_questions_and_answers() {
        let database = Database::in_memory().await.expect("database");
        let workspace = database.create_project("Readable").await.expect("project");
        let turn = database
            .create_streaming_turn(&workspace.cards[0].id, "Question", "model", "request")
            .await
            .expect("turn");
        database
            .update_turn(&turn.id, "Answer", "completed", None)
            .await
            .expect("answer");
        let directory = tempfile::tempdir().expect("tempdir");
        let path = directory.path().join("backup.md");
        export_project(&database, &workspace.project.id, "markdown", &path)
            .await
            .expect("export");
        let content = std::fs::read_to_string(path).expect("read");
        assert!(content.contains("# Readable"));
        assert!(content.contains("Question"));
        assert!(content.contains("Answer"));
    }

    #[tokio::test]
    async fn rejects_unsupported_and_damaged_backups_without_partial_writes() {
        let source = Database::in_memory().await.expect("source");
        let workspace = source.create_project("Backup").await.expect("project");
        let directory = tempfile::tempdir().expect("tempdir");
        let path = directory.path().join("damaged.json");
        let damaged = ProjectBackup {
            schema_version: SCHEMA_VERSION + 1,
            exported_at: Utc::now().to_rfc3339(),
            project: workspace.project,
            cards: workspace.cards,
            turns: Vec::new(),
            quotes: Vec::new(),
            favorites: Vec::new(),
        };
        std::fs::write(&path, serde_json::to_string(&damaged).expect("serialize")).expect("write");

        let target = Database::in_memory().await.expect("target");
        assert!(import_project(&target, &path).await.is_err());
        assert!(target
            .list_projects(false)
            .await
            .expect("projects")
            .is_empty());
    }
}
