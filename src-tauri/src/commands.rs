use tauri::State;

use crate::{
    db::Database,
    models::{Project, ProjectWorkspace},
};

fn validate_title(title: &str) -> Result<&str, String> {
    let value = title.trim();
    if value.is_empty() || value.chars().count() > 200 {
        return Err("Project title must contain 1–200 characters".to_owned());
    }
    Ok(value)
}

#[tauri::command]
pub async fn list_projects(database: State<'_, Database>) -> Result<Vec<Project>, String> {
    database
        .list_projects(false)
        .await
        .map_err(|_| "Unable to load projects".to_owned())
}

#[tauri::command]
pub async fn create_project(
    database: State<'_, Database>,
    title: String,
) -> Result<ProjectWorkspace, String> {
    let title = validate_title(&title)?;
    database
        .create_project(title)
        .await
        .map_err(|_| "Unable to create project".to_owned())
}

#[tauri::command]
pub async fn get_workspace(
    database: State<'_, Database>,
    project_id: String,
) -> Result<ProjectWorkspace, String> {
    database
        .get_workspace(&project_id)
        .await
        .map_err(|_| "Unable to load workspace".to_owned())
}

#[tauri::command]
pub async fn rename_project(
    database: State<'_, Database>,
    project_id: String,
    title: String,
) -> Result<(), String> {
    let title = validate_title(&title)?;
    database
        .rename_project(&project_id, title)
        .await
        .map_err(|_| "Unable to rename project".to_owned())
}

#[tauri::command]
pub async fn archive_project(
    database: State<'_, Database>,
    project_id: String,
) -> Result<(), String> {
    database
        .set_project_archived(&project_id, true)
        .await
        .map_err(|_| "Unable to archive project".to_owned())
}

#[cfg(test)]
mod tests {
    use super::validate_title;

    #[test]
    fn project_title_validation_rejects_empty_and_oversized_values() {
        assert!(validate_title("  ").is_err());
        assert!(validate_title(&"a".repeat(201)).is_err());
        assert_eq!(validate_title(" Research ").expect("valid"), "Research");
    }
}
