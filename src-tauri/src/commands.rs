use tauri::State;

use crate::{
    db::Database,
    models::{ModelProfile, Project, ProjectWorkspace, SaveModelProfileInput},
    models_service,
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

#[tauri::command]
pub async fn list_model_profiles(
    database: State<'_, Database>,
) -> Result<Vec<ModelProfile>, String> {
    database
        .list_model_profiles()
        .await
        .map_err(|_| "Unable to load model profiles".to_owned())
}

#[tauri::command]
pub async fn save_model_profile(
    database: State<'_, Database>,
    input: SaveModelProfileInput,
) -> Result<ModelProfile, String> {
    models_service::validate_model_input(&input)?;
    let profile_id = input
        .id
        .clone()
        .unwrap_or_else(|| uuid::Uuid::now_v7().to_string());
    let keychain_ref = if let Some(api_key) = input.api_key.as_deref().filter(|key| !key.is_empty())
    {
        models_service::save_secret(&profile_id, api_key)?;
        Some(profile_id.clone())
    } else {
        None
    };
    let mut normalized = input;
    normalized.id = Some(profile_id);
    database
        .save_model_profile(&normalized, keychain_ref.as_deref())
        .await
        .map_err(|_| "Unable to save model profile".to_owned())
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
