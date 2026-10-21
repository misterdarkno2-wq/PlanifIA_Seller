import org.jetbrains.kotlin.gradle.dsl.JvmTarget

plugins {
    id("com.android.library")
    id("org.jetbrains.kotlin.android")
}

android {
    namespace = "cl.planifia.auth"
    compileSdk = 36

    defaultConfig {
        minSdk = 26
        consumerProguardFiles("consumer-rules.pro")
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_1_8
        targetCompatibility = JavaVersion.VERSION_1_8
    }
}

kotlin {
    compilerOptions {
        jvmTarget = JvmTarget.JVM_1_8
    }
}

dependencies {
    // Versiones estables más recientes al 21-oct-2026: Credential Manager 1.6.0 y Google ID 1.2.1.
    implementation("androidx.credentials:credentials:1.6.0")
    // Proveedor de Credential Manager en Android 13 y anteriores (usa Google Play Services).
    implementation("androidx.credentials:credentials-play-services-auth:1.6.0")
    implementation("com.google.android.libraries.identity.googleid:googleid:1.2.1")
    // GoogleApiAvailability: avisar si falta o hay que actualizar Google Play Services.
    implementation("com.google.android.gms:play-services-base:18.10.0")
    implementation("androidx.appcompat:appcompat:1.7.1")
    implementation(project(":tauri-android"))
}
