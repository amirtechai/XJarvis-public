//! Sidecar manager — starts and stops backend, agent, vision, voice services.
//!
//! Discovery order for the project root:
//!   1. $XJARVIS_HOME           (explicit override)
//!   2. ~/Jarvis/jarvis-ui      (the canonical install path on this machine)
//!   3. CWD                     (development from inside the repo)
//!
//! When the app starts we spawn:
//!   - Node:    backend/server.js          (port 3001)
//!   - Python:  -m agent.service           (port 8767)
//!   - Python:  -m voice.service           (port 8766)  [if mic + key configured]
//!   - Python:  -m vision.service          (port 8765)  [optional]
//!
//! Each child process is captured so we can stop / restart cleanly. Failures
//! are non-fatal — health probes still report status to the UI.

use serde::Serialize;
use std::collections::HashMap;
use std::path::PathBuf;
use std::process::{Child, Command, Stdio};
use std::sync::Mutex;
use tauri::AppHandle;

static CHILDREN: Mutex<Option<HashMap<String, Child>>> = Mutex::new(None);

#[derive(Serialize, Clone)]
pub struct ServiceState {
    pub name: String,
    pub url: String,
    pub up: bool,
}

const PROBES: &[(&str, &str)] = &[
    ("backend", "http://127.0.0.1:3001"),
    ("agent", "http://127.0.0.1:8767/health"),
    ("vision", "http://127.0.0.1:8765/status"),
    ("voice", "http://127.0.0.1:8766/status"),
    ("frontend", "http://127.0.0.1:3000"),
];

fn project_root() -> PathBuf {
    if let Ok(p) = std::env::var("XJARVIS_HOME") {
        let pb = PathBuf::from(&p);
        if pb.exists() {
            return pb;
        }
    }
    if let Some(home) = std::env::var_os("HOME") {
        let canonical = PathBuf::from(&home).join("Jarvis").join("jarvis-ui");
        if canonical.exists() {
            return canonical;
        }
    }
    std::env::current_dir().unwrap_or_else(|_| PathBuf::from("."))
}

fn find_python() -> String {
    // Prefer the user's pyenv shim, then plain python3.
    if let Some(home) = std::env::var_os("HOME") {
        let shim = PathBuf::from(&home)
            .join(".pyenv").join("shims").join("python3");
        if shim.exists() {
            return shim.to_string_lossy().into_owned();
        }
    }
    "python3".to_string()
}

fn find_node() -> String {
    // Try common Homebrew + system paths
    for cand in &["/opt/homebrew/bin/node", "/usr/local/bin/node", "/usr/bin/node"] {
        if std::path::Path::new(cand).exists() {
            return (*cand).to_string();
        }
    }
    "node".to_string()
}

fn spawn(name: &str, root: &std::path::Path, cmd: &str, args: &[&str]) -> Option<Child> {
    let log_dir = root.join("logs");
    let _ = std::fs::create_dir_all(&log_dir);
    let log_path = log_dir.join(format!("tauri-{name}.log"));
    let log_file = match std::fs::File::create(&log_path) {
        Ok(f) => f,
        Err(e) => {
            eprintln!("[xjarvis] failed to create log file for {name}: {e}");
            return None;
        }
    };
    let log_err = match log_file.try_clone() {
        Ok(f) => f,
        Err(e) => {
            eprintln!("[xjarvis] failed to clone log file for {name}: {e}");
            return None;
        }
    };
    Command::new(cmd)
        .args(args)
        .current_dir(root)
        .stdout(Stdio::from(log_file))
        .stderr(Stdio::from(log_err))
        .spawn()
        .map_err(|e| {
            eprintln!("[xjarvis] failed to spawn {name}: {e}");
            e
        })
        .ok()
}

/// Watchdog'un respawn ettiği yeni child'ı CHILDREN izleme haritasına
/// kaydeder (varsa aynı isimdeki eski kaydın üzerine yazar). Bu olmadan
/// respawn'lı süreçler stop_all/app-quit'te asla öldürülmüyordu.
fn register_child(name: &str, child: Child) {
    let mut guard = CHILDREN.lock().unwrap_or_else(|e| e.into_inner());
    guard.get_or_insert_with(HashMap::new).insert(name.to_string(), child);
}

async fn is_port_open(port: u16) -> bool {
    // HERHANGİ bir HTTP yanıtı (404 dahil) = portta biri var demek.
    // Eski hali 2xx (is_success) bekliyordu; agent'ın "/" route'u olmadığından
    // 404 dönüyor ve watchdog SAĞLIKLI agent'ı "port kapalı" sanıp ~3.5dk'da
    // bir öldürüyordu ("servis takıldı" bildirim yağmurunun kök nedeni).
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_millis(400))
        .build()
        .unwrap_or_else(|_| reqwest::Client::new());
    client.get(format!("http://127.0.0.1:{port}/")).send().await.is_ok()
}

/// Probe a specific URL — used by the watchdog to distinguish "port held by
/// a healthy process" from "port held by a stuck/zombie process".
///
/// Gerçek /health veya /status endpoint'leri (agent, voice) için SADECE
/// 2xx/3xx = healthy sayılır — eskiden herhangi bir yanıt (404 dahil) kabul
/// ediliyordu, bu da yanlış-pozitif "up" üretip watchdog'un takılma
/// tespitini etkisiz kılıyordu. Dedicated health path OLMAYAN URL'ler (ör.
/// backend'in "/" kökü — orada özel bir health route yok) için hâlâ
/// herhangi bir HTTP yanıtı = "port canlı" kabul edilir; bu is_port_open
/// ile aynı, BİLİNÇLİ port-liveness mantığıdır ve KIRILMADI.
async fn probe_url(url: &str, timeout_ms: u64) -> bool {
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_millis(timeout_ms))
        .build()
        .unwrap_or_else(|_| reqwest::Client::new());
    let is_health_endpoint = url.ends_with("/health") || url.ends_with("/status");
    client.get(url).send().await
        .map(|r| {
            if is_health_endpoint {
                r.status().is_success() || r.status().is_redirection()
            } else {
                r.status().as_u16() < 500
            }
        })
        .unwrap_or(false)
}

/// Find the PID holding `port` via lsof; SIGKILL it. Used by the watchdog
/// when a service is "stuck" (port bound, /health failing) so the next
/// spawn cycle can take over the port cleanly.
fn kill_pid_on_port(port: u16) -> bool {
    let out = match std::process::Command::new("/usr/sbin/lsof")
        .args(["-nP", &format!("-iTCP:{port}"), "-sTCP:LISTEN", "-Fp"])
        .output() {
        Ok(o) if o.status.success() => o,
        _ => return false,
    };
    let s = String::from_utf8_lossy(&out.stdout);
    let mut killed = false;
    for line in s.lines() {
        if let Some(rest) = line.strip_prefix('p') {
            if let Ok(pid) = rest.trim().parse::<i32>() {
                println!("[xjarvis/watchdog] killing stuck holder of {port}: pid={pid}");
                let _ = std::process::Command::new("kill")
                    .args(["-9", &pid.to_string()])
                    .status();
                killed = true;
            }
        }
    }
    killed
}

/// Kill ALL processes whose command line matches `pattern` (pkill -9 -f).
/// Eski/orphan/duplicate sidecar'ları, TEK taze instance spawn etmeden önce
/// süpürmek için. (Rust app'in kendisini eşleştirmez — desenler sidecar'a özgü.)
fn pkill_name(pattern: &str) {
    let _ = std::process::Command::new("/usr/bin/pkill")
        .args(["-9", "-f", pattern])
        .output();
}

/// Poll until port becomes free (timeout 2s). Used after pkill to ensure
/// stale process releases port before respawning.
async fn wait_port_free(port: u16, max_iterations: u32) -> bool {
    for _ in 0..max_iterations {
        if !is_port_open(port).await {
            return true;
        }
        tokio::time::sleep(std::time::Duration::from_millis(100)).await;
    }
    // Fallback: port still held, but timeout reached. Log and proceed.
    println!("[xjarvis] port {port} still held after 2s, proceeding with spawn anyway");
    false
}

/// Surface a macOS notification so the user actually notices when a
/// service is wedged — instead of the silent-crash-loop failure mode
/// we hit today with the orphaned agent.service.
fn macos_notify(title: &str, body: &str) {
    let script = format!(
        r#"display notification "{}" with title "{}" sound name "Basso""#,
        body.replace('"', "'"), title.replace('"', "'"),
    );
    let _ = std::process::Command::new("osascript")
        .args(["-e", &script])
        .spawn();
}

/// Background watchdog: every 15s, check each critical service. If a
/// service's port is held but /health fails for 3 consecutive probes,
/// declare it "stuck", kill the holder, notify the user, and respawn.
async fn watchdog_loop(root: PathBuf, py: String, node: String) {
    // Each entry: (name, port, health_url, spawn_kind)
    // spawn_kind tells us how to recover.
    let targets: &[(&str, u16, &str, &str)] = &[
        ("agent",   8767, "http://127.0.0.1:8767/health", "python"),
        ("backend", 3001, "http://127.0.0.1:3001/",       "node"),
        // voice launchd job (KeepAlive=false); ölürse app açıkken biz dirilt —
        // yoksa canlı dinleme + bas-konuş sessizce ölü kalıyordu.
        ("voice",   8766, "http://127.0.0.1:8766/status",  "voice"),
    ];
    let mut strikes: HashMap<String, u32> = HashMap::new();
    let mut notified: HashMap<String, bool> = HashMap::new();
    // Her servisin son spawn zamanı — respawn SONRASI da boot grace gerekir,
    // yoksa MCP yüklemesi (playwright/puppeteer ~1-2dk) 3×15s'e sığmayıp
    // watchdog'un boot ortasında öldürdüğü sonsuz restart döngüsü oluşuyor.
    let mut spawned_at: HashMap<String, std::time::Instant> = HashMap::new();
    let now = std::time::Instant::now();
    for (name, ..) in targets {
        spawned_at.insert(name.to_string(), now);
    }
    // agent.service MCP/tool yüklemesi uzun; backend hızlı açılır.
    fn boot_grace(kind: &str) -> std::time::Duration {
        match kind {
            "python" => std::time::Duration::from_secs(180),
            "voice" => std::time::Duration::from_secs(45),
            _ => std::time::Duration::from_secs(30),
        }
    }

    loop {
        tokio::time::sleep(std::time::Duration::from_secs(15)).await;
        for (name, port, url, kind) in targets {
            // Boot grace penceresi içindeyse hiç sağlık kontrolü yapma.
            if let Some(t) = spawned_at.get(*name) {
                if t.elapsed() < boot_grace(kind) {
                    continue;
                }
            }
            let port_held = is_port_open(*port).await;
            let healthy = if port_held { probe_url(url, 1500).await } else { false };

            if healthy {
                strikes.insert(name.to_string(), 0);
                if notified.get(*name).copied().unwrap_or(false) {
                    macos_notify("XJarvis", &format!("{} servisi tekrar ayakta", name));
                    notified.insert(name.to_string(), false);
                }
                continue;
            }

            let n = strikes.entry(name.to_string()).and_modify(|e| *e += 1).or_insert(1);
            println!("[xjarvis/watchdog] {} unhealthy (strike {}/{} — port_held={})",
                     name, n, 3, port_held);

            if *n < 3 { continue; }

            // 3rd strike: declare stuck and recover.
            if port_held {
                kill_pid_on_port(*port);
                tokio::time::sleep(std::time::Duration::from_millis(800)).await;
            }
            macos_notify(
                "XJarvis — servis takıldı",
                &format!("{} cevap vermiyor, otomatik yeniden başlatılıyor.", name),
            );
            notified.insert(name.to_string(), true);

            // Respawn — önce isimle TÜM kalıntıları süpür ki yeni instance
            // 8767/3001'e temiz bind edebilsin (duplicate/zombie bırakma).
            // ÖNEMLİ: yeni Child handle'ı CHILDREN'a kaydediyoruz — aksi halde
            // respawn'lı süreç hiçbir yerde izlenmez ve stop_all/app-quit
            // sırasında ORPHAN kalır (mic/kamera açık kalabilir, port tutulur).
            let spawned: bool = match *kind {
                "python" => {
                    pkill_name("agent.service");
                    wait_port_free(8767, 20).await;
                    match spawn(name, &root, &py, &["-m", "agent.service"]) {
                        Some(c) => { register_child(name, c); true }
                        None => false,
                    }
                },
                "node"   => {
                    pkill_name("backend/server.js");
                    wait_port_free(3001, 20).await;
                    match spawn(name, &root, &node, &["backend/server.js"]) {
                        Some(c) => { register_child(name, c); true }
                        None => false,
                    }
                },
                // voice: launchd job — child değil. Kalıntıyı süpür, kickstart et.
                "voice"  => { pkill_name("voice.service"); wait_port_free(8766, 20).await; launchctl_bootstrap("com.jarvis.voice").await; true },
                _        => false,
            };
            if !spawned {
                println!("[xjarvis/watchdog] respawn of {} failed", name);
            } else {
                strikes.insert(name.to_string(), 0);
                // Yeni instance'a tam boot grace tanı (MCP yüklemesi uzun sürer).
                spawned_at.insert(name.to_string(), std::time::Instant::now());
            }
        }
    }
}

/// Bootstrap (load) a launchd job. Used to start voice/vision when the app opens.
async fn launchctl_bootstrap(label: &str) {
    if let Some(uid) = users_uid() {
        let home = std::env::var("HOME").unwrap_or_else(|_| {
            eprintln!("[xjarvis] HOME env not set, cannot bootstrap {label}");
            "/root".to_string()
        });
        let plist = format!(
            "{}/Library/LaunchAgents/{label}.plist",
            home
        );
        let _ = std::process::Command::new("launchctl")
            .args(["bootstrap", &format!("gui/{uid}"), &plist])
            .output();
        // Force start in case RunAtLoad is false.
        let _ = std::process::Command::new("launchctl")
            .args(["kickstart", &format!("gui/{uid}/{label}")])
            .output();
    }
}

/// Bootout (unload + stop) a launchd job. KeepAlive jobs won't auto-restart
/// after this. Used when the app window is closed.
async fn launchctl_bootout(label: &str) {
    if let Some(uid) = users_uid() {
        let _ = std::process::Command::new("launchctl")
            .args(["bootout", &format!("gui/{uid}/{label}")])
            .output();
    }
}

fn users_uid() -> Option<u32> {
    // Cheaper than uzun `users` crate — just call `id -u`
    let out = std::process::Command::new("id").arg("-u").output().ok()?;
    let s = String::from_utf8(out.stdout).ok()?;
    s.trim().parse::<u32>().ok()
}

pub async fn start_all(_app: &AppHandle) {
    let root = project_root();
    println!("[xjarvis] project root: {}", root.display());

    let node = find_node();
    let py = find_python();

    let mut children: HashMap<String, Child> = HashMap::new();

    // Backend & agent — sadece port boşsa spawn et (zaten çalışıyorsa
    // duplicate başlatma).
    // TEK taze instance garantisi — app pkill/quit ile kapanınca sidecar
    // child'lar orphan kalıyor; sonraki açılışta isimle TÜM eski/orphan/
    // duplicate'ları süpürüp kendi taze child'ımızı spawn ediyoruz. Bu,
    // "servis takıldı" çoğalma döngüsünün kök çözümü.
    pkill_name("backend/server.js");
    wait_port_free(3001, 20).await;  // Poll 2s max for port to become free
    if let Some(c) = spawn("backend", &root, &node, &["backend/server.js"]) {
        children.insert("backend".into(), c);
    }
    pkill_name("agent.service");
    wait_port_free(8767, 20).await;  // Poll 2s max for port to become free
    if let Some(c) = spawn("agent", &root, &py, &["-m", "agent.service"]) {
        children.insert("agent".into(), c);
    }

    // voice + vision launchd'de — uygulama açılınca bootstrap (yükle + başlat).
    // RunAtLoad=false; sadece uygulama açıkken çalışsınlar.
    if !is_port_open(8766).await {
        launchctl_bootstrap("com.jarvis.voice").await;
    } else {
        println!("[xjarvis] voice already running on 8766 — skip bootstrap");
    }
    if !is_port_open(8765).await {
        launchctl_bootstrap("com.jarvis.vision").await;
    } else {
        println!("[xjarvis] vision already running on 8765 — skip bootstrap");
    }

    *CHILDREN.lock().unwrap_or_else(|e| e.into_inner()) = Some(children);
    log_status().await;

    // Kick off the background watchdog — single instance per process.
    static WATCHDOG_STARTED: std::sync::OnceLock<()> = std::sync::OnceLock::new();
    if WATCHDOG_STARTED.set(()).is_ok() {
        let root_clone = root.clone();
        let py_clone = py.clone();
        let node_clone = node.clone();
        tokio::spawn(async move {
            watchdog_loop(root_clone, py_clone, node_clone).await;
        });
        println!("[xjarvis] watchdog started — 15s probe, 3-strike recovery");
    }
}

pub async fn restart_all(app: &AppHandle) {
    stop_all(app).await;
    start_all(app).await;
}

pub async fn stop_all(_app: &AppHandle) {
    {
        let mut guard = CHILDREN.lock().unwrap_or_else(|e| e.into_inner());
        if let Some(children) = guard.take() {
            for (name, mut child) in children {
                let _ = child.kill();
                let _ = child.wait();
                println!("[xjarvis] stopped {name}");
            }
        }
    }
    // Güvenlik ağı: kayıtlı Child handle'ları kaçırılmış olsa bile (ör. bir
    // izleme/kayıt kodyolu atlanmışsa), isim-bazlı pkill ile agent/backend
    // sidecar'larının TÜM kalıntılarını temizle — orphan süreç bırakma.
    pkill_name("agent.service");
    pkill_name("backend/server.js");
    // Tear down launchd-managed voice + vision so mic & camera actually stop.
    launchctl_bootout("com.jarvis.voice").await;
    launchctl_bootout("com.jarvis.vision").await;
    println!("[xjarvis] voice + vision bootout done — mic/camera released");
}

pub async fn check_status() -> Vec<ServiceState> {
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_millis(800))
        .build()
        .unwrap_or_else(|_| reqwest::Client::new());

    let mut out = Vec::with_capacity(PROBES.len());
    for (name, url) in PROBES {
        let up = client.get(*url).send().await.map(|r| r.status().is_success()).unwrap_or(false);
        out.push(ServiceState {
            name: name.to_string(),
            url: url.to_string(),
            up,
        });
    }
    out
}

async fn log_status() {
    let states = check_status().await;
    for s in &states {
        println!("[xjarvis] {} {}: {}", if s.up { "✓" } else { "✗" }, s.name, s.url);
    }
}
