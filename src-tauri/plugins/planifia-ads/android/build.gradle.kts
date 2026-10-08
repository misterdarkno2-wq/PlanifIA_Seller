import org.jetbrains.kotlin.gradle.dsl.JvmTarget

plugins {
    id("com.android.library")
    id("org.jetbrains.kotlin.android")
}

android {
    namespace = "cl.planifia.ads"
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
    implementation("androidx.core:core-ktx:1.13.1")
    // Versiones estables más recientes al 7-oct-2026: GMA Next-Gen SDK 1.5.0 y UMP 4.0.0.
    implementation("com.google.android.libraries.ads.mobile.sdk:ads-mobile-sdk:1.5.0")
    implementation("com.google.android.ump:user-messaging-platform:4.0.0")
    implementation("androidx.appcompat:appcompat:1.7.1")
    implementation(project(":tauri-android"))
}
