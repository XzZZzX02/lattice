pub mod commands;
pub mod db;
pub mod models;

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
            app.manage(database);
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::list_projects,
            commands::create_project,
            commands::get_workspace,
            commands::rename_project,
            commands::archive_project
        ])
        .run(tauri::generate_context!())
        .expect("failed to run Lattice");
}
