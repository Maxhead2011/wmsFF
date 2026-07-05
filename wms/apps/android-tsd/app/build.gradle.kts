plugins {
    id("com.android.application")
}

android {
    namespace = "pro.logoff.wms.tsd"
    compileSdk = 35

    defaultConfig {
        applicationId = "pro.logoff.wms.tsd"
        minSdk = 26
        targetSdk = 35
        versionCode = 39
        versionName = "0.1.39"
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_21
        targetCompatibility = JavaVersion.VERSION_21
    }
}

dependencies {
    implementation("androidx.room:room-runtime:2.7.1")
    implementation("com.squareup.retrofit2:retrofit:2.11.0")
    implementation("com.squareup.retrofit2:converter-moshi:2.11.0")
    annotationProcessor("androidx.room:room-compiler:2.7.1")
}
