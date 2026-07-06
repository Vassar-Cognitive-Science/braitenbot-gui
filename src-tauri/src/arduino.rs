use serde::{Deserialize, Serialize};
use std::fs;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;
use tauri::{AppHandle, Emitter, State};
use tauri_plugin_shell::process::{CommandChild, CommandEvent};
use tauri_plugin_shell::ShellExt;

/// Event name used to stream arduino-cli install progress to the frontend.
const INSTALL_LOG_EVENT: &str = "arduino-install-log";

/// Event name used to signal the compile→upload phase transition. Payload is
/// the phase string (currently only `"uploading"`).
const UPLOAD_PHASE_EVENT: &str = "arduino-upload-phase";

/// Event name used to stream a line of serial-monitor output to the frontend.
/// Payload is the raw text chunk (typically one line).
const SERIAL_MONITOR_LINE_EVENT: &str = "serial-monitor-line";

/// Event name emitted when the serial-monitor child exits (board unplugged,
/// killed for an upload, or arduino-cli quit) so the UI can show disconnection.
const SERIAL_MONITOR_CLOSED_EVENT: &str = "serial-monitor-closed";

/// Managed state shared across arduino-cli commands.
///
/// - `upload_child` holds the currently running compile/upload child so
///   `cancel_upload` can kill a wedged flow.
/// - `installing` is a re-entrancy guard so `install_avr_core` cannot run
///   twice concurrently.
/// - `monitor_child` holds the running `arduino-cli monitor` child so
///   `stop_serial_monitor` (and the port-conflict pause before an upload) can
///   release the serial port.
#[derive(Default)]
pub struct ArduinoState {
    pub upload_child: Mutex<Option<CommandChild>>,
    pub installing: AtomicBool,
    pub monitor_child: Mutex<Option<CommandChild>>,
}

#[derive(Debug, thiserror::Error)]
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

impl serde::Serialize for ArduinoError {
    fn serialize<S: serde::Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        serializer.serialize_str(&self.to_string())
    }
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

/// Like `run_sidecar`, but spawns the process and stores its kill handle in
/// `ArduinoState::upload_child` so `cancel_upload` can terminate a wedged run.
/// Accumulates stdout/stderr and returns (stdout, stderr, success). A channel
/// that closes without a `Terminated` event (e.g. the child was killed) is
/// reported as `success = false`.
async fn run_sidecar_cancellable(
    app: &AppHandle,
    state: &ArduinoState,
    args: &[&str],
) -> ArduinoResult<(String, String, bool)> {
    let (mut rx, child) = app
        .shell()
        .sidecar("arduino-cli")
        .map_err(|_| ArduinoError::SidecarMissing)?
        .args(args)
        .spawn()
        .map_err(|e| ArduinoError::CliFailed(e.to_string()))?;

    // Store the kill handle so cancel_upload can reach it. Scoped so the guard
    // is never held across an await point.
    {
        let mut guard = state.upload_child.lock().unwrap();
        *guard = Some(child);
    }

    let mut stdout = String::new();
    let mut stderr = String::new();
    let mut success = false;
    let mut terminated = false;

    while let Some(event) = rx.recv().await {
        match event {
            CommandEvent::Stdout(line) => {
                stdout.push_str(&String::from_utf8_lossy(&line));
            }
            CommandEvent::Stderr(line) => {
                stderr.push_str(&String::from_utf8_lossy(&line));
            }
            CommandEvent::Error(err) => {
                let _ = state.upload_child.lock().unwrap().take();
                return Err(ArduinoError::CliFailed(err));
            }
            CommandEvent::Terminated(payload) => {
                success = payload.code == Some(0);
                terminated = true;
                break;
            }
            _ => {}
        }
    }

    // Clear the stored handle whether the run finished or was cancelled. If the
    // handle was already taken (by cancel_upload) this is a no-op.
    let _ = state.upload_child.lock().unwrap().take();

    if !terminated {
        // Channel closed without a Terminated event — treat as a failed run.
        return Ok((stdout, stderr, false));
    }

    Ok((stdout, stderr, success))
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

/// Compiles a sketch directory and, if compilation succeeds, uploads it to the
/// given port. Shared by `compile_and_upload` (generated diagrams) and
/// `upload_test_sketch` (the bundled hardware bring-up test).
async fn build_and_flash(
    app: &AppHandle,
    state: &ArduinoState,
    sketch_dir: &str,
    fqbn: &str,
    port: &str,
) -> ArduinoResult<UploadResult> {
    // Step 1: compile
    let (compile_stdout, compile_stderr, compile_ok) =
        run_sidecar_cancellable(app, state, &["compile", "--fqbn", fqbn, sketch_dir]).await?;
    let compile_output = format!("{}{}", compile_stdout, compile_stderr);
    if !compile_ok {
        return Ok(UploadResult {
            success: false,
            compile_output,
            upload_output: String::new(),
        });
    }

    // Signal the frontend that we've moved from compile → upload so the UI can
    // show accurate phase feedback (upload can take minutes on UNO R4).
    let _ = app.emit(UPLOAD_PHASE_EVENT, "uploading");

    // Step 2: upload
    let (upload_stdout, upload_stderr, upload_ok) =
        run_sidecar_cancellable(app, state, &["upload", "-p", port, "--fqbn", fqbn, sketch_dir])
            .await?;
    let upload_output = format!("{}{}", upload_stdout, upload_stderr);

    Ok(UploadResult {
        success: upload_ok,
        compile_output,
        upload_output,
    })
}

/// Writes the provided sketch source to a temp directory, compiles it, and
/// uploads it to the given port with the given FQBN (fully qualified board name).
#[tauri::command]
pub async fn compile_and_upload(
    app: AppHandle,
    state: State<'_, ArduinoState>,
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
        .ok_or_else(|| ArduinoError::Io("Sketch path is not valid UTF-8".into()))?;

    build_and_flash(&app, state.inner(), sketch_dir_str, &fqbn, &port).await
}

// The standalone hardware bring-up test sketch (see hardware-test/ in the repo),
// embedded at build time so the in-app copy is always identical to the one a
// user can open directly in the Arduino IDE.
const TEST_SKETCH_INO: &str = include_str!("../../hardware-test/hardware-test.ino");
const TEST_SKETCH_CONFIG: &str = include_str!("../../hardware-test/config.h");

/// Writes the bundled hardware bring-up test sketch to a temp directory and
/// compiles + uploads it to the given board. Exercises every device in the
/// default BraitenBot build (sensors, display, servos) so a freshly assembled
/// robot can be checked without designing a diagram first.
#[tauri::command]
pub async fn upload_test_sketch(
    app: AppHandle,
    state: State<'_, ArduinoState>,
    fqbn: String,
    port: String,
) -> ArduinoResult<UploadResult> {
    // <tmp>/braitenbot_hardware_test/{braitenbot_hardware_test.ino, config.h}
    // (arduino-cli requires the .ino basename to match the sketch folder name).
    let mut sketch_dir = std::env::temp_dir();
    sketch_dir.push("braitenbot_hardware_test");
    fs::create_dir_all(&sketch_dir)?;

    let mut ino_file = sketch_dir.clone();
    ino_file.push("braitenbot_hardware_test.ino");
    fs::write(&ino_file, TEST_SKETCH_INO)?;

    let mut config_file = sketch_dir.clone();
    config_file.push("config.h");
    fs::write(&config_file, TEST_SKETCH_CONFIG)?;

    let sketch_dir_str = sketch_dir
        .to_str()
        .ok_or_else(|| ArduinoError::Io("Sketch path is not valid UTF-8".into()))?;

    build_and_flash(&app, state.inner(), sketch_dir_str, &fqbn, &port).await
}

/// Cancels an in-flight compile/upload by killing the arduino-cli child, if any
/// is running. A no-op when nothing is in progress.
#[tauri::command]
pub fn cancel_upload(state: State<'_, ArduinoState>) -> ArduinoResult<()> {
    let child = state.upload_child.lock().unwrap().take();
    if let Some(child) = child {
        child
            .kill()
            .map_err(|e| ArduinoError::CliFailed(e.to_string()))?;
    }
    Ok(())
}

/// Kills the running serial-monitor child, if any, and clears its slot.
/// Shared by `stop_serial_monitor` and the restart path in
/// `start_serial_monitor`. A no-op when no monitor is running.
fn kill_monitor_child(state: &ArduinoState) -> ArduinoResult<()> {
    let child = state.monitor_child.lock().unwrap().take();
    if let Some(child) = child {
        child
            .kill()
            .map_err(|e| ArduinoError::CliFailed(e.to_string()))?;
    }
    Ok(())
}

/// Opens `arduino-cli monitor` on the given port at 115200 baud (the rate every
/// generated sketch and the hardware-test sketch use) and streams each output
/// line to the frontend as `serial-monitor-line` events. Returns as soon as the
/// monitor is spawned; the stream is pumped by a background task. When the child
/// exits — unplugged, killed for an upload, or arduino-cli quitting — a
/// `serial-monitor-closed` event is emitted so the UI can reflect the drop.
///
/// If a monitor is already running it is stopped first, so only one child ever
/// holds the port. Only one monitor process runs at a time.
#[tauri::command]
pub async fn start_serial_monitor(
    app: AppHandle,
    state: State<'_, ArduinoState>,
    port: String,
) -> ArduinoResult<()> {
    // Release any monitor already holding the port before opening a new one.
    kill_monitor_child(state.inner())?;

    let (mut rx, child) = app
        .shell()
        .sidecar("arduino-cli")
        .map_err(|_| ArduinoError::SidecarMissing)?
        .args([
            "monitor",
            "-p",
            &port,
            "--config",
            "baudrate=115200",
            "--quiet",
        ])
        .spawn()
        .map_err(|e| ArduinoError::CliFailed(e.to_string()))?;

    // Store the kill handle so stop_serial_monitor (or an upload) can reach it.
    {
        let mut guard = state.monitor_child.lock().unwrap();
        *guard = Some(child);
    }

    // Pump the stream in the background so this command can return immediately
    // while the monitor keeps running across the app's lifetime.
    let app_handle = app.clone();
    tauri::async_runtime::spawn(async move {
        while let Some(event) = rx.recv().await {
            match event {
                CommandEvent::Stdout(line) | CommandEvent::Stderr(line) => {
                    let text = String::from_utf8_lossy(&line).to_string();
                    let _ = app_handle.emit(SERIAL_MONITOR_LINE_EVENT, text);
                }
                CommandEvent::Terminated(_) | CommandEvent::Error(_) => break,
                _ => {}
            }
        }
        let _ = app_handle.emit(SERIAL_MONITOR_CLOSED_EVENT, ());
    });

    Ok(())
}

/// Stops the running serial monitor, releasing the port. A no-op when no
/// monitor is running. The background stream task emits `serial-monitor-closed`
/// once the child exits.
#[tauri::command]
pub fn stop_serial_monitor(state: State<'_, ArduinoState>) -> ArduinoResult<()> {
    kill_monitor_child(state.inner())
}

/// Cores we require to cover the supported boards:
///   - arduino:avr         — classic UNO / Nano (AVR)
///   - arduino:renesas_uno — UNO R4 Minima / WiFi (Renesas RA4M1)
const REQUIRED_CORES: &[&str] = &["arduino:avr", "arduino:renesas_uno"];

/// Third-party Arduino libraries we require for generated sketches:
///   - Servo  — Arduino's official Servo library (not bundled with arduino-cli,
///              required by motor/servo node codegen)
///   - TM1637 — Avishay Orpaz's driver for 4-digit 7-segment displays
///   - STM32duino VL53L4CD — STMicroelectronics' driver for the VL53L4CD
///                           time-of-flight distance sensor (ToF Distance node)
const REQUIRED_LIBS: &[&str] = &["Servo", "TM1637", "STM32duino VL53L4CD"];

async fn check_installed_libs(app: &AppHandle) -> ArduinoResult<bool> {
    let (stdout, stderr, success) =
        run_sidecar(app, &["lib", "list", "--format", "json"]).await?;
    if !success {
        return Err(ArduinoError::CliFailed(stderr));
    }

    let parsed: serde_json::Value = serde_json::from_str(&stdout)
        .map_err(|e| ArduinoError::Parse(format!("{}: {}", e, stdout)))?;

    let empty = vec![];
    let entries = parsed
        .get("installed_libraries")
        .and_then(|v| v.as_array())
        .or_else(|| parsed.as_array())
        .unwrap_or(&empty);

    let installed_names: Vec<&str> = entries
        .iter()
        .filter_map(|entry| {
            entry
                .get("library")
                .and_then(|lib| lib.get("name"))
                .and_then(|n| n.as_str())
        })
        .collect();

    Ok(REQUIRED_LIBS
        .iter()
        .all(|name| installed_names.contains(name)))
}

/// Returns true when every required board core and third-party library is
/// installed. The name is kept for frontend compatibility even though the
/// check now also covers user libraries (TM1637, etc.).
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

    let cores_installed = REQUIRED_CORES
        .iter()
        .all(|core| installed_ids.contains(core));

    if !cores_installed {
        return Ok(false);
    }

    check_installed_libs(&app).await
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

    let mut terminated_ok = false;
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
                terminated_ok = true;
                break;
            }
            _ => {}
        }
    }
    // A channel that closes without a clean Terminated event means the process
    // died silently — do not report that as success.
    if !terminated_ok {
        return Err(ArduinoError::CliFailed(
            "arduino-cli exited unexpectedly before completing.".to_string(),
        ));
    }
    Ok(())
}

/// Installs every core in REQUIRED_CORES (classic AVR + Renesas UNO R4).
/// Streams progress back to the frontend via `arduino-install-log` events.
/// Blocks until installation completes or fails.
#[tauri::command]
pub async fn install_avr_core(app: AppHandle, state: State<'_, ArduinoState>) -> ArduinoResult<()> {
    // Re-entrancy guard: refuse to start a second install while one is running.
    if state.installing.swap(true, Ordering::SeqCst) {
        return Err(ArduinoError::CliFailed(
            "An install is already in progress.".to_string(),
        ));
    }
    let result = install_avr_core_inner(&app).await;
    state.installing.store(false, Ordering::SeqCst);
    result
}

/// The actual install work, wrapped by `install_avr_core`'s re-entrancy guard.
async fn install_avr_core_inner(app: &AppHandle) -> ArduinoResult<()> {
    let _ = app.emit(
        INSTALL_LOG_EVENT,
        "→ Updating package index...\n".to_string(),
    );
    stream_sidecar(app, &["core", "update-index"]).await?;

    for core in REQUIRED_CORES {
        let _ = app.emit(
            INSTALL_LOG_EVENT,
            format!("\n→ Installing {} core (this may take a few minutes)...\n", core),
        );
        stream_sidecar(app, &["core", "install", core]).await?;
    }

    let _ = app.emit(
        INSTALL_LOG_EVENT,
        "\n→ Updating library index...\n".to_string(),
    );
    stream_sidecar(app, &["lib", "update-index"]).await?;

    for lib in REQUIRED_LIBS {
        let _ = app.emit(
            INSTALL_LOG_EVENT,
            format!("\n→ Installing {} library...\n", lib),
        );
        stream_sidecar(app, &["lib", "install", lib]).await?;
    }

    let _ = app.emit(
        INSTALL_LOG_EVENT,
        "\n✓ Arduino toolchains ready.\n".to_string(),
    );
    Ok(())
}
