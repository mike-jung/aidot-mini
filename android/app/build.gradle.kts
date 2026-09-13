plugins { id("com.android.application"); id("org.jetbrains.kotlin.android") }
val pythonCommand = providers.gradleProperty("aidotPython").getOrElse(if (System.getProperty("os.name").startsWith("Windows")) "python" else "python3")
android {
 namespace = "com.aidot.mini"
 compileSdk = 36
 defaultConfig {
  applicationId = "com.aidot.mini"
  minSdk = 26
  targetSdk = 36
  versionCode = 10
  versionName = "0.6.2"
 }
 // A PIE executable must be extracted to nativeLibraryDir before ProcessBuilder can run it.
 packaging { jniLibs { useLegacyPackaging = true; keepDebugSymbols += "**/*.so" } }
 splits { abi { isEnable = true; reset(); include(*listOf("arm64-v8a", "x86_64").filter { file("src/main/jniLibs/$it/libnode_exec.so").exists() }.ifEmpty { listOf("arm64-v8a") }.toTypedArray()); isUniversalApk = false } }
 buildTypes { release { isMinifyEnabled = false; proguardFiles(getDefaultProguardFile("proguard-android-optimize.txt"), "proguard-rules.pro") } }
 compileOptions { sourceCompatibility = JavaVersion.VERSION_17; targetCompatibility = JavaVersion.VERSION_17 }
 kotlinOptions { jvmTarget = "17" }
}
dependencies {
 implementation("androidx.core:core-ktx:1.15.0")
 implementation("androidx.appcompat:appcompat:1.7.0")
}
// Gate APK packaging, while compileDebugKotlin can diagnose source errors without a runtime.
tasks.matching { it.name.startsWith("package") && (it.name.endsWith("Debug") || it.name.endsWith("Release")) }.configureEach {
 doFirst { exec { workingDir(rootProject.projectDir.parentFile); commandLine(pythonCommand, "android/scripts/check-runtime.py") } }
}

// Rebuild assets from current sources so an APK cannot silently ship stale JS.
val buildServerAssets by tasks.registering(Exec::class) {
 workingDir(rootProject.projectDir.parentFile)
 commandLine(pythonCommand, "android/scripts/build-assets.py")
 inputs.dir(rootProject.file("../src"))
 inputs.dir(rootProject.file("../public"))
 inputs.dir(rootProject.file("../workspace"))
 inputs.dir(rootProject.file("../node_modules/esbuild-wasm"))
 inputs.dir(rootProject.file("../docs/third-party"))
 inputs.file(rootProject.file("../docs/THIRD_PARTY_NOTICES.md"))
 inputs.file(rootProject.file("../scripts/runtime_assets.py"))
 inputs.dir(rootProject.file("../modules/robot-client"))
 inputs.dir(rootProject.file("runtime-licenses"))
 inputs.files(rootProject.file("../start.js"), rootProject.file("../package.json"), rootProject.file("scripts/build-assets.py"))
 outputs.dir(layout.projectDirectory.dir("src/main/assets"))
}
tasks.named("preBuild").configure { dependsOn(buildServerAssets) }
