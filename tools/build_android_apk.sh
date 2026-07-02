#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
APP_DIR="$ROOT_DIR/app"
DIST_DIR="$ROOT_DIR/dist"

command -v flutter >/dev/null 2>&1 || {
  echo "Flutter SDK не найден. Установите Flutter stable и добавьте flutter в PATH." >&2
  exit 1
}

mkdir -p "$DIST_DIR"
cd "$APP_DIR"

flutter create --platforms=android,linux,windows .
flutter pub get
flutter build apk --debug

cp "$APP_DIR/build/app/outputs/flutter-apk/app-debug.apk" "$DIST_DIR/ActitPassStorage-android-debug.apk"
echo "APK готов: $DIST_DIR/ActitPassStorage-android-debug.apk"
