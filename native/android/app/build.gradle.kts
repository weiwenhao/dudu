plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
    id("org.jetbrains.kotlin.plugin.compose")
}

android {
    namespace = "app.dudu.android"
    compileSdk = 36

    defaultConfig {
        applicationId = "app.dudu.android"
        minSdk = 26
        targetSdk = 36
        // The release workflow (.github/workflows/release.yml) numbers each build itself, so that a newer APK installs over an older one.
        versionCode = System.getenv("DUDU_VERSION_CODE")?.toIntOrNull() ?: 1
        versionName = "0.1.1"
        testInstrumentationRunner = "app.dudu.android.DuduTestRunner"
    }
    signingConfigs {
        // Only the release workflow signs a release build. The key is a secret of the repository, never in it.
        val keystore = System.getenv("DUDU_KEYSTORE_FILE")
        if (!keystore.isNullOrBlank()) {
            create("release") {
                storeFile = file(keystore)
                storePassword = System.getenv("DUDU_KEYSTORE_PASSWORD")
                keyAlias = System.getenv("DUDU_KEY_ALIAS")
                keyPassword = System.getenv("DUDU_KEY_PASSWORD")
            }
        }
    }
    buildTypes {
        release {
            signingConfigs.findByName("release")?.let { signingConfig = it }
        }
    }
    buildFeatures { compose = true }
    bundle { language { enableSplit = false } }
    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    testOptions {
        animationsDisabled = true
        unitTests.isReturnDefaultValues = false
    }
    packaging { resources.excludes += "/META-INF/{AL2.0,LGPL2.1}" }
}

/**
 * DSH's pages in the app get the iPhone's page bridge before their own scripts run (`Embedded.kt`; owner, 2026-11-22: a DSH page stayed white on Android). The bridge is the iPhone's own
 * file, copied into the app's assets at build time, so that both apps run the same one.
 */
abstract class PageBridgeTask : DefaultTask() {
    @get:InputFile abstract val source: RegularFileProperty
    @get:OutputDirectory abstract val output: DirectoryProperty
    @TaskAction fun copy() {
        val folder = output.get().asFile
        folder.mkdirs()
        source.get().asFile.copyTo(folder.resolve("EmbeddedTransport.js"), overwrite = true)
    }
}
val pageBridge = tasks.register<PageBridgeTask>("pageBridge") {
    source.set(rootProject.layout.projectDirectory.file("../ios/Dudu/Resources/EmbeddedTransport.js"))
}
androidComponents {
    onVariants { variant -> variant.sources.assets?.addGeneratedSourceDirectory(pageBridge, PageBridgeTask::output) }
}

kotlin {
    jvmToolchain(21)
    compilerOptions { jvmTarget.set(org.jetbrains.kotlin.gradle.dsl.JvmTarget.JVM_17) }
}

dependencies {
    val composeBom = platform("androidx.compose:compose-bom:2025.10.01")
    implementation(composeBom)
    androidTestImplementation(composeBom)
    implementation("androidx.activity:activity-compose:1.11.0")
    implementation("androidx.compose.material3:material3")
    implementation("androidx.compose.ui:ui-tooling-preview")
    implementation("androidx.lifecycle:lifecycle-viewmodel-compose:2.9.4")
    implementation("androidx.lifecycle:lifecycle-runtime-compose:2.9.4")
    implementation("org.jetbrains.kotlinx:kotlinx-coroutines-android:1.10.2")
    implementation("com.squareup.okhttp3:okhttp:4.12.0")
    // Scripts before a page's own (document start) and an origin-scoped message channel for DSH's pages, as the iPhone's WKUserScript and script message handler.
    implementation("androidx.webkit:webkit:1.14.0")
    implementation("androidx.camera:camera-camera2:1.5.1")
    implementation("androidx.camera:camera-lifecycle:1.5.1")
    implementation("androidx.camera:camera-view:1.5.1")
    implementation("com.google.mlkit:barcode-scanning:17.3.0")
    debugImplementation("androidx.compose.ui:ui-tooling")
    debugImplementation("androidx.compose.ui:ui-test-manifest")
    testImplementation("junit:junit:4.13.2")
    testImplementation("org.json:json:20240303")
    testImplementation("org.jetbrains.kotlinx:kotlinx-coroutines-test:1.10.2")
    testImplementation("com.squareup.okhttp3:mockwebserver:4.12.0")
    androidTestImplementation("androidx.test:runner:1.7.0")
    androidTestImplementation("androidx.test.ext:junit:1.3.0")
    androidTestImplementation("androidx.test.espresso:espresso-core:3.7.0")
    androidTestImplementation("androidx.compose.ui:ui-test-junit4")
}
