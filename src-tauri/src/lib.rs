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
        .manage(arduino::ArduinoState::default())
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

            let settings_item = MenuItem::with_id(
                app_handle,
                "app_settings",
                "Settings…",
                true,
                Some("CmdOrCtrl+,"),
            )?;

            // On macOS "Settings…" lives in the app menu (below); everywhere
            // else there's no app menu, so it goes under File.
            #[allow(unused_mut)]
            let mut file_builder = SubmenuBuilder::new(app_handle, "File")
                .item(&new_item)
                .separator()
                .item(&save_item)
                .item(&load_item);
            #[cfg(not(target_os = "macos"))]
            {
                file_builder = file_builder.separator().item(&settings_item);
            }
            let file_menu = file_builder.build()?;

            let test_sketch_item = MenuItem::with_id(
                app_handle,
                "hardware_test",
                "Upload Test Sketch",
                true,
                None::<&str>,
            )?;
            let hardware_menu = SubmenuBuilder::new(app_handle, "Hardware")
                .item(&test_sketch_item)
                .build()?;

            #[cfg(target_os = "macos")]
            let app_menu = SubmenuBuilder::new(app_handle, "BraitenBot GUI")
                .about(Some(AboutMetadata::default()))
                .separator()
                .item(&settings_item)
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
            builder.item(&file_menu).item(&hardware_menu).build()
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
            "hardware_test" => {
                let _ = app_handle.emit("menu://upload-test-sketch", ());
            }
            "app_settings" => {
                let _ = app_handle.emit("menu://settings", ());
            }
            _ => {}
        })
        .invoke_handler(tauri::generate_handler![
            arduino::check_arduino_cli,
            arduino::list_boards,
            arduino::compile_and_upload,
            arduino::upload_test_sketch,
            arduino::cancel_upload,
            arduino::start_serial_monitor,
            arduino::stop_serial_monitor,
            arduino::check_avr_core,
            arduino::install_avr_core,
            arduino::check_driver_issue,
            arduino::install_drivers,
            diagram_io::save_diagram,
            diagram_io::load_diagram,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
