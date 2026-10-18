#!/usr/bin/env bash
# Source this only in the Codex cloud workspace. Local Android Studio builds
# should use their own JDK/SDK configuration.
export JAVA_HOME=/workspace/.tools/java/usr/lib/jvm/java-21-openjdk-amd64
export ANDROID_HOME=/workspace/.tools/android-sdk
export ANDROID_USER_HOME=/workspace/.tools/android-user-home
export ANDROID_EMULATOR_HOME=/workspace/.tools/android-user-home
export ANDROID_AVD_HOME=/workspace/.tools/android-user-home/avd
export GRADLE_USER_HOME=/workspace/.tools/gradle-home
export PATH="$JAVA_HOME/bin:$ANDROID_HOME/platform-tools:$PATH"
