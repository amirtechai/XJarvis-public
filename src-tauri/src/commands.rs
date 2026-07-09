//! Tauri invoke commands callable from JS via `invoke('name', args)`.

use crate::services;
use serde::Serialize;
use tauri::{AppHandle, Manager};

#[derive(Serialize)]
pub struct CommandResult {
    ok: bool,
    message: String,
}

impl CommandResult {
    fn ok(msg: impl Into<String>) -> Self {
        Self { ok: true, message: msg.into() }
    }
}

#[tauri::command]
pub async fn toggle_listening(_app: AppHandle) -> Result<CommandResult, String> {
    // POST to voice service's /toggle (placeholder — wire when voice has the endpoint)
    let _ = post("http://127.0.0.1:8766/toggle").await;
    Ok(CommandResult::ok("listening toggled"))
}

#[tauri::command]
pub async fn pause_agent(_app: AppHandle) -> Result<CommandResult, String> {
    let _ = post("http://127.0.0.1:8767/pause").await;
    Ok(CommandResult::ok("agent paused"))
}

#[tauri::command]
pub async fn resume_agent(_app: AppHandle) -> Result<CommandResult, String> {
    let _ = post("http://127.0.0.1:8767/resume").await;
    Ok(CommandResult::ok("agent resumed"))
}

#[tauri::command]
pub async fn refresh_frontend(app: AppHandle) -> Result<CommandResult, String> {
    if let Some(win) = app.get_webview_window("main") {
        let _ = win.eval("location.reload()");
    }
    Ok(CommandResult::ok("frontend reloaded"))
}

#[tauri::command]
pub async fn restart_services(app: AppHandle) -> Result<CommandResult, String> {
    services::restart_all(&app).await;
    Ok(CommandResult::ok("services restarted"))
}

#[tauri::command]
pub async fn stop_services(app: AppHandle) -> Result<CommandResult, String> {
    services::stop_all(&app).await;
    Ok(CommandResult::ok("services stopped"))
}

#[tauri::command]
pub async fn open_dashboard(app: AppHandle) -> Result<CommandResult, String> {
    if let Some(win) = app.get_webview_window("main") {
        let _ = win.show();
        let _ = win.set_focus();
        let _ = win.eval("window.location.href='/dashboard'");
    }
    Ok(CommandResult::ok("dashboard opened"))
}

#[tauri::command]
pub async fn services_status(_app: AppHandle) -> Result<Vec<services::ServiceState>, String> {
    Ok(services::check_status().await)
}

/// Floating mini orb penceresini aç/kapat (sync helper — hem komut hem tray kullanır).
/// `true` döndürürse açıldı, `false` döndürürse kapatıldı.
pub fn toggle_mini_orb_window(app: &AppHandle, on_top: bool) -> bool {
    use tauri::{WebviewUrl, WebviewWindowBuilder};
    let label = "mini-orb";
    if let Some(win) = app.get_webview_window(label) {
        let _ = win.close();
        return false;
    }
    let result: Result<tauri::WebviewWindow, tauri::Error> =
        WebviewWindowBuilder::new(app, label, WebviewUrl::App("mini-orb/index.html".into()))
            .title("XJarvis")
            .inner_size(320.0, 500.0) // portre — 3D avatar (üst gövde) + chatbox
            .min_inner_size(260.0, 380.0)
            .resizable(true)
            .decorations(false)
            .transparent(true) // çerçevesiz şeffaf — avatar serbest yüzer
            .skip_taskbar(true) // Dock/görev çubuğunda ayrı pencere gibi görünmesin
            .always_on_top(on_top)
            .position(60.0, 80.0)
            .visible(true)
            .disable_drag_drop_handler() // HTML5 drop (File objesi) çalışsın — chatbox'a sürükle-bırak
            .build();
    if let Ok(win) = result {
        let _ = win.set_focus();
    }
    true
}

/// Toggle the floating mini orb window (always-on-top transparent panel).
#[tauri::command]
pub async fn toggle_mini_orb(app: AppHandle, on_top: Option<bool>) -> Result<CommandResult, String> {
    let opened = toggle_mini_orb_window(&app, on_top.unwrap_or(true));
    Ok(CommandResult::ok(if opened { "mini orb opened" } else { "mini orb closed" }))
}

/// Orb penceresini ekranda sürüklemeye başla (JS pointermove eşiği geçince çağrılır).
#[tauri::command]
pub async fn start_orb_drag(app: AppHandle) -> Result<CommandResult, String> {
    if let Some(win) = app.get_webview_window("mini-orb") {
        let _ = win.start_dragging();
    }
    Ok(CommandResult::ok("orb drag started"))
}

#[tauri::command]
pub async fn set_mini_orb_on_top(app: AppHandle, on_top: bool) -> Result<CommandResult, String> {
    if let Some(win) = app.get_webview_window("mini-orb") {
        let _ = win.set_always_on_top(on_top);
    }
    Ok(CommandResult::ok("mini orb on-top toggled"))
}

/// Ana pencereyi minimize et (Dock'a indir) — floating orb aktifken arka plana al.
#[tauri::command]
pub async fn minimize_main_to_dock(app: AppHandle) -> Result<CommandResult, String> {
    if let Some(win) = app.get_webview_window("main") {
        let _ = win.minimize();
    }
    Ok(CommandResult::ok("main minimized"))
}

/// Orb'u tıklama-geçirgen yap (ghost/pasif mod) — görünür kalır ama altındaki
/// uygulamaya tıklamalar geçer, öndeki işe engel olmaz.
#[tauri::command]
pub async fn set_orb_passive(app: AppHandle, passive: bool) -> Result<CommandResult, String> {
    if let Some(win) = app.get_webview_window("mini-orb") {
        let _ = win.set_ignore_cursor_events(passive);
    }
    Ok(CommandResult::ok("orb passive set"))
}

async fn post(url: &str) -> Result<(), reqwest::Error> {
    reqwest::Client::new().post(url).send().await.map(|_| ())
}
