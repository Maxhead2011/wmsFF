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
        minSdk = 24
        targetSdk = 35
        versionCode = 145 // FIX: Route box/KIZ scans directly and clear rejected KIZ values.
        versionName = "0.1.146"
    }

    flavorDimensions += "brand"
    productFlavors {
        create("logoff") {
            dimension = "brand"
            applicationId = "pro.logoff.wms.tsd"
            resValue("string", "app_name", "LOGOFF WMS TSD")
            buildConfigField("String", "BRAND_NAME", "\"LOGOFF ТСД\"")
            buildConfigField("String", "API_BASE_URL", "\"https://wms.logoff.pro/\"")
            buildConfigField("String", "APK_URL", "\"https://wms.logoff.pro/downloads/logoff-tsd.apk\"")
            manifestPlaceholders["usesCleartextTraffic"] = "false"
        }
        create("ffullhab") {
            dimension = "brand"
            applicationId = "pro.ffullhab.wms.tsd"
            versionNameSuffix = "-ff"
            resValue("string", "app_name", "ФФУЛЛ-ХАБ WMS TSD")
            buildConfigField("String", "BRAND_NAME", "\"ФФУЛЛ-ХАБ ТСД\"")
            buildConfigField("String", "API_BASE_URL", "\"https://wms.ffullhab.ru/\"")
            buildConfigField("String", "APK_URL", "\"https://wms.ffullhab.ru/downloads/ff-tsd.apk\"")
            manifestPlaceholders["usesCleartextTraffic"] = "false"
        }
        create("platform") {
            dimension = "brand"
            applicationId = "ru.ffwb.wms.tsd"
            versionNameSuffix = "-platform"
            resValue("string", "app_name", "WMS Platform TSD")
            buildConfigField("String", "BRAND_NAME", "\"WMS PLATFORM ТСД\"")
            buildConfigField("String", "API_BASE_URL", "\"http://62.113.104.175/\"")
            buildConfigField("String", "APK_URL", "\"http://62.113.104.175/downloads/wms-tsd.apk\"")
            manifestPlaceholders["usesCleartextTraffic"] = "true"
        }
    }

    buildFeatures {
        buildConfig = true
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
    testImplementation("junit:junit:4.13.2")
}
