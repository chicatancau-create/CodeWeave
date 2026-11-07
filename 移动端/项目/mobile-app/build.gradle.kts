plugins {
    id("com.android.application")
    kotlin("android")
    id("org.jetbrains.kotlin.plugin.compose")
}

android { namespace = "com.codeweave.mobile"; compileSdk = 35
    defaultConfig { applicationId = "com.codeweave.mobile"; minSdk = 26; targetSdk = 35; versionCode = 1; versionName = "0.1.0" }
    buildFeatures { compose = true }
}

kotlin { jvmToolchain(17) }

dependencies {
    implementation("androidx.activity:activity-compose:1.10.1")
    implementation("androidx.compose.ui:ui:1.8.2")
    implementation("androidx.compose.material3:material3:1.3.2")
    implementation("androidx.compose.ui:ui-tooling-preview:1.8.2")
}
