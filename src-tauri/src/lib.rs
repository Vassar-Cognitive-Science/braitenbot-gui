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

            // On macOS "Settings…" stays in the app menu (below) per platform
            // convention. Windows/Linux reach settings through the in-app gear
            // button instead, so it's no longer added to the File menu here.
            #[cfg(target_os = "macos")]
            let settings_item = MenuItem::with_id(
                app_handle,
                "app_settings",
                "Settings…",
                true,
                Some("CmdOrCtrl+,"),
            )?;

            let file_menu = SubmenuBuilder::new(app_handle, "File")
                .item(&new_item)
                .separator()
                .item(&save_item)
                .item(&load_item)
                .build()?;

            let view_home_item = MenuItem::with_id(
                app_handle,
                "view_home",
                "Go to Main View",
                true,
                Some("CmdOrCtrl+0"),
            )?;
            let view_check_item = MenuItem::with_id(
                app_handle,
                "view_check",
                "Check for Errors / Warnings",
                true,
                None::<&str>,
            )?;
            let view_menu = SubmenuBuilder::new(app_handle, "View")
                .item(&view_home_item)
                .item(&view_check_item)
                .build()?;

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
            builder
                .item(&file_menu)
                .item(&view_menu)
                .item(&hardware_menu)
                .build()
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
            "view_home" => {
                let _ = app_handle.emit("menu://view-home", ());
            }
            "view_check" => {
                let _ = app_handle.emit("menu://view-check", ());
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
            arduino::write_serial,
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
