use serde::{Deserialize, Serialize};
use std::fs;
use tauri::{AppHandle, Emitter};
use tauri_plugin_shell::process::CommandEvent;
use tauri_plugin_shell::ShellExt;

/// Event name used to stream arduino-cli install progress to the frontend.
const INSTALL_LOG_EVENT: &str = "arduino-install-log";

#[derive(Debug, thiserror::Error, Serialize)]
pub enum ArduinoError {
    #[error("arduino-cli sidecar is missing. Run `npm run fetch:arduino-cli` and rebuild.")]
    SidecarMissing,
    #[error("arduino-cli failed: {0}")]
    CliFailed(String),
    #[error("I/O error: {0}")]
    Io(String),
    #[error("Failed to parse arduino-cli output: {0}")]
    Parse(String),
}

impl From<std::io::Error> for ArduinoError {
    fn from(e: std::io::Error) -> Self {
        ArduinoError::Io(e.to_string())
    }
}

pub type ArduinoResult<T> = Result<T, ArduinoError>;

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct BoardInfo {
    pub port: String,
    pub protocol: String,
    pub name: Option<String>,
    pub fqbn: Option<String>,
}

#[derive(Debug, Serialize)]
pub struct UploadResult {
    pub success: bool,
    pub compile_output: String,
    pub upload_output: String,
}

/// Runs the bundled arduino-cli sidecar with the given arguments.
/// Returns (stdout, stderr, success).
async fn run_sidecar(app: &AppHandle, args: &[&str]) -> ArduinoResult<(String, String, bool)> {
    let command = app
        .shell()
        .sidecar("arduino-cli")
        .map_err(|_| ArduinoError::SidecarMissing)?
        .args(args);

    let output = command
        .output()
        .await
        .map_err(|e| ArduinoError::CliFailed(e.to_string()))?;

    Ok((
        String::from_utf8_lossy(&output.stdout).to_string(),
        String::from_utf8_lossy(&output.stderr).to_string(),
        output.status.success(),
    ))
}

/// Quick health check: returns the arduino-cli version string.
#[tauri::command]
pub async fn check_arduino_cli(app: AppHandle) -> ArduinoResult<String> {
    let (stdout, stderr, success) = run_sidecar(&app, &["version"]).await?;
    if !success {
        return Err(ArduinoError::CliFailed(stderr));
    }
    Ok(stdout.trim().to_string())
}

/// Lists connected boards detected by arduino-cli.
#[tauri::command]
pub async fn list_boards(app: AppHandle) -> ArduinoResult<Vec<BoardInfo>> {
    let (stdout, stderr, success) =
        run_sidecar(&app, &["board", "list", "--format", "json"]).await?;
    if !success {
        return Err(ArduinoError::CliFailed(stderr));
    }

    // arduino-cli 1.x returns: { "detected_ports": [ { "port": {...}, "matching_boards": [...] } ] }
    let parsed: serde_json::Value = serde_json::from_str(&stdout)
        .map_err(|e| ArduinoError::Parse(format!("{}: {}", e, stdout)))?;

    let empty = vec![];
    let ports = parsed
        .get("detected_ports")
        .and_then(|v| v.as_array())
        .unwrap_or(&empty);

    let mut boards = Vec::new();
    for entry in ports {
        let port_obj = entry.get("port");
        let address = port_obj
            .and_then(|p| p.get("address"))
            .and_then(|a| a.as_str())
            .unwrap_or("")
            .to_string();
        let protocol = port_obj
            .and_then(|p| p.get("protocol"))
            .and_then(|a| a.as_str())
            .unwrap_or("serial")
            .to_string();

        let matching = entry
            .get("matching_boards")
            .and_then(|m| m.as_array())
            .cloned()
            .unwrap_or_default();

        if matching.is_empty() {
            if !address.is_empty() {
                boards.push(BoardInfo {
                    port: address,
                    protocol,
                    name: None,
                    fqbn: None,
                });
            }
        } else {
            for m in matching {
                boards.push(BoardInfo {
                    port: address.clone(),
                    protocol: protocol.clone(),
                    name: m.get("name").and_then(|v| v.as_str()).map(String::from),
                    fqbn: m.get("fqbn").and_then(|v| v.as_str()).map(String::from),
                });
            }
        }
    }

    Ok(boards)
}

/// Writes the provided sketch source to a temp directory, compiles it, and
/// uploads it to the given port with the given FQBN (fully qualified board name).
#[tauri::command]
pub async fn compile_and_upload(
    app: AppHandle,
    sketch_source: String,
    fqbn: String,
    port: String,
) -> ArduinoResult<UploadResult> {
    // Create a temporary sketch directory: <tmp>/braitenbot_sketch/braitenbot_sketch.ino
    let mut sketch_dir = std::env::temp_dir();
    sketch_dir.push("braitenbot_sketch");
    fs::create_dir_all(&sketch_dir)?;

    let mut sketch_file = sketch_dir.clone();
    sketch_file.push("braitenbot_sketch.ino");
    fs::write(&sketch_file, sketch_source)?;

    let sketch_dir_str = sketch_dir
        .to_str()
        .ok_or_else(|| ArduinoError::Io("Sketch path is not valid UTF-8".into()))?
        .to_string();

    // Step 1: compile
    let (compile_stdout, compile_stderr, compile_ok) =
        run_sidecar(&app, &["compile", "--fqbn", &fqbn, &sketch_dir_str]).await?;
    let compile_output = format!("{}{}", compile_stdout, compile_stderr);
    if !compile_ok {
        return Ok(UploadResult {
            success: false,
            compile_output,
            upload_output: String::new(),
        });
    }

    // Step 2: upload
    let (upload_stdout, upload_stderr, upload_ok) = run_sidecar(
        &app,
        &["upload", "-p", &port, "--fqbn", &fqbn, &sketch_dir_str],
    )
    .await?;
    let upload_output = format!("{}{}", upload_stdout, upload_stderr);

    Ok(UploadResult {
        success: upload_ok,
        compile_output,
        upload_output,
    })
}

/// Cores we require to cover the supported boards:
///   - arduino:avr         — classic UNO / Nano (AVR)
///   - arduino:renesas_uno — UNO R4 Minima / WiFi (Renesas RA4M1)
const REQUIRED_CORES: &[&str] = &["arduino:avr", "arduino:renesas_uno"];

/// Returns true when every required board core is installed. Required before
/// we can compile/upload sketches for the classic UNO or the UNO R4.
#[tauri::command]
pub async fn check_avr_core(app: AppHandle) -> ArduinoResult<bool> {
    let (stdout, stderr, success) =
        run_sidecar(&app, &["core", "list", "--format", "json"]).await?;
    if !success {
        return Err(ArduinoError::CliFailed(stderr));
    }

    // arduino-cli 1.x typically returns either { "platforms": [...] } or a
    // bare array depending on version. Handle both defensively.
    let parsed: serde_json::Value = serde_json::from_str(&stdout)
        .map_err(|e| ArduinoError::Parse(format!("{}: {}", e, stdout)))?;

    let empty = vec![];
    let platforms = parsed
        .get("platforms")
        .and_then(|v| v.as_array())
        .or_else(|| parsed.as_array())
        .unwrap_or(&empty);

    let installed_ids: Vec<&str> = platforms
        .iter()
        .filter_map(|p| p.get("id").and_then(|v| v.as_str()))
        .collect();

    let all_installed = REQUIRED_CORES
        .iter()
        .all(|core| installed_ids.contains(core));

    Ok(all_installed)
}

/// Runs arduino-cli with the given args and streams stdout/stderr to the
/// frontend as `arduino-install-log` events. Returns once the process exits.
async fn stream_sidecar(app: &AppHandle, args: &[&str]) -> ArduinoResult<()> {
    let (mut rx, _child) = app
        .shell()
        .sidecar("arduino-cli")
        .map_err(|_| ArduinoError::SidecarMissing)?
        .args(args)
        .spawn()
        .map_err(|e| ArduinoError::CliFailed(e.to_string()))?;

    while let Some(event) = rx.recv().await {
        match event {
            CommandEvent::Stdout(line) | CommandEvent::Stderr(line) => {
                let text = String::from_utf8_lossy(&line).to_string();
                let _ = app.emit(INSTALL_LOG_EVENT, text);
            }
            CommandEvent::Error(err) => {
                return Err(ArduinoError::CliFailed(err));
            }
            CommandEvent::Terminated(payload) => {
                if payload.code != Some(0) {
                    return Err(ArduinoError::CliFailed(format!(
                        "arduino-cli exited with code {:?}",
                        payload.code
                    )));
                }
                break;
            }
            _ => {}
        }
    }
    Ok(())
}

/// Installs every core in REQUIRED_CORES (classic AVR + Renesas UNO R4).
/// Streams progress back to the frontend via `arduino-install-log` events.
/// Blocks until installation completes or fails.
#[tauri::command]
pub async fn install_avr_core(app: AppHandle) -> ArduinoResult<()> {
    let _ = app.emit(
        INSTALL_LOG_EVENT,
        "→ Updating package index...\n".to_string(),
    );
    stream_sidecar(&app, &["core", "update-index"]).await?;

    for core in REQUIRED_CORES {
        let _ = app.emit(
            INSTALL_LOG_EVENT,
            format!("\n→ Installing {} core (this may take a few minutes)...\n", core),
        );
        stream_sidecar(&app, &["core", "install", core]).await?;
    }

    let _ = app.emit(
        INSTALL_LOG_EVENT,
        "\n✓ Arduino toolchains ready.\n".to_string(),
    );
    Ok(())
}
