import groovy.json.JsonSlurper

plugins { id("com.android.application"); id("org.jetbrains.kotlin.android") }
val pythonCommand = providers.gradleProperty("aidotPython").getOrElse(if (System.getProperty("os.name").startsWith("Windows")) "python" else "python3")
val aidotPackage = JsonSlurper().parse(rootProject.file("../package.json")) as Map<*, *>
val aidotVersion = aidotPackage["version"].toString()
val aidotVersionParts = aidotVersion.split('.').map { it.toIntOrNull() ?: error("Android release requires a stable numeric package version") }
require(aidotVersionParts.size == 3 && aidotVersionParts.all { it in 0..99 }) { "Android version components must be 0..99" }
val aidotVersionCode = aidotVersionParts[0] * 10000 + aidotVersionParts[1] * 100 + aidotVersionParts[2]
val aidotAbis = providers.gradleProperty("aidotAbis").getOrElse("arm64-v8a,x86_64").split(',')
require(aidotAbis.isNotEmpty() && aidotAbis.all { it in listOf("arm64-v8a", "x86_64") }) { "Unsupported Android ABI" }
val signingNames = listOf("AIDOT_ANDROID_KEYSTORE", "AIDOT_ANDROID_STORE_PASSWORD", "AIDOT_ANDROID_KEY_ALIAS", "AIDOT_ANDROID_KEY_PASSWORD")
val signingValues = signingNames.map { System.getenv(it) }
require(signingValues.all { it == null } || signingValues.all { !it.isNullOrBlank() }) { "Provide all four AIDOT_ANDROID signing environment variables, or none for an unsigned release" }
android {
 namespace = "com.aidot.mini"
 compileSdk = 36
 defaultConfig {
  applicationId = "com.aidot.mini"
  minSdk = 26
  targetSdk = 36
  versionCode = aidotVersionCode
  versionName = aidotVersion
 }
 // A PIE executable must be extracted to nativeLibraryDir before ProcessBuilder can run it.
 packaging { jniLibs { useLegacyPackaging = true; keepDebugSymbols += "**/*.so" } }
 splits { abi { isEnable = true; reset(); include(*aidotAbis.toTypedArray()); isUniversalApk = false } }
 signingConfigs {
  if (signingValues.all { it != null }) create("aidotRelease") {
   storeFile = file(signingValues[0]!!)
   storePassword = signingValues[1]
   keyAlias = signingValues[2]
   keyPassword = signingValues[3]
  }
 }
 buildTypes { release { if (signingValues.all { it != null }) signingConfig = signingConfigs.getByName("aidotRelease"); isMinifyEnabled = false; proguardFiles(getDefaultProguardFile("proguard-android-optimize.txt"), "proguard-rules.pro") } }
 compileOptions { sourceCompatibility = JavaVersion.VERSION_17; targetCompatibility = JavaVersion.VERSION_17 }
 kotlinOptions { jvmTarget = "17" }
}
dependencies {
 implementation("androidx.core:core-ktx:1.15.0")
 implementation("androidx.appcompat:appcompat:1.7.0")
}
// Gate APK packaging, while compileDebugKotlin can diagnose source errors without a runtime.
tasks.matching { it.name.startsWith("package") && (it.name.endsWith("Debug") || it.name.endsWith("Release")) }.configureEach {
 doFirst {
  aidotAbis.forEach { require(file("src/main/jniLibs/$it/libnode_exec.so").isFile) { "Missing Android runtime for $it; run npm run dist:android -- --prepare-only" } }
  exec { workingDir(rootProject.projectDir.parentFile); commandLine(pythonCommand, "android/scripts/check-runtime.py") }
 }
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
 inputs.files(rootProject.file("runtime-license-manifest.json"), rootProject.file("scripts/runtime_licenses.py"))
 inputs.files(rootProject.file("../start.js"), rootProject.file("../package.json"), rootProject.file("scripts/build-assets.py"))
 outputs.dir(layout.projectDirectory.dir("src/main/assets"))
}
tasks.named("preBuild").configure { dependsOn(buildServerAssets) }
