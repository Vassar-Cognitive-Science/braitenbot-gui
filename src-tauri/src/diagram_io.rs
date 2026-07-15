use serde::Serialize;
use std::fs;
use std::path::Path;
use tauri::AppHandle;
use tauri_plugin_dialog::{DialogExt, FilePath};

/// A diagram read from disk, with the path it came from so the frontend can
/// record it in the recent-files list.
#[derive(Serialize)]
pub struct LoadedDiagram {
    pub path: String,
    pub contents: String,
}

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

/// Opens a native open dialog and returns the chosen file's path and contents
/// as UTF-8. Returns `Ok(None)` if the user cancels.
#[tauri::command]
pub async fn load_diagram(app: AppHandle) -> Result<Option<LoadedDiagram>, String> {
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
    Ok(Some(LoadedDiagram {
        path: path_buf.to_string_lossy().into_owned(),
        contents,
    }))
}

/// Reads a diagram file at a known path (the recent-files "click to open"
/// flow — no dialog involved).
#[tauri::command]
pub fn read_diagram(path: String) -> Result<String, String> {
    fs::read_to_string(&path).map_err(|e| e.to_string())
}

/// For the landing page's recent-files list: which of these paths still point
/// at an existing file?
#[tauri::command]
pub fn paths_exist(paths: Vec<String>) -> Vec<bool> {
    paths.iter().map(|p| Path::new(p).is_file()).collect()
}
