# XJarvis

**Voice-controlled, self-hosted AI assistant for macOS.** A multi-process event
bus, a Claude/Ollama-driven agent with 100+ tools, MCP/skill plugins, a Telegram
companion (remote commands + daily briefings), and a Tauri menu-bar shell — all
running on **your own machine, with your own keys**.

> 🔐 **This repository ships with ZERO credentials.** Every API key, token and
> secret is blank. You provide your own during setup (or from the in-app
> **Settings → Keys** page). Nothing here is tied to any particular account.

---

## ✨ What it does

- 🎙️ **Voice** — wake word ("Jarvis"), speech-to-text (local Whisper or Deepgram),
  text-to-speech (free macOS `say` or premium ElevenLabs — bring your own voice).
- 🧠 **Agent** — a ReAct loop with 100+ tools: files, shell, web search, calendar,
  mail, reminders, music, finance, vision, computer-use, and more. Runs on your
  **Anthropic Claude subscription** (Agent SDK, no API key) or a **local Ollama**
  model (fully offline, free).
- 💬 **Telegram companion** — talk to your assistant from your phone; get
  **morning / midday / evening briefings** (weather, markets, news, agenda).
- 🖥️ **Menu-bar app** — a Tauri (Rust) tray shell with a Next.js dashboard.
- 🧩 **Extensible** — MCP servers and skill plugins.

---

## 🚀 Quick start

```bash
# 1. Clone
git clone https://github.com/amirtechai/XJarvis-public.git ~/XJarvis
cd ~/XJarvis

# 2. Install dependencies (Node + Python + optional Ollama)
npm install
(cd backend && npm install)

# 3. Configure your keys  (see "Settings" below — this is where YOU add yours)
cp .env.example backend/.env
#   → open backend/.env and fill only the keys you want to use

# 4. Run (UI on :3000, backend bus on :3001)
npm run dev:all
```

Then open **http://localhost:3000**.

> **Minimum to get talking:** set `LLM_PROVIDER=ollama` (fully local, free) or
> `LLM_PROVIDER=claude` with a `CLAUDE_CODE_OAUTH_TOKEN` (Anthropic subscription).
> Everything else is optional and can be added later.

### Optional: native menu-bar app

```bash
npm run tauri:dev      # requires Rust toolchain (https://rustup.rs)
```

### Optional: one-shot installer

```bash
bash scripts/install.sh   # installs Ollama, pulls a small model, Python deps
```

---

## ⚙️ Settings — make it yours

XJarvis is **per-user**. Add only what you need; a missing key simply disables
that one feature. Two ways to configure:

1. **File** — edit `backend/.env` (copied from `.env.example`).
2. **In-app** — launch the app → **Settings → Keys** and paste keys there.

| Feature | Key(s) | Where to get it |
|---|---|---|
| **LLM — local (free)** | `LLM_PROVIDER=ollama` | https://ollama.com |
| **LLM — Claude (subscription)** | `LLM_PROVIDER=claude` + `CLAUDE_CODE_OAUTH_TOKEN` | `npx @anthropic-ai/claude-code` → `/login` → `claude setup-token` |
| **LLM — other** | `OPENROUTER_API_KEY` / `GROQ_API_KEY` / `GEMINI_API_KEY` … | provider console |
| **Speech-to-text** | `DEEPGRAM_API_KEY` (or local Whisper, no key) | https://deepgram.com |
| **Premium voice** | `ELEVENLABS_API_KEY`, `ELEVENLABS_VOICE_ID` | https://elevenlabs.io |
| **Wake word** | `PICOVOICE_ACCESS_KEY`, `WAKE_WORD_PATH` | https://console.picovoice.ai |
| **Telegram companion** | `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID` | @BotFather |
| **Google (mail/calendar)** | `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | https://console.cloud.google.com |
| **Spotify** | `SPOTIFY_CLIENT_ID`, `SPOTIFY_CLIENT_SECRET` | https://developer.spotify.com |
| **Weather** | `WEATHER_LATITUDE/LONGITUDE` (defaults to Istanbul) | your coordinates |
| **Finance / media / more** | see `.env.example` | respective consoles |

Full list with comments lives in **[`.env.example`](.env.example)**.

---

## 🏗️ Architecture

```
        ┌──────────────────────────────────────────┐
        │  Tauri shell (Rust)  — menu-bar tray      │
        └───────────────┬──────────────────────────┘
                        │ loads
                        ▼
              Next.js UI (:3000)   /dashboard /companion /logs
                        │ ws://:3001
   ┌────────────────────┴─────────────────────────┐
   │  Node backend (:3001)                         │
   │   - WebSocket event bus                       │
   │   - chat router → agent → TTS bridge          │
   │   - Telegram bot + daily briefings            │
   └─┬───────────────┬───────────────┬───────────┬─┘
     ▼               ▼               ▼           ▼
 voice (:8766)  agent (:8767)  vision (:8765)  system stats
```

- **`app/`, `components/`, `hooks/`, `lib/`** — Next.js frontend.
- **`backend/`** — Node event bus, router, Telegram, integrations.
- **`agent/`** — Python agent (Claude Agent SDK / Ollama), 100+ tools.
- **`voice/`, `vision/`** — Python sidecars.
- **`src-tauri/`** — Rust menu-bar shell.

---

## 🔒 Security notes

- `backend/.env`, `*.db`, logs, sessions and tokens are **git-ignored** — never
  commit them.
- The backend binds to `127.0.0.1` by default. If you expose a web companion,
  put it behind auth and set `COMPANION_ORIGIN` + `XJARVIS_EXEC_TOKEN`.
- Run `bash scripts/secret_scan.sh` before pushing changes.

---

## 🤝 Contributing

Issues and PRs welcome. Please keep secrets out of commits and run the secret
scan first.

## 📄 License

MIT — see [LICENSE](LICENSE).
