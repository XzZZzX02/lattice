pub mod backup;
pub mod chat;
pub mod commands;
pub mod context;
pub mod db;
pub mod documents;
pub mod models;
pub mod models_service;
pub mod retrieval;

use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            let data_dir = app
                .path()
                .app_data_dir()
                .map_err(|error| format!("unable to resolve data directory: {error}"))?;
            std::fs::create_dir_all(&data_dir)?;
            let database = tauri::async_runtime::block_on(db::Database::open(
                &data_dir.join("lattice.sqlite3"),
            ))?;
            let document_store = documents::DocumentStore::new(data_dir.join("documents"))?;
            tauri::async_runtime::block_on(document_store.recover(&database))?;
            app.manage(database);
            app.manage(document_store);
            app.manage(chat::RequestRegistry::default());
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::list_projects,
            commands::create_project,
            commands::get_workspace,
            commands::rename_project,
            commands::archive_project,
            commands::create_card,
            commands::create_quote,
            commands::edit_turn,
            commands::delete_turn,
            commands::regenerate_turn,
            commands::search,
            commands::toggle_turn_favorite,
            commands::favorite_turn_ids,
            commands::list_documents,
            commands::list_document_chunks,
            commands::list_document_citations,
            commands::import_document,
            commands::delete_document,
            commands::export_project,
            commands::import_project,
            commands::rename_card,
            commands::list_model_profiles,
            commands::save_model_profile,
            commands::test_model_profile,
            commands::send_message,
            commands::cancel_message
        ])
        .run(tauri::generate_context!())
        .expect("failed to run Lattice");
}
