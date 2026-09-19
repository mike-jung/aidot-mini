# Android application builds — 1.0.11

The Android app runs a local Node server in a foreground service and opens the
console in a WebView. Its bundled profile listens on loopback. The source HTTPS
certificate command does not configure the APK's fixed local endpoint.


## Current release command

Use the source-root command for the current release workflow:

```sh
npm ci --ignore-scripts
npm run dist:android
# Build only the ABI required for a device when appropriate:
npm run dist:android -- --abi arm64-v8a
```

This imports and checks the pinned Bionic runtime, regenerates server assets, runs Gradle and copies actual APK outputs to `dist/release/` with SHA-256 metadata. It fails when the native runtime, SDK or build requirements are unavailable. `--prepare-only` stops after preparing assets/runtime and does **not** produce an APK. `--debug-only` requests debug APKs only.

Without an owner-provided release signing configuration, release output is explicitly named `-release-unsigned.apk`. It is not an installable signed public release. Debug APKs use a debug key for validation; they do not establish your production signing identity. See the current [Android build and signing guide](../android/README.md) for environment variables, ABI options and exact checks, and the previous [1.0.8 validation record](RELEASE_1.0.8_KO.md) for actual completed builds/device runs.

The step-by-step commands below remain useful for diagnosing the build pipeline. Generated assets alone are not a successful APK build, and building an APK does not prove installation or foreground operation on a device.

## Requirements

Use JDK 17 or 21, Android SDK 36, the project's Gradle wrapper and Python 3.
The release command prepares missing npm dependencies automatically; you can
also run `npm ci --ignore-scripts` first. Configure the SDK
using `ANDROID_HOME` or your local Android SDK configuration. The app's Gradle
configuration specifies its build tools and SDK levels.

Android uses Bionic runtimes for ARM64 or x86_64, not Linux glibc binaries. Source
archives contain runtime locks, import scripts and notices; large native runtime
files must be supplied before building an APK.

## Import the pinned native runtime

From the project root:

```sh
python3 android/scripts/import-runtime.py --abi arm64-v8a --cache ./runtime-cache/arm64 --download
python3 android/scripts/import-runtime.py --abi x86_64 --cache ./runtime-cache/x86_64 --download
```

Only pinned packages and hashes are accepted. If a pinned package is no longer
available, update the runtime lock with appropriate target verification rather
than silently substituting a binary. An existing compatible APK can also supply
a runtime using `--abi <abi> --from-apk /path/to/compatible.apk`.

## Build and install

```sh
python3 android/scripts/build-assets.py
python3 android/scripts/check-runtime.py
python3 android/scripts/check-android.py
cd android
./gradlew :app:assembleDebug
```

On Windows use `python` if `python3` is unavailable, and `gradlew.bat` in the
Android directory. The debug APKs are written under
`android/app/build/outputs/apk/debug/` for `arm64-v8a` and `x86_64`.

```sh
adb install -r app-arm64-v8a-debug.apk
adb shell am start -n com.aidot.mini/.MainActivity
```

Use the APK path and ABI matching your device. Release distribution requires
your own signing configuration. Version and metadata checks are not a substitute
for compiling, installing and testing the APK on the intended Android device.

## Storage and operation

Workspace paths must be accessible to the app UID, normally inside app-private
storage. Arbitrary shared-storage workspace selection is not provided. Account,
SQLite and workspace state are kept separately from the installed native runtime.
The native executable is launched from the installed native-library directory.

Foreground operation does not guarantee permanent execution. Force-stop, reboot,
OEM power management and background limits need a deployment policy and testing
on the target device. Choose a Linux board or an appropriately managed Android
device for an always-on service. Verify login, CRUD, persistence, foreground
notification behavior and recovery after restart on each supported target.
