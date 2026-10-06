import java.util.Properties
import org.jetbrains.kotlin.gradle.dsl.JvmTarget

plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
    id("rust")
}

val tauriProperties = Properties().apply {
    val propFile = file("tauri.properties")
    if (propFile.exists()) {
        propFile.inputStream().use { load(it) }
    }
}

android {
    compileSdk = 37
    namespace = "cl.planifia.app"
    defaultConfig {
    manifestPlaceholders["usesCleartextTraffic"] = "false"
    applicationId = "cl.planifia.app"
    minSdk = 26
    targetSdk = 37
    versionCode = tauriProperties.getProperty("tauri.android.versionCode", "1").toInt()
    versionName = tauriProperties.getProperty("tauri.android.versionName", "1.0")
}

// La clave de carga de Google Play nunca se guarda en el repositorio: se lee del entorno.
val releaseSigning = listOf(
    "PLANIFIA_ANDROID_KEYSTORE",
    "PLANIFIA_ANDROID_STORE_PASSWORD",
    "PLANIFIA_ANDROID_KEY_ALIAS",
    "PLANIFIA_ANDROID_KEY_PASSWORD",
).associateWith { System.getenv(it).orEmpty() }
val releaseRequested = gradle.startParameter.taskNames.any { it.contains("Release", ignoreCase = true) }
if (releaseRequested && releaseSigning.values.any { it.isBlank() })
    throw GradleException(
        "Faltan variables de firma: " + releaseSigning.filterValues { it.isBlank() }.keys.joinToString() +
            ". Consulta docs/android.md."
    )
signingConfigs {
    create("release") {
        if (releaseSigning.values.none { it.isBlank() }) {
            storeFile = file(releaseSigning.getValue("PLANIFIA_ANDROID_KEYSTORE"))
            storePassword = releaseSigning.getValue("PLANIFIA_ANDROID_STORE_PASSWORD")
            keyAlias = releaseSigning.getValue("PLANIFIA_ANDROID_KEY_ALIAS")
            keyPassword = releaseSigning.getValue("PLANIFIA_ANDROID_KEY_PASSWORD")
        }
    }
}
buildTypes {
    getByName("debug") {
        applicationIdSuffix = ".debug"
        manifestPlaceholders["usesCleartextTraffic"] = "true"
        isDebuggable = true
        isJniDebuggable = true
        isMinifyEnabled = false
        packaging {
            jniLibs.keepDebugSymbols.add("*/arm64-v8a/*.so")
            jniLibs.keepDebugSymbols.add("*/armeabi-v7a/*.so")
            jniLibs.keepDebugSymbols.add("*/x86/*.so")
            jniLibs.keepDebugSymbols.add("*/x86_64/*.so")
        }
    }

    getByName("release") {
        signingConfig = signingConfigs.getByName("release")

        optimization {
            enable = true
        }

        proguardFiles(
            *fileTree(".") {
                include("**/*.pro")
                exclude("build/**")
            }.files.toTypedArray()
        )
    }
}
    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_1_8
        targetCompatibility = JavaVersion.VERSION_1_8
    }
    buildFeatures {
        buildConfig = true
    }
}

kotlin {
    compilerOptions {
        jvmTarget = JvmTarget.JVM_1_8
    }
}

rust {
    rootDirRel = "../../../"
}

dependencies {
    implementation("androidx.webkit:webkit:1.14.0")
    implementation("androidx.appcompat:appcompat:1.7.1")
    implementation("androidx.activity:activity-ktx:1.10.1")
    implementation("com.google.android.material:material:1.12.0")
    implementation("androidx.lifecycle:lifecycle-process:2.10.0")
    testImplementation("junit:junit:4.13.2")
    androidTestImplementation("androidx.test.ext:junit:1.1.4")
    androidTestImplementation("androidx.test.espresso:espresso-core:3.5.0")
}

apply(from = file("tauri.build.gradle.kts"))
