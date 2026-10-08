import org.jetbrains.kotlin.gradle.dsl.JvmTarget

plugins {
    id("com.android.library")
    id("org.jetbrains.kotlin.android")
}

android {
    namespace = "cl.planifia.billing"
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
    // Versión estable más reciente al 7-oct-2026: Play Billing Library 9.1.0.
    implementation("com.android.billingclient:billing:9.1.0")
    implementation("androidx.appcompat:appcompat:1.7.1")
    implementation(project(":tauri-android"))
}
