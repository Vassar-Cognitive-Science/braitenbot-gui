use std::fs;
use tauri::AppHandle;
use tauri_plugin_dialog::{DialogExt, FilePath};

/// Opens a native save dialog and writes `contents` to the chosen path.
/// Returns the chosen path, or `Ok(None)` if the user cancels.
#[tauri::command]
pub async fn save_diagram(app: AppHandle, contents: String) -> Result<Option<String>, String> {
    let dialog_app = app.clone();
    let picked: Option<FilePath> = tauri::async_runtime::spawn_blocking(move || {
        dialog_app
            .dialog()
            .file()
            .add_filter("BraitenBot diagram", &["json"])
            .set_file_name("diagram.json")
            .blocking_save_file()
    })
    .await
    .map_err(|e| e.to_string())?;

    let Some(file_path) = picked else {
        return Ok(None);
    };
    let path_buf = file_path.into_path().map_err(|e| e.to_string())?;
    fs::write(&path_buf, contents.as_bytes()).map_err(|e| e.to_string())?;
    Ok(Some(path_buf.to_string_lossy().into_owned()))
}

/// Opens a native open dialog and returns the chosen file's contents as UTF-8.
/// Returns `Ok(None)` if the user cancels.
#[tauri::command]
pub async fn load_diagram(app: AppHandle) -> Result<Option<String>, String> {
    let dialog_app = app.clone();
    let picked: Option<FilePath> = tauri::async_runtime::spawn_blocking(move || {
        dialog_app
            .dialog()
            .file()
            .add_filter("BraitenBot diagram", &["json"])
            .blocking_pick_file()
    })
    .await
    .map_err(|e| e.to_string())?;

    let Some(file_path) = picked else {
        return Ok(None);
    };
    let path_buf = file_path.into_path().map_err(|e| e.to_string())?;
    let contents = fs::read_to_string(&path_buf).map_err(|e| e.to_string())?;
    Ok(Some(contents))
}
