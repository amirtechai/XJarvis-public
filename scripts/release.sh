#!/usr/bin/env bash
# XJarvis release — rebuild static export, repackage Tauri .app, patch
# Info.plist with required usage descriptions, install to /Applications.
#
# Usage:  npm run release
set -e

SRC_APP="src-tauri/target/release/bundle/macos/XJarvis.app"
DEST_APP="/Applications/XJarvis.app"
PLIST="$DEST_APP/Contents/Info.plist"

echo "→ npm run build"
npm run build

echo "→ cargo tauri build (.app + .dmg)"
# DMG bundling can fail (AppleScript permissions) — that's fine, .app is what we ship.
npm run tauri:build || echo "  (tauri build returned non-zero, checking app bundle…)"

if [ ! -d "$SRC_APP" ]; then
  echo "✗ Build failed: $SRC_APP not found"
  exit 1
fi

echo "→ Quitting running XJarvis"
osascript -e 'tell application "XJarvis" to quit' 2>/dev/null || true
sleep 1
pkill -f "XJarvis.app/Contents/MacOS/xjarvis" 2>/dev/null || true

echo "→ Installing to /Applications"
rm -rf "$DEST_APP"
cp -R "$SRC_APP" "$DEST_APP"

echo "→ Patching Info.plist with usage descriptions"
PB=/usr/libexec/PlistBuddy
add() {
  local key="$1" val="$2"
  "$PB" -c "Add :$key string $val" "$PLIST" 2>/dev/null || \
    "$PB" -c "Set :$key $val" "$PLIST"
}
add NSMicrophoneUsageDescription   "XJarvis sesli komutları dinlemek için mikrofona erişir."
add NSCameraUsageDescription       "XJarvis vision aracılığıyla görüntü almak için kameraya erişir."
add NSAppleEventsUsageDescription  "XJarvis macOS uygulamalarını otomasyon için kontrol eder."
add NSContactsUsageDescription     "XJarvis kişilerinizi sohbete dahil etmek için erişir."
add NSCalendarsUsageDescription    "XJarvis takvim olaylarını listelemek/oluşturmak için erişir."
add NSRemindersUsageDescription    "XJarvis hatırlatıcıları okumak ve eklemek için erişir."
add NSPhotoLibraryUsageDescription "XJarvis ekran görüntülerini Photos kütüphanesine kaydedebilir."
add NSDesktopFolderUsageDescription "XJarvis Desktop klasöründeki dosyaları açıp kaydeder."
add NSDocumentsFolderUsageDescription "XJarvis Documents klasöründeki dosyalara erişebilir."
add NSDownloadsFolderUsageDescription "XJarvis Downloads klasöründeki dosyalara erişebilir."

# Re-sign ad-hoc to refresh the bundle hash (required after plist edit)
echo "→ Ad-hoc re-signing"
codesign --force --deep --sign - "$DEST_APP" 2>/dev/null || true

echo "→ Launching XJarvis"
open "$DEST_APP"

# launchd ile yönetilen python daemon'lar (voice/vision) app restart'ında YENİDEN
# BAŞLAMAZ → voice/*.py & vision/*.py değişiklikleri yüklenmez. Burada kickstart
# ederek yeni kodu zorla yükle (yoksa her voice değişikliği ölü doğar).
echo "→ Restarting launchd daemons (voice/vision) to load new Python code"
for svc in com.jarvis.voice com.jarvis.vision; do
  launchctl kickstart -k "gui/$(id -u)/$svc" 2>/dev/null || true
done

echo "✓ Release complete: $DEST_APP"
