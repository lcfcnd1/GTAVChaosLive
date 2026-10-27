use serde::{Deserialize, Serialize};
use std::env;
use std::net::{TcpStream, ToSocketAddrs};
use std::path::PathBuf;
use std::process::Command;
use std::time::Duration;
use tauri::{AppHandle, Manager};
use uuid::Uuid;

#[derive(Debug, Serialize)]
pub struct LocalServicesStatus {
    pub orchestrator: bool,
    pub overlay: bool,
    pub dashboard: bool,
}

#[derive(Debug, Deserialize, Serialize)]
pub struct LocalResourceStatus {
    #[serde(rename = "memoryMb")]
    pub memory_mb: u64,
    #[serde(rename = "processCount")]
    pub process_count: u32,
}

#[derive(Debug, Deserialize, Serialize)]
pub struct LocalGameStatus {
    pub enhanced: bool,
    pub legacy: bool,
    pub path: Option<String>,
}

fn workspace_root(app: &AppHandle) -> PathBuf {
    if let Ok(root) = env::var("GTA_CHAOS_ROOT") {
        return PathBuf::from(root);
    }
    if let Ok(resources) = app.path().resource_dir() {
        if resources.join("tools").join("start-local.ps1").is_file() {
            return resources;
        }
    }
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("..\\..\\..")
}

fn run_local_script(app: &AppHandle, name: &str, arguments: &[&str]) -> Result<String, String> {
    let root = workspace_root(app);
    let token = local_token(app)?;
    let script = root.join("tools").join(name);
    if !script.is_file() {
        return Err(format!(
            "No se encontró el supervisor local: {}",
            script.display()
        ));
    }
    let mut command = Command::new("powershell.exe");
    command
        .args(["-NoProfile", "-ExecutionPolicy", "Bypass", "-File"])
        .arg(&script)
        .args(arguments)
        .current_dir(&root);
    if let Ok(data_dir) = app.path().app_data_dir() {
        std::fs::create_dir_all(&data_dir)
            .map_err(|error| format!("No se pudo preparar AppData: {error}"))?;
        command.env("GTA_CHAOS_DATA", data_dir);
    }
    command.env("CHAOS_TOKEN", token);
    let output = command
        .output()
        .map_err(|error| format!("No se pudo iniciar PowerShell: {error}"))?;
    if output.status.success() {
        Ok(String::from_utf8_lossy(&output.stdout).trim().to_owned())
    } else {
        Err(String::from_utf8_lossy(&output.stderr).trim().to_owned())
    }
}

fn port_open(port: u16) -> bool {
    ("127.0.0.1", port)
        .to_socket_addrs()
        .ok()
        .and_then(|mut addresses| addresses.next())
        .and_then(|address| TcpStream::connect_timeout(&address, Duration::from_millis(250)).ok())
        .is_some()
}

fn local_token(app: &AppHandle) -> Result<String, String> {
    if let Ok(token) = env::var("CHAOS_TOKEN") {
        if !token.trim().is_empty() { return Ok(token.trim().to_owned()); }
    }
    let data_dir = app.path().app_data_dir().map_err(|error| format!("No se pudo resolver AppData: {error}"))?;
    std::fs::create_dir_all(&data_dir).map_err(|error| format!("No se pudo preparar AppData: {error}"))?;
    let token_path = data_dir.join("chaos-live.token");
    if let Ok(token) = std::fs::read_to_string(&token_path) {
        if !token.trim().is_empty() { return Ok(token.trim().to_owned()); }
    }
    let token = Uuid::new_v4().to_string();
    std::fs::write(&token_path, format!("{token}\n")).map_err(|error| format!("No se pudo guardar el token local: {error}"))?;
    Ok(token)
}

mod commands {
    use super::*;

    #[tauri::command]
    pub fn start_local_services(app: AppHandle) -> Result<String, String> {
        run_local_script(&app, "start-local.ps1", &["-Packaged"])
    }

    #[tauri::command]
    pub fn stop_local_services(app: AppHandle) -> Result<String, String> {
        run_local_script(&app, "stop-local.ps1", &[])
    }

    #[tauri::command]
    pub fn start_tiktok_connector(app: AppHandle, username: String) -> Result<String, String> {
        let normalized = username.trim().trim_start_matches('@');
        if normalized.is_empty()
            || normalized.len() > 64
            || !normalized
                .chars()
                .all(|character| character.is_ascii_alphanumeric() || "._-".contains(character))
        {
            return Err("El username de TikTok contiene caracteres no permitidos.".to_owned());
        }
        run_local_script(&app, "start-tiktok.ps1", &["-Username", normalized])
    }

    #[tauri::command]
    pub fn stop_tiktok_connector(app: AppHandle) -> Result<String, String> {
        run_local_script(&app, "stop-tiktok.ps1", &[])
    }

    #[tauri::command]
    pub fn profile_operation(app: AppHandle, operation: String, file: String) -> Result<String, String> {
        if !["export", "import", "backup"].contains(&operation.as_str()) {
            return Err("Operación de perfil no permitida.".to_owned());
        }
        if file.trim().is_empty() {
            return Err("Indique una ruta de archivo para la operación de perfil.".to_owned());
        }
        let root = workspace_root(&app);
        let node = root.join("runtime").join("node.exe");
        let cli = root.join("runtime").join("profile-cli.cjs");
        if !node.is_file() || !cli.is_file() {
            return Err("No se encontró el runtime de perfiles; regenere el bundle local.".to_owned());
        }
        let data_dir = app.path().app_data_dir().unwrap_or_else(|_| root.join("data"));
        std::fs::create_dir_all(&data_dir).map_err(|error| format!("No se pudo preparar AppData: {error}"))?;
        let output = Command::new(node)
            .arg(&cli)
            .arg(operation)
            .arg(file.trim())
            .current_dir(&root)
            .env("CHAOS_DB", data_dir.join("chaos-live.db"))
            .output()
            .map_err(|error| format!("No se pudo ejecutar la operación de perfil: {error}"))?;
        if output.status.success() {
            Ok(String::from_utf8_lossy(&output.stdout).trim().to_owned())
        } else {
            Err(String::from_utf8_lossy(&output.stderr).trim().to_owned())
        }
    }

    #[tauri::command]
    pub fn local_services_status() -> LocalServicesStatus {
        LocalServicesStatus {
            orchestrator: port_open(39177),
            overlay: port_open(39178),
            dashboard: true,
        }
    }

    #[tauri::command]
    pub fn local_auth_token(app: AppHandle) -> Result<String, String> {
        local_token(&app)
    }

    #[tauri::command]
    pub fn local_resource_status() -> Result<LocalResourceStatus, String> {
        let script = "$names = @('node','python','gta-chaos-live'); $processes = @(Get-Process -Name $names -ErrorAction SilentlyContinue); [pscustomobject]@{ memoryMb = [math]::Round((($processes | Measure-Object -Property WorkingSet64 -Sum).Sum / 1MB), 1); processCount = $processes.Count } | ConvertTo-Json -Compress";
        let output = Command::new("powershell.exe")
            .args(["-NoProfile", "-Command", script])
            .output()
            .map_err(|error| format!("No se pudo consultar recursos locales: {error}"))?;
        if !output.status.success() {
            return Err(String::from_utf8_lossy(&output.stderr).trim().to_owned());
        }
        serde_json::from_slice(&output.stdout)
            .map_err(|error| format!("Respuesta de recursos inválida: {error}"))
    }

    #[tauri::command]
    pub fn local_game_status() -> Result<LocalGameStatus, String> {
        let script = "$enhanced = @(Get-Process -Name 'GTA5_Enhanced' -ErrorAction SilentlyContinue); $legacy = @(Get-Process -Name 'GTA5' -ErrorAction SilentlyContinue); $selected = @($enhanced + $legacy) | Select-Object -First 1; $path = $null; if ($selected) { try { $path = $selected.MainModule.FileName } catch { $path = $null } }; [pscustomobject]@{ enhanced = [bool]$enhanced.Count; legacy = [bool]$legacy.Count; path = $path } | ConvertTo-Json -Compress";
        let output = Command::new("powershell.exe")
            .args(["-NoProfile", "-Command", script])
            .output()
            .map_err(|error| format!("No se pudo consultar GTA: {error}"))?;
        if !output.status.success() {
            return Err(String::from_utf8_lossy(&output.stderr).trim().to_owned());
        }
        serde_json::from_slice(&output.stdout)
            .map_err(|error| format!("Respuesta de GTA inválida: {error}"))
    }

    #[tauri::command]
    pub fn run_diagnostic(app: AppHandle) -> Result<String, String> {
        let root = workspace_root(&app);
        let script = root.join("installer").join("diagnose.ps1");
        if !script.is_file() {
            return Err(format!("No se encontró el diagnóstico: {}", script.display()));
        }
        let output = Command::new("powershell.exe")
            .args(["-NoProfile", "-ExecutionPolicy", "Bypass", "-File"])
            .arg(script)
            .current_dir(root)
            .output()
            .map_err(|error| format!("No se pudo ejecutar el diagnóstico: {error}"))?;
        if !output.status.success() {
            return Err(String::from_utf8_lossy(&output.stderr).trim().to_owned());
        }
        Ok(String::from_utf8_lossy(&output.stdout).trim().to_owned())
    }

    #[tauri::command]
    pub fn install_mod(
        app: AppHandle,
        gta_path: String,
        consent: String,
        allow_overwrite: bool,
    ) -> Result<String, String> {
        if gta_path.trim().is_empty() {
            return Err("Indique la ruta de GTA V Enhanced antes de instalar.".to_owned());
        }
        if consent != "I UNDERSTAND STORY MODE ONLY" {
            return Err("La instalación requiere el consentimiento exacto de Story Mode.".to_owned());
        }
        let root = workspace_root(&app);
        let token = local_token(&app)?;
        let script = root.join("installer").join("install-mod.ps1");
        if !script.is_file() {
            return Err(format!("No se encontró el instalador del mod: {}", script.display()));
        }
        let mut command = Command::new("powershell.exe");
        command
            .args(["-NoProfile", "-ExecutionPolicy", "Bypass", "-File"])
            .arg(script)
            .args(["-GtaPath", gta_path.trim(), "-Consent", consent.as_str()])
            .current_dir(root);
        if allow_overwrite {
            command.arg("-AllowOverwrite");
        }
        command.arg("-ChaosToken").arg(token);
        let output = command
            .output()
            .map_err(|error| format!("No se pudo iniciar el instalador del mod: {error}"))?;
        if output.status.success() {
            Ok(String::from_utf8_lossy(&output.stdout).trim().to_owned())
        } else {
            Err(String::from_utf8_lossy(&output.stderr).trim().to_owned())
        }
    }

    #[tauri::command]
    pub fn uninstall_mod(
        app: AppHandle,
        gta_path: String,
        consent: String,
    ) -> Result<String, String> {
        if gta_path.trim().is_empty() {
            return Err("Indique la ruta de GTA V Enhanced antes de desinstalar.".to_owned());
        }
        if consent != "I UNDERSTAND STORY MODE ONLY" {
            return Err("La desinstalación requiere el consentimiento exacto de Story Mode.".to_owned());
        }
        let root = workspace_root(&app);
        let script = root.join("installer").join("uninstall-mod.ps1");
        if !script.is_file() {
            return Err(format!("No se encontró el desinstalador del mod: {}", script.display()));
        }
        let output = Command::new("powershell.exe")
            .args(["-NoProfile", "-ExecutionPolicy", "Bypass", "-File"])
            .arg(script)
            .args(["-GtaPath", gta_path.trim(), "-Consent", consent.as_str()])
            .current_dir(root)
            .output()
            .map_err(|error| format!("No se pudo iniciar el desinstalador del mod: {error}"))?;
        if output.status.success() {
            Ok(String::from_utf8_lossy(&output.stdout).trim().to_owned())
        } else {
            Err(String::from_utf8_lossy(&output.stderr).trim().to_owned())
        }
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![
            commands::start_local_services,
            commands::stop_local_services,
            commands::start_tiktok_connector,
            commands::stop_tiktok_connector,
            commands::profile_operation,
            commands::local_services_status,
            commands::local_auth_token,
            commands::local_resource_status,
            commands::local_game_status,
            commands::run_diagnostic,
            commands::install_mod,
            commands::uninstall_mod
        ])
        .run(tauri::generate_context!())
        .expect("error while running GTA Chaos Live");
}
