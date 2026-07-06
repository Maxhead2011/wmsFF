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
        versionCode = 42
        versionName = "0.1.42"
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
}

dependencies {
    implementation("androidx.room:room-runtime:2.7.1")
    implementation("com.squareup.retrofit2:retrofit:2.11.0")
    implementation("com.squareup.retrofit2:converter-moshi:2.11.0")
    annotationProcessor("androidx.room:room-compiler:2.7.1")
}
