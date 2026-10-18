#!/usr/bin/env bash
set -euo pipefail
cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../android"
./gradlew --no-daemon :app:assembleDebug :app:lintDebug "$@"
mkdir -p ../artifacts
cp app/build/outputs/apk/debug/app-debug.apk ../artifacts/occlude-android-preview.apk
cd ../artifacts
sha256sum occlude-android-preview.apk > occlude-android-preview.apk.sha256
