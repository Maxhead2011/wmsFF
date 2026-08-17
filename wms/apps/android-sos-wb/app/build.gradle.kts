plugins { id("com.android.application") }
val ksPath=System.getenv("TSD_KEYSTORE_PATH");val ksPass=System.getenv("TSD_KEYSTORE_PASSWORD");val ksAlias=System.getenv("TSD_KEY_ALIAS");val keyPass=System.getenv("TSD_KEY_PASSWORD")
android {
  namespace="pro.logoff.wms.soswb";compileSdk=35
  defaultConfig { applicationId="pro.logoff.wms.soswb.v2";minSdk=26;targetSdk=35;versionCode=4;versionName="1.0.3" }
  signingConfigs { create("releaseKey") { if(!ksPath.isNullOrBlank()){storeFile=file(ksPath);storePassword=ksPass;keyAlias=ksAlias;keyPassword=keyPass} } }
  buildTypes { getByName("release") { if(!ksPath.isNullOrBlank())signingConfig=signingConfigs.getByName("releaseKey");isMinifyEnabled=false } }
  compileOptions { sourceCompatibility=JavaVersion.VERSION_17;targetCompatibility=JavaVersion.VERSION_17 }
}
