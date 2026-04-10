mod arduino;
mod diagram_io;

use tauri::menu::{MenuBuilder, MenuItem, SubmenuBuilder};
use tauri::Emitter;

#[cfg(target_os = "macos")]
use tauri::menu::AboutMetadata;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_shell::init())
        .menu(|app_handle| {
            let new_item = MenuItem::with_id(
                app_handle,
                "diagram_new",
                "New Diagram",
                true,
                Some("CmdOrCtrl+N"),
            )?;
            let save_item = MenuItem::with_id(
                app_handle,
                "diagram_save",
                "Save…",
                true,
                Some("CmdOrCtrl+S"),
            )?;
            let load_item = MenuItem::with_id(
                app_handle,
                "diagram_load",
                "Load…",
                true,
                Some("CmdOrCtrl+O"),
            )?;

            let file_menu = SubmenuBuilder::new(app_handle, "File")
                .item(&new_item)
                .separator()
                .item(&save_item)
                .item(&load_item)
                .build()?;

            #[cfg(target_os = "macos")]
            let app_menu = SubmenuBuilder::new(app_handle, "BraitenBot GUI")
                .about(Some(AboutMetadata::default()))
                .separator()
                .services()
                .separator()
                .hide()
                .hide_others()
                .show_all()
                .separator()
                .quit()
                .build()?;

            #[allow(unused_mut)]
            let mut builder = MenuBuilder::new(app_handle);
            #[cfg(target_os = "macos")]
            {
                builder = builder.item(&app_menu);
            }
            builder.item(&file_menu).build()
        })
        .on_menu_event(|app_handle, event| match event.id().as_ref() {
            "diagram_new" => {
                let _ = app_handle.emit("menu://new", ());
            }
            "diagram_save" => {
                let _ = app_handle.emit("menu://save", ());
            }
            "diagram_load" => {
                let _ = app_handle.emit("menu://load", ());
            }
            _ => {}
        })
        .invoke_handler(tauri::generate_handler![
            arduino::check_arduino_cli,
            arduino::list_boards,
            arduino::compile_and_upload,
            arduino::check_avr_core,
            arduino::install_avr_core,
            diagram_io::save_diagram,
            diagram_io::load_diagram,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
