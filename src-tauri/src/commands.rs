use tauri::{ipc::Channel, State};

use crate::{
    chat::RequestRegistry,
    db::Database,
    models::{
        Card, CreateCardInput, CreateQuoteInput, ModelProfile, Project, ProjectWorkspace, Quote,
        RegeneratedTurn, SaveModelProfileInput, SearchResult, SendMessageInput, StreamEvent, Turn,
    },
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
pub async fn create_card(
    database: State<'_, Database>,
    input: CreateCardInput,
) -> Result<Card, String> {
    if !matches!(input.relation.as_str(), "child" | "divergent" | "branch") {
        return Err("Unsupported card relation".to_owned());
    }
    if input.title.trim().is_empty() || input.title.chars().count() > 240 {
        return Err("Card title must contain 1–240 characters".to_owned());
    }
    if input.relation == "branch" && input.branch_from_turn_id.is_none() {
        return Err("A branch card requires a branch point".to_owned());
    }
    database
        .create_card(&input)
        .await
        .map_err(|_| "Unable to create card".to_owned())
}

#[tauri::command]
pub async fn create_quote(
    database: State<'_, Database>,
    input: CreateQuoteInput,
) -> Result<Quote, String> {
    let length = input.selected_text.chars().count();
    if length == 0
        || length > 8_000
        || input.start_offset < 0
        || input.end_offset <= input.start_offset
    {
        return Err("Selected quote is invalid".to_owned());
    }
    database
        .create_quote(&input)
        .await
        .map_err(|_| "Unable to save selected quote".to_owned())
}

#[tauri::command]
pub async fn edit_turn(
    database: State<'_, Database>,
    turn_id: String,
    user_content: String,
) -> Result<ProjectWorkspace, String> {
    let content = user_content.trim();
    if content.is_empty() || content.chars().count() > 32_000 {
        return Err("Message must contain 1–32,000 characters".to_owned());
    }
    database
        .edit_turn(&turn_id, content)
        .await
        .map_err(|_| "Unable to edit message".to_owned())
}

#[tauri::command]
pub async fn delete_turn(
    database: State<'_, Database>,
    turn_id: String,
) -> Result<ProjectWorkspace, String> {
    database
        .delete_turn(&turn_id)
        .await
        .map_err(|_| "Unable to delete message".to_owned())
}

#[tauri::command]
pub async fn regenerate_turn(
    database: State<'_, Database>,
    turn_id: String,
) -> Result<RegeneratedTurn, String> {
    let (card, source_turn) = database
        .regenerate_turn(&turn_id)
        .await
        .map_err(|_| "Unable to create regeneration branch".to_owned())?;
    Ok(RegeneratedTurn { card, source_turn })
}

#[tauri::command]
pub async fn search(
    database: State<'_, Database>,
    query: String,
    project_id: Option<String>,
) -> Result<Vec<SearchResult>, String> {
    let query = query.trim();
    if query.is_empty() {
        return Ok(Vec::new());
    }
    if query.chars().count() > 500 {
        return Err("Search query is too long".to_owned());
    }
    database
        .search(query, project_id.as_deref())
        .await
        .map_err(|_| "Unable to search local content".to_owned())
}

#[tauri::command]
pub async fn toggle_turn_favorite(
    database: State<'_, Database>,
    project_id: String,
    card_id: String,
    turn_id: String,
) -> Result<bool, String> {
    database
        .toggle_turn_favorite(&project_id, &card_id, &turn_id)
        .await
        .map_err(|_| "Unable to update favorite".to_owned())
}

#[tauri::command]
pub async fn favorite_turn_ids(
    database: State<'_, Database>,
    project_id: String,
) -> Result<Vec<String>, String> {
    database
        .favorite_turn_ids(&project_id)
        .await
        .map_err(|_| "Unable to load favorites".to_owned())
}

#[tauri::command]
pub async fn export_project(
    database: State<'_, Database>,
    project_id: String,
    format: String,
    path: String,
) -> Result<(), String> {
    crate::backup::export_project(&database, &project_id, &format, std::path::Path::new(&path))
        .await
}

#[tauri::command]
pub async fn import_project(
    database: State<'_, Database>,
    path: String,
) -> Result<ProjectWorkspace, String> {
    crate::backup::import_project(&database, std::path::Path::new(&path)).await
}

#[tauri::command]
pub async fn rename_card(
    database: State<'_, Database>,
    card_id: String,
    title: String,
) -> Result<ProjectWorkspace, String> {
    let title = title.trim();
    if title.is_empty() || title.chars().count() > 240 {
        return Err("Card title must contain 1–240 characters".to_owned());
    }
    database
        .rename_card(&card_id, title)
        .await
        .map_err(|_| "Unable to rename card".to_owned())
}

#[tauri::command]
pub async fn send_message(
    database: State<'_, Database>,
    requests: State<'_, RequestRegistry>,
    input: SendMessageInput,
    on_event: Channel<StreamEvent>,
) -> Result<Turn, String> {
    crate::chat::run_chat(&database, &requests, input, on_event).await
}

#[tauri::command]
pub async fn cancel_message(
    requests: State<'_, RequestRegistry>,
    request_id: String,
) -> Result<(), String> {
    if requests.cancel(&request_id).await {
        Ok(())
    } else {
        Err("The generation is no longer active".to_owned())
    }
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

#[tauri::command]
pub async fn test_model_profile(
    database: State<'_, Database>,
    profile_id: String,
) -> Result<Vec<String>, String> {
    let profile = database
        .get_model_profile(&profile_id)
        .await
        .map_err(|_| "Model profile not found".to_owned())?;
    models_service::list_remote_models(&profile).await
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
