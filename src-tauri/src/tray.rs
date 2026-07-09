use std::sync::Mutex;
use tauri::{
    image::Image,
    menu::{CheckMenuItem, Menu, MenuItem, PredefinedMenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    AppHandle, Manager,
};

const TRAY_ICON_BYTES: &[u8] = include_bytes!("../icons/tray-template@2x.png");
const MINI_ICON_BYTES: &[u8] = include_bytes!("../icons/mini-orb-template@2x.png");

const BACKEND: &str = "http://127.0.0.1:3001";
const VOICE: &str = "http://127.0.0.1:8766";

pub struct TrayHandles {
    pub jarvis: CheckMenuItem<tauri::Wry>,
    pub camera: CheckMenuItem<tauri::Wry>,
    pub mic: CheckMenuItem<tauri::Wry>,
    pub volume_label: MenuItem<tauri::Wry>,
    pub svc_voice: CheckMenuItem<tauri::Wry>,
    pub svc_vision: CheckMenuItem<tauri::Wry>,
    pub svc_agent: CheckMenuItem<tauri::Wry>,
    pub svc_backend: CheckMenuItem<tauri::Wry>,
    pub svc_ui: CheckMenuItem<tauri::Wry>,
}

static TRAY_HANDLES: Mutex<Option<TrayHandles>> = Mutex::new(None);

pub struct MiniTrayHandles {
    pub on_top: CheckMenuItem<tauri::Wry>,
    pub hands_free: CheckMenuItem<tauri::Wry>,
    pub ghost: CheckMenuItem<tauri::Wry>,
}
static MINI_TRAY: Mutex<Option<MiniTrayHandles>> = Mutex::new(None);

/// Ayrı menü-bar simgesi: floating mini-orb için (ana XJarvis simgesinden farklı ikon).
/// Alttaki pencerelerin arkasında kalıp göremezsen buradan tek tıkla geri çağırırsın.
pub fn build_mini_tray(app: &AppHandle) -> tauri::Result<()> {
    let toggle = MenuItem::with_id(app, "mini_toggle", "🔮 Mini Orb'u Aç / Gizle", true, None::<&str>)?;
    let sep1 = PredefinedMenuItem::separator(app)?;
    let on_top     = CheckMenuItem::with_id(app, "mini_ontop", "Üstte Tut", true, true, None::<&str>)?;
    let hands_free = CheckMenuItem::with_id(app, "mini_handsfree", "Eller-Serbest Dinleme", true, false, None::<&str>)?;
    let ghost      = CheckMenuItem::with_id(app, "mini_ghost", "Hayalet Mod (tıklama geçişli)", true, false, None::<&str>)?;
    let sep2 = PredefinedMenuItem::separator(app)?;
    let show_main = MenuItem::with_id(app, "mini_show_main", "XJarvis Penceresini Aç", true, None::<&str>)?;

    let menu = Menu::with_items(app, &[
        &toggle, &sep1, &on_top, &hands_free, &ghost, &sep2, &show_main,
    ])?;

    *MINI_TRAY.lock().unwrap_or_else(|e| e.into_inner()) = Some(MiniTrayHandles {
        on_top: on_top.clone(),
        hands_free: hands_free.clone(),
        ghost: ghost.clone(),
    });

    let mut b = TrayIconBuilder::with_id("xjarvis-mini-tray")
        .tooltip("XJarvis Mini Orb")
        .menu(&menu);
    if let Ok(img) = Image::from_bytes(MINI_ICON_BYTES) {
        b = b.icon(img).icon_as_template(true);
    }
    b.show_menu_on_left_click(true)
        .on_menu_event(handle_mini_menu_event)
        .build(app)?;
    Ok(())
}

fn handle_mini_menu_event(app: &AppHandle, event: tauri::menu::MenuEvent) {
    match event.id.as_ref() {
        "mini_toggle" => {
            let on_top = MINI_TRAY.lock().ok()
                .and_then(|g| g.as_ref().and_then(|h| h.on_top.is_checked().ok()))
                .unwrap_or(true);
            crate::commands::toggle_mini_orb_window(app, on_top);
        }
        "mini_ontop" => {
            if let Ok(g) = MINI_TRAY.lock() {
                if let Some(h) = g.as_ref() {
                    let next = !h.on_top.is_checked().unwrap_or(true);
                    let _ = h.on_top.set_checked(next);
                    if let Some(win) = app.get_webview_window("mini-orb") {
                        let _ = win.set_always_on_top(next);
                    }
                }
            }
        }
        "mini_handsfree" => {
            if let Ok(g) = MINI_TRAY.lock() {
                if let Some(h) = g.as_ref() {
                    let next = !h.hands_free.is_checked().unwrap_or(false);
                    let _ = h.hands_free.set_checked(next);
                    if next {
                        http_post(format!("{VOICE}/realtime/start"), serde_json::json!({"engine": "agent"}));
                    } else {
                        http_post(format!("{VOICE}/realtime/stop"), serde_json::json!({}));
                    }
                }
            }
        }
        "mini_ghost" => {
            if let Ok(g) = MINI_TRAY.lock() {
                if let Some(h) = g.as_ref() {
                    let next = !h.ghost.is_checked().unwrap_or(false);
                    let _ = h.ghost.set_checked(next);
                    if let Some(win) = app.get_webview_window("mini-orb") {
                        let _ = win.set_ignore_cursor_events(next);
                    }
                }
            }
        }
        "mini_show_main" => {
            if let Some(win) = app.get_webview_window("main") {
                let _ = win.unminimize();
                let _ = win.show();
                let _ = win.set_focus();
            }
        }
        _ => {}
    }
}

/// Build the macOS menu-bar (system tray) icon and menu with toggle items.
pub fn build_tray(app: &AppHandle) -> tauri::Result<()> {
    // Toggleable check items
    let jarvis = CheckMenuItem::with_id(app, "toggle_jarvis", "● XJarvis", true, true, None::<&str>)?;
    let camera = CheckMenuItem::with_id(app, "toggle_camera", "📷 Kamera", true, false, None::<&str>)?;
    let mic    = CheckMenuItem::with_id(app, "toggle_mic",    "🎤 Mikrofon", true, true, None::<&str>)?;

    let sep1 = PredefinedMenuItem::separator(app)?;

    // Volume controls
    let volume_label = MenuItem::with_id(app, "volume_label", "🔊 Ses: —", false, None::<&str>)?;
    let vol_up    = MenuItem::with_id(app, "volume_up",   "  ↑  +10",  true, Some("CmdOrCtrl+Shift+="))?;
    let vol_down  = MenuItem::with_id(app, "volume_down", "  ↓  −10",  true, Some("CmdOrCtrl+Shift+-"))?;
    let vol_mute  = MenuItem::with_id(app, "volume_mute", "  ✕  Sustur (0)", true, None::<&str>)?;
    let vol_full  = MenuItem::with_id(app, "volume_full", "  ✓  Tam (100)",  true, None::<&str>)?;

    let sep2 = PredefinedMenuItem::separator(app)?;

    // Quick views
    let dashboard = MenuItem::with_id(app, "dashboard", "Dashboard", true, None::<&str>)?;
    let preferences = MenuItem::with_id(app, "preferences", "Preferences", true, None::<&str>)?;
    let mobile = MenuItem::with_id(app, "mobile", "Mobile View", true, None::<&str>)?;
    let logs   = MenuItem::with_id(app, "logs", "Logları Aç", true, None::<&str>)?;
    let quick_capture = MenuItem::with_id(app, "quick_capture", "✏️  Quick capture", true, Some("CmdOrCtrl+Shift+Space"))?;

    let sep3 = PredefinedMenuItem::separator(app)?;

    // Per-service toggles (state polled from /api/services/state)
    let svc_voice   = CheckMenuItem::with_id(app, "svc_voice",   "🎙  Voice service",   true, false, None::<&str>)?;
    let svc_vision  = CheckMenuItem::with_id(app, "svc_vision",  "👁  Vision service",  true, false, None::<&str>)?;
    let svc_agent   = CheckMenuItem::with_id(app, "svc_agent",   "🧠  Agent service",   true, false, None::<&str>)?;
    let svc_backend = CheckMenuItem::with_id(app, "svc_backend", "🔌  Backend service", false, false, None::<&str>)?;
    let svc_ui      = CheckMenuItem::with_id(app, "svc_ui",      "🪟  XJarvis UI",      false, false, None::<&str>)?;
    let svc_start_all = MenuItem::with_id(app, "svc_start_all", "▶ Eksik servisleri başlat", true, None::<&str>)?;

    let sep_svc = PredefinedMenuItem::separator(app)?;

    // Service controls
    let refresh = MenuItem::with_id(app, "refresh", "🔄 Yenile (Refresh)", true, None::<&str>)?;
    let rebuild = MenuItem::with_id(app, "rebuild", "🛠  Yeniden Derle & Kur (.app)", true, None::<&str>)?;
    let restart = MenuItem::with_id(app, "restart", "🔁 Yeniden Başlat (Restart)", true, None::<&str>)?;
    let stop    = MenuItem::with_id(app, "stop", "⏹ Servisleri Durdur", true, None::<&str>)?;

    let sep4 = PredefinedMenuItem::separator(app)?;

    let about = MenuItem::with_id(app, "about", "XJarvis Hakkında", true, None::<&str>)?;
    let quit  = MenuItem::with_id(app, "quit", "Çıkış", true, None::<&str>)?;

    let menu = Menu::with_items(
        app,
        &[
            &jarvis, &camera, &mic,
            &sep1,
            &volume_label, &vol_up, &vol_down, &vol_mute, &vol_full,
            &sep2,
            &dashboard, &preferences, &mobile, &logs, &quick_capture,
            &sep3,
            &svc_voice, &svc_vision, &svc_agent, &svc_backend, &svc_ui, &svc_start_all,
            &sep_svc,
            &refresh, &rebuild, &restart, &stop,
            &sep4,
            &about, &quit,
        ],
    )?;

    *TRAY_HANDLES.lock().unwrap_or_else(|e| e.into_inner()) = Some(TrayHandles {
        jarvis: jarvis.clone(),
        camera: camera.clone(),
        mic: mic.clone(),
        volume_label: volume_label.clone(),
        svc_voice: svc_voice.clone(),
        svc_vision: svc_vision.clone(),
        svc_agent: svc_agent.clone(),
        svc_backend: svc_backend.clone(),
        svc_ui: svc_ui.clone(),
    });

    let mut tray_builder = TrayIconBuilder::with_id("xjarvis-tray")
        .tooltip("XJarvis")
        .menu(&menu);
    if let Ok(img) = Image::from_bytes(TRAY_ICON_BYTES) {
        tray_builder = tray_builder.icon(img).icon_as_template(true);
    } else if let Some(icon) = app.default_window_icon() {
        tray_builder = tray_builder.icon(icon.clone());
    }
    let _tray = tray_builder
        .show_menu_on_left_click(true)
        .on_menu_event(handle_menu_event)
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click {
                button: MouseButton::Right,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                if let Some(win) = tray.app_handle().get_webview_window("main") {
                    let _ = win.show();
                    let _ = win.set_focus();
                }
            }
        })
        .build(app)?;

    // Kick off the state-polling task so menu items reflect reality
    let h = app.clone();
    tauri::async_runtime::spawn(async move {
        poll_state_loop(h).await;
    });

    Ok(())
}

async fn poll_state_loop(app: AppHandle) {
    use std::time::Duration;
    let client = reqwest::Client::builder()
        .timeout(Duration::from_millis(800))
        .build()
        .unwrap_or_else(|_| reqwest::Client::new());
    loop {
        // Servis durumlarını paralel çek
        let svc_resp = client.get(format!("{BACKEND}/api/services/state")).send().await;
        if let Ok(r) = svc_resp {
            if let Ok(s) = r.json::<serde_json::Value>().await {
                if let Some(arr) = s["services"].as_array() {
                    if let Ok(guard) = TRAY_HANDLES.lock() {
                        if let Some(h) = guard.as_ref() {
                            for svc in arr {
                                let name = svc["name"].as_str().unwrap_or("");
                                let running = svc["running"].as_bool().unwrap_or(false);
                                match name {
                                    "voice"   => { let _ = h.svc_voice.set_checked(running); }
                                    "vision"  => { let _ = h.svc_vision.set_checked(running); }
                                    "agent"   => { let _ = h.svc_agent.set_checked(running); }
                                    "backend" => { let _ = h.svc_backend.set_checked(running); }
                                    "ui"      => { let _ = h.svc_ui.set_checked(running); }
                                    _ => {}
                                }
                            }
                        }
                    }
                }
            }
        }

        if let Ok(resp) = client.get(format!("{BACKEND}/api/control/state")).send().await {
            if let Ok(state) = resp.json::<serde_json::Value>().await {
                if let Ok(guard) = TRAY_HANDLES.lock() {
                    if let Some(h) = guard.as_ref() {
                        let cam = state["camera"]["on"].as_bool().unwrap_or(false);
                        let mic = state["mic"]["on"].as_bool().unwrap_or(true);
                        let jrv = state["jarvis"]["on"].as_bool().unwrap_or(true);
                        let vol = state["volume"].as_i64();
                        let _ = h.camera.set_checked(cam);
                        let _ = h.mic.set_checked(mic);
                        let _ = h.jarvis.set_checked(jrv);
                        let label = match vol {
                            Some(v) => format!("🔊 Ses: {v}"),
                            None    => "🔊 Ses: —".to_string(),
                        };
                        let _ = h.volume_label.set_text(&label);

                        // Update tooltip to reflect master state
                        if let Some(tray) = app.tray_by_id("xjarvis-tray") {
                            let tooltip = if jrv {
                                format!("XJarvis · cam {} · mic {} · {}",
                                    if cam {"on"} else {"off"},
                                    if mic {"on"} else {"off"},
                                    label,
                                )
                            } else {
                                "XJarvis (KAPALI)".to_string()
                            };
                            let _ = tray.set_tooltip(Some(&tooltip));
                        }
                    }
                }
            }
        }
        tokio::time::sleep(Duration::from_secs(2)).await;
    }
}

fn http_post(url: String, body: serde_json::Value) {
    tauri::async_runtime::spawn(async move {
        let _ = reqwest::Client::new()
            .post(&url)
            .json(&body)
            .send()
            .await;
    });
}

fn toggle_service(name: &str) {
    let n = name.to_string();
    tauri::async_runtime::spawn(async move {
        let client = reqwest::Client::new();
        // Önce mevcut durumu öğren
        if let Ok(r) = client.get(format!("{BACKEND}/api/services/state")).send().await {
            if let Ok(s) = r.json::<serde_json::Value>().await {
                if let Some(arr) = s["services"].as_array() {
                    let running = arr.iter().any(|svc| {
                        svc["name"].as_str() == Some(&n) && svc["running"].as_bool().unwrap_or(false)
                    });
                    let endpoint = if running { "stop" } else { "start" };
                    let _ = client.post(format!("{BACKEND}/api/services/{endpoint}"))
                        .json(&serde_json::json!({"name": n}))
                        .send().await;
                }
            }
        }
    });
}

fn handle_menu_event(app: &AppHandle, event: tauri::menu::MenuEvent) {
    match event.id.as_ref() {
        "toggle_jarvis" => http_post(format!("{BACKEND}/api/control/jarvis"), serde_json::json!({})),
        "toggle_camera" => http_post(format!("{BACKEND}/api/control/camera"), serde_json::json!({})),
        "toggle_mic"    => http_post(format!("{BACKEND}/api/control/mic"),    serde_json::json!({})),

        "svc_voice"  => toggle_service("voice"),
        "svc_vision" => toggle_service("vision"),
        "svc_agent"  => toggle_service("agent"),
        "svc_start_all" => http_post(format!("{BACKEND}/api/services/start-all"), serde_json::json!({})),

        "volume_up"   => http_post(format!("{BACKEND}/api/control/volume"), serde_json::json!({"delta": 10})),
        "volume_down" => http_post(format!("{BACKEND}/api/control/volume"), serde_json::json!({"delta": -10})),
        "volume_mute" => http_post(format!("{BACKEND}/api/control/volume"), serde_json::json!({"level": 0})),
        "volume_full" => http_post(format!("{BACKEND}/api/control/volume"), serde_json::json!({"level": 100})),

        "dashboard" => navigate(app, "/dashboard"),
        "preferences" => navigate(app, "/preferences"),
        "mobile" => navigate(app, "/mobile"),
        "logs" => {
            use tauri_plugin_shell::ShellExt;
            let _ = app.shell().command("open").args(["./logs/"]).spawn();
        }
        "quick_capture" => navigate(app, "/quick-capture"),

        "refresh" => {
            if let Some(win) = app.get_webview_window("main") {
                let _ = win.eval("location.reload()");
            }
        }
        "rebuild" => {
            use tauri_plugin_shell::ShellExt;
            // Run the release script in a Terminal window so user sees progress
            let project = std::env::current_dir().ok()
                .and_then(|p| p.to_str().map(String::from))
                .unwrap_or_else(|| ".".to_string());
            let project_for_term = project.replace('"', "\\\"");
            let script = format!(
                "tell application \"Terminal\" to do script \"cd \\\"{project_for_term}\\\" && npm run release\""
            );
            let _ = app.shell().command("osascript")
                .args(["-e", &script])
                .spawn();
        }
        "restart" => {
            let h = app.clone();
            tauri::async_runtime::spawn(async move {
                crate::services::restart_all(&h).await;
            });
        }
        "stop" => {
            let h = app.clone();
            tauri::async_runtime::spawn(async move {
                crate::services::stop_all(&h).await;
            });
        }

        "about" => navigate(app, "/"),
        "quit" => {
            let h = app.clone();
            tauri::async_runtime::spawn(async move {
                crate::services::stop_all(&h).await;
                h.exit(0);
            });
        }
        _ => {}
    }
}

fn navigate(app: &AppHandle, path: &str) {
    if let Some(win) = app.get_webview_window("main") {
        let _ = win.show();
        let _ = win.set_focus();
        let safe = path.replace('"', "");
        let _ = win.eval(&format!("window.location.href='{safe}'"));
    }
}
