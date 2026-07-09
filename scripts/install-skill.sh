#!/usr/bin/env bash
# Install a community / personal XJarvis skill.
#
# Usage:
#   bash scripts/install-skill.sh <source>
#
# Where <source> is one of:
#   • npm package name with the `xjarvis-skill-` prefix:
#       bash scripts/install-skill.sh xjarvis-skill-pomodoro
#   • git URL:
#       bash scripts/install-skill.sh https://github.com/user/my-skill.git
#   • local path to a skill .md file:
#       bash scripts/install-skill.sh ~/Downloads/my-skill.md
#
# Convention: a skill is one or more *.md files. We copy them into
# agent/skills/ where the runtime auto-loads them.
set -e

if [ -z "$1" ]; then
  echo "Usage: $0 <npm-pkg | git-url | path/to/skill.md>"
  exit 1
fi
SRC="$1"
SKILLS_DIR="$(cd "$(dirname "$0")/.." && pwd)/agent/skills"
mkdir -p "$SKILLS_DIR"

copy_md_files() {
  local from="$1"
  local count=0
  while IFS= read -r -d '' f; do
    cp "$f" "$SKILLS_DIR/"
    echo "  + $(basename "$f")"
    count=$((count + 1))
  done < <(find "$from" -type f -name "*.md" -print0)
  if [ "$count" -eq 0 ]; then
    echo "  (no .md files found)"
    return 1
  fi
  return 0
}

if [[ "$SRC" == https://*.git || "$SRC" == git@* ]]; then
  TMP=$(mktemp -d)
  echo "→ git clone $SRC"
  git clone --depth 1 "$SRC" "$TMP"
  copy_md_files "$TMP"
  rm -rf "$TMP"

elif [ -f "$SRC" ] && [[ "$SRC" == *.md ]]; then
  echo "→ copy $SRC"
  cp "$SRC" "$SKILLS_DIR/"
  echo "  + $(basename "$SRC")"

elif [[ "$SRC" == xjarvis-skill-* ]]; then
  TMP=$(mktemp -d)
  echo "→ npm pack $SRC"
  (cd "$TMP" && npm pack "$SRC" >/dev/null 2>&1) || { echo "  npm pack failed"; exit 1; }
  TGZ=$(ls "$TMP"/*.tgz | head -1)
  EXTRACT="$TMP/extract"; mkdir -p "$EXTRACT"
  tar -xzf "$TGZ" -C "$EXTRACT"
  copy_md_files "$EXTRACT"
  rm -rf "$TMP"

else
  echo "✗ Unsupported source. Provide an npm pkg (xjarvis-skill-*), git URL, or .md file."
  exit 1
fi

echo "✓ Installed into $SKILLS_DIR"
echo "  Restart the backend or reload skills: curl -X POST http://localhost:3001/api/skills/reload"
