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
sed -i 's/compileSdk = flutter\.compileSdkVersion/compileSdk = 36/' android/app/build.gradle.kts
if ! grep -q 'plugins.withId("com.android.library")' android/build.gradle.kts; then
  cat >> android/build.gradle.kts <<'GRADLE'

subprojects {
    fun forceCompileSdk36() {
        extensions.findByName("android")?.let { androidExtension ->
            androidExtension.javaClass.methods
                .firstOrNull { method ->
                    method.name == "setCompileSdk" && method.parameterTypes.size == 1
                }
                ?.invoke(androidExtension, 36)
        }
    }
    plugins.withId("com.android.application") {
        forceCompileSdk36()
    }
    plugins.withId("com.android.library") {
        forceCompileSdk36()
    }
}
GRADLE
fi
flutter pub get
flutter build apk --debug

cp "$APP_DIR/build/app/outputs/flutter-apk/app-debug.apk" "$DIST_DIR/ActitPassStorage-android-debug.apk"
echo "APK готов: $DIST_DIR/ActitPassStorage-android-debug.apk"
