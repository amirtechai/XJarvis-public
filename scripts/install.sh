#!/usr/bin/env bash
# XJarvis one-shot installer.
#
# Usage on a fresh machine:
#   git clone https://github.com/amirtechai/XJarvis-public.git ~/XJarvis
#   cd ~/XJarvis
#   bash scripts/install.sh
#
# What it does:
#   1. Clones OpenJarvis (the agent/RAG backbone) next to this repo
#   2. Installs OpenJarvis Python deps
#   3. Vendors XJarvis-specific connectors (Telegram, YouTube) into OpenJarvis
#   4. Patches OpenJarvis OAuth config to add YouTube scope
#   5. Registers them in connectors/__init__.py
#   6. npm install + Python deps
#   7. Build static export (Tauri-ready)
set -e

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PARENT_DIR="$(dirname "$REPO_ROOT")"
OPENJARVIS_DIR="$PARENT_DIR/OpenJarvis"

echo "→ XJarvis install (root: $REPO_ROOT)"

# 1. OpenJarvis clone
if [ ! -d "$OPENJARVIS_DIR" ]; then
  echo "→ Cloning OpenJarvis next to XJarvis…"
  git clone https://github.com/open-jarvis/OpenJarvis.git "$OPENJARVIS_DIR" || echo "  (OpenJarvis opsiyonel — atlaniyor; XJarvis yerlesik agent/ ile calisir)"
else
  echo "→ OpenJarvis already present at $OPENJARVIS_DIR"
fi

# 2. OpenJarvis Python deps
if [ -f "$OPENJARVIS_DIR/pyproject.toml" ]; then
  echo "→ Installing OpenJarvis Python deps (pip install -e . with browser extra)"
  (cd "$OPENJARVIS_DIR" && python3 -m pip install -e ".[browser]" --quiet) || \
    (cd "$OPENJARVIS_DIR" && python3 -m pip install -e . --quiet) || \
    echo "  (pip install failed — install manually if needed)"
fi

# Playwright browsers (chromium only — keeps download small)
echo "→ Installing Playwright Chromium (for computer-use browser tools)"
python3 -m playwright install chromium 2>/dev/null || \
  echo "  (playwright not available; browser tools will fail until installed)"

# Ollama — local LLM fallback when OpenRouter is unavailable / for privacy.
echo "→ Setting up Ollama (local LLM fallback)"
if ! command -v ollama >/dev/null 2>&1; then
  if command -v brew >/dev/null 2>&1; then
    brew install --cask ollama || echo "  (brew install ollama failed — install manually: https://ollama.com)"
  else
    echo "  (homebrew not present — install Ollama manually: https://ollama.com)"
  fi
fi
if command -v ollama >/dev/null 2>&1; then
  # Start the daemon if not already running, then pull a small default model.
  pgrep -f "ollama serve" >/dev/null 2>&1 || (nohup ollama serve > /tmp/ollama.log 2>&1 & disown)
  DEFAULT_LOCAL_MODEL="${XJARVIS_LOCAL_MODEL:-qwen3:7b}"
  if ! ollama list 2>/dev/null | grep -q "${DEFAULT_LOCAL_MODEL%%:*}"; then
    echo "  → pulling $DEFAULT_LOCAL_MODEL (one-time, may take a while)"
    ollama pull "$DEFAULT_LOCAL_MODEL" || echo "  (pull failed — you can retry: ollama pull $DEFAULT_LOCAL_MODEL)"
  else
    echo "  ✓ $DEFAULT_LOCAL_MODEL already pulled"
  fi
fi

# 3. Vendor connector files
VENDOR="$REPO_ROOT/vendor/openjarvis-connectors"
TARGET="$OPENJARVIS_DIR/src/openjarvis/connectors"
echo "→ Installing vendored connectors into $TARGET"
cp "$VENDOR/telegram.py" "$TARGET/telegram.py"
cp "$VENDOR/youtube.py"  "$TARGET/youtube.py"

# 4. OAuth patch (idempotent — skip if already applied)
if ! grep -q "youtube.readonly" "$TARGET/oauth.py"; then
  echo "→ Patching oauth.py to add YouTube scope"
  patch -p1 -d "$OPENJARVIS_DIR" < "$VENDOR/oauth.patch" || \
    echo "  (patch failed — may need manual edit; oauth.patch is small)"
else
  echo "→ oauth.py already patched (skipping)"
fi

# 5. Register imports in connectors/__init__.py (idempotent)
INIT="$TARGET/__init__.py"
add_import() {
  local mod="$1"
  if ! grep -q "openjarvis.connectors.$mod" "$INIT"; then
    cat >> "$INIT" <<EOF

try:
    import openjarvis.connectors.$mod  # noqa: F401
except ImportError:
    pass
EOF
    echo "  + registered $mod"
  fi
}
add_import telegram
add_import youtube

# 6. Node + Python deps for the UI/backend
echo "→ npm install (root)"
(cd "$REPO_ROOT" && npm install --silent)
echo "→ npm install (backend)"
(cd "$REPO_ROOT/backend" && npm install --silent) || true

# 7. Build static export
echo "→ npm run build"
(cd "$REPO_ROOT" && npm run build)

echo ""
echo "✓ Install complete."
echo ""
echo "Next steps:"
echo "  • Configure ~/.openjarvis/connectors/*.json (or env vars) for OAuth providers"
echo "  • Set TELEGRAM_BOT_TOKEN in backend/.env (or ~/.openjarvis/connectors/telegram.json)"
echo "  • Run \`npm run release\` to build + install /Applications/XJarvis.app"
echo "  • Or for dev: \`npm run dev:all\`"
