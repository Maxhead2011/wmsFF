plugins {
    id("com.android.application")
}

val tsdKeystorePath = System.getenv("TSD_KEYSTORE_PATH")
val tsdKeystorePassword = System.getenv("TSD_KEYSTORE_PASSWORD")
val tsdKeyAlias = System.getenv("TSD_KEY_ALIAS")
val tsdKeyPassword = System.getenv("TSD_KEY_PASSWORD")

android {
    namespace = "pro.logoff.wms.tsd"
    compileSdk = 35

    defaultConfig {
        applicationId = "pro.logoff.wms.tsd"
        minSdk = 26
        targetSdk = 35
        versionCode = 67
        versionName = "0.1.67"
    }

    signingConfigs {
        create("logoffRelease") {
            if (!tsdKeystorePath.isNullOrBlank()) {
                storeFile = file(tsdKeystorePath)
                storePassword = tsdKeystorePassword
                keyAlias = tsdKeyAlias
                keyPassword = tsdKeyPassword
            }
        }
    }

    buildTypes {
        getByName("release") {
            if (!tsdKeystorePath.isNullOrBlank()) {
                signingConfig = signingConfigs.getByName("logoffRelease")
            }
            isMinifyEnabled = false
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
}

dependencies {
    implementation("androidx.room:room-runtime:2.7.1")
    implementation("com.journeyapps:zxing-android-embedded:4.3.0")
    implementation("com.squareup.retrofit2:retrofit:2.11.0")
    implementation("com.squareup.retrofit2:converter-moshi:2.11.0")
    annotationProcessor("androidx.room:room-compiler:2.7.1")
}
