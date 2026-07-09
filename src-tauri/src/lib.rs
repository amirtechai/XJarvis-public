mod tray;
mod services;
mod commands;
mod shortcuts;

use tauri::Manager;
use tauri_plugin_autostart::MacosLauncher;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_autostart::init(
            MacosLauncher::LaunchAgent,
            None,
        ))
        .plugin(shortcuts::build_plugin())
        .invoke_handler(tauri::generate_handler![
            commands::toggle_listening,
            commands::pause_agent,
            commands::resume_agent,
            commands::refresh_frontend,
            commands::restart_services,
            commands::stop_services,
            commands::open_dashboard,
            commands::services_status,
            commands::toggle_mini_orb,
            commands::start_orb_drag,
            commands::set_mini_orb_on_top,
            commands::minimize_main_to_dock,
            commands::set_orb_passive,
        ])
        .setup(|app| {
            // Build the menu-bar tray (ana XJarvis + ayrı mini-orb simgesi)
            tray::build_tray(app.handle())?;
            tray::build_mini_tray(app.handle())?;
            // Register global shortcuts (Cmd+Shift+J/P/K)
            shortcuts::register_all(app.handle())?;

            // Auto-start the bundled sidecars
            let handle = app.handle().clone();
            tauri::async_runtime::spawn(async move {
                services::start_all(&handle).await;
            });

            // Pencere kapatma (kırmızı X / Cmd+W) → TRAY'e GİZLE, app + Option+A
            // kısayolu yaşamaya devam etsin (kullanıcı başka uygulamadayken de
            // bas-konuş çalışsın). Mic PTT-only + lazy olduğu için tray'de
            // beklerken dinlemez. TAM kapatma menü çubuğu → "Çıkış" ile (stop_all).
            if let Some(win) = app.get_webview_window("main") {
                let handle_for_close = app.handle().clone();
                win.on_window_event(move |event| {
                    if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                        api.prevent_close();
                        if let Some(w) = handle_for_close.get_webview_window("main") {
                            let _ = w.hide();
                        }
                    }
                });
            }
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running XJarvis");
}
