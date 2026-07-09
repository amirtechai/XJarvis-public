#!/usr/bin/env bash
# Lightweight secret scan — runs against staged files. Wire as pre-commit:
#   ln -s ../../scripts/secret_scan.sh .git/hooks/pre-commit
set -euo pipefail

PATTERNS=(
  'sk-or-v1-[A-Za-z0-9]{20,}'           # OpenRouter
  'sk-[A-Za-z0-9]{40,}'                 # OpenAI/Anthropic
  'ghp_[A-Za-z0-9]{30,}'                # GitHub PAT
  'github_pat_[A-Za-z0-9_]{40,}'        # GitHub fine-grained
  'AIza[0-9A-Za-z\-_]{30,}'             # Google API
  'AKIA[0-9A-Z]{16}'                    # AWS access key
  'xox[baprs]-[A-Za-z0-9-]{20,}'        # Slack
  'pcsk_[A-Za-z0-9_]+'                  # Picovoice
  'dgm_[A-Za-z0-9]{20,}'                # Deepgram (best-effort)
)

# Files to scan: staged in commit, or all tracked if running ad-hoc
FILES=$(git diff --cached --name-only --diff-filter=ACM 2>/dev/null || git ls-files)
[ -z "$FILES" ] && exit 0

FOUND=0
while IFS= read -r f; do
  [ -f "$f" ] || continue
  case "$f" in
    *.png|*.jpg|*.jpeg|*.gif|*.icns|*.lock|*.tsbuildinfo|node_modules/*) continue ;;
  esac
  for pat in "${PATTERNS[@]}"; do
    if grep -InE "$pat" -- "$f" >/dev/null 2>&1; then
      echo "SECRET FOUND in $f matching: $pat" >&2
      grep -InE "$pat" -- "$f" >&2 || true
      FOUND=1
    fi
  done
done <<< "$FILES"

if [ $FOUND -ne 0 ]; then
  echo
  echo "Aborting commit. Remove the secret and try again."
  echo "If this is a false positive, edit scripts/secret_scan.sh."
  exit 1
fi
exit 0
