//! Global keyboard shortcuts (yalnızca XJarvis.app açıkken kayıtlı):
//!  Option+A    — BAS-KONUŞ: basılı tut → dinle, bırak → cevap/işlem
//!  Cmd+Shift+J — wake-word manual trigger (open mic right now)
//!  Cmd+Shift+P — pause / resume agent
//!  Cmd+Shift+K — open command palette (focus main window)

use tauri::{plugin::TauriPlugin, AppHandle, Manager, Runtime};
use tauri_plugin_global_shortcut::{Code, Modifiers, Shortcut, ShortcutState};

pub fn build_plugin<R: Runtime>() -> TauriPlugin<R> {
    tauri_plugin_global_shortcut::Builder::new()
        .with_handler(|app, shortcut, event| {
            handle(app, shortcut, event.state());
        })
        .build()
}

pub fn register_all<R: Runtime>(app: &AppHandle<R>) -> tauri::Result<()> {
    use tauri_plugin_global_shortcut::GlobalShortcutExt;
    let gs = app.global_shortcut();
    let mods = Some(Modifiers::SUPER | Modifiers::SHIFT);
    for code in [Code::KeyJ, Code::KeyP, Code::KeyK] {
        if let Err(e) = gs.register(Shortcut::new(mods, code)) {
            eprintln!("[xjarvis] failed to register shortcut {code:?}: {e}");
        }
    }
    // Push-to-talk: Option+A (basılı tut konuş, bırak işle). Yalnızca uygulama
    // açıkken kayıtlı — kapanınca plugin kalkar, kısayol da gider.
    // TEK PTT giriş noktası — sessiz kalırsa kullanıcı Option+A'nın neden
    // çalışmadığını asla anlayamaz, o yüzden net/görünür hata basıyoruz
    // (panik ETMİYORUZ — uygulama kısayolsuz da çalışmaya devam etsin).
    if let Err(e) = gs.register(Shortcut::new(Some(Modifiers::ALT), Code::KeyA)) {
        eprintln!("[shortcuts] KRİTİK: Option+A PTT kısayolu kaydedilemedi: {e} — başka bir uygulama bu kısayolu tutuyor olabilir");
    }
    Ok(())
}

fn ptt(path: &'static str) {
    tauri::async_runtime::spawn(async move {
        let _ = reqwest::Client::new()
            .post(format!("http://127.0.0.1:8766{path}"))
            .send()
            .await;
    });
}

fn handle<R: Runtime>(app: &AppHandle<R>, shortcut: &Shortcut, state: ShortcutState) {
    // Bas-konuş: hem basış hem bırakış lazım.
    let ptt_key = Shortcut::new(Some(Modifiers::ALT), Code::KeyA);
    if shortcut == &ptt_key {
        match state {
            ShortcutState::Pressed => ptt("/ptt/start"),
            ShortcutState::Released => ptt("/ptt/stop"),
        }
        return;
    }

    // Diğer kısayollar yalnızca basışta tetiklenir.
    if state != ShortcutState::Pressed {
        return;
    }

    let mods = Some(Modifiers::SUPER | Modifiers::SHIFT);
    let j = Shortcut::new(mods, Code::KeyJ);
    let p = Shortcut::new(mods, Code::KeyP);
    let k = Shortcut::new(mods, Code::KeyK);

    if shortcut == &j {
        let h = app.clone();
        tauri::async_runtime::spawn(async move {
            let _ = reqwest::Client::new().post("http://127.0.0.1:8766/wake").send().await;
            if let Some(win) = h.get_webview_window("main") {
                let _ = win.show();
                let _ = win.set_focus();
            }
        });
    } else if shortcut == &p {
        tauri::async_runtime::spawn(async move {
            let _ = reqwest::Client::new().post("http://127.0.0.1:8767/pause").send().await;
        });
    } else if shortcut == &k {
        if let Some(win) = app.get_webview_window("main") {
            let _ = win.show();
            let _ = win.set_focus();
            let _ = win.eval(
                "window.dispatchEvent(new CustomEvent('xjarvis:open-palette'))",
            );
        }
    }
}
