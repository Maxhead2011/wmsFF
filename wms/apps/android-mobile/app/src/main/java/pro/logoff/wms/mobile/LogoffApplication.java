package pro.logoff.wms.mobile;

import android.app.Application;

import androidx.work.Constraints;
import androidx.work.ExistingPeriodicWorkPolicy;
import androidx.work.NetworkType;
import androidx.work.PeriodicWorkRequest;
import androidx.work.WorkManager;

import com.google.firebase.FirebaseApp;
import com.google.firebase.FirebaseOptions;

import java.util.concurrent.TimeUnit;

import pro.logoff.wms.mobile.data.AppDatabase;
import pro.logoff.wms.mobile.network.MobileRepository;
import pro.logoff.wms.mobile.network.NetworkFactory;
import pro.logoff.wms.mobile.push.NotificationCenter;
import pro.logoff.wms.mobile.push.NotificationWorker;
import pro.logoff.wms.mobile.session.SessionStore;
import pro.logoff.wms.mobile.sync.SyncWorker;

public class LogoffApplication extends Application {
    private SessionStore sessionStore;
    private AppDatabase database;
    private MobileRepository repository;
    private AppState appState;

    @Override
    public void onCreate() {
        super.onCreate();
        sessionStore = new SessionStore(this);
        database = AppDatabase.get(this);
        repository = new MobileRepository(NetworkFactory.create(sessionStore), database.cacheDao());
        appState = new AppState();
        NotificationCenter.createChannels(this);
        initializeFirebase();
        scheduleSync();
    }

    public SessionStore sessions() { return sessionStore; }
    public AppDatabase database() { return database; }
    public MobileRepository repository() { return repository; }
    public AppState state() { return appState; }

    private void scheduleSync() {
        Constraints constraints = new Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build();
        PeriodicWorkRequest request = new PeriodicWorkRequest.Builder(SyncWorker.class, 15, TimeUnit.MINUTES)
                .setConstraints(constraints)
                .build();
        WorkManager.getInstance(this).enqueueUniquePeriodicWork("mobile-sync", ExistingPeriodicWorkPolicy.UPDATE, request);
        PeriodicWorkRequest notifications = new PeriodicWorkRequest.Builder(NotificationWorker.class, 15, TimeUnit.MINUTES)
                .setConstraints(constraints)
                .build();
        WorkManager.getInstance(this).enqueueUniquePeriodicWork(
                "mobile-notifications",
                ExistingPeriodicWorkPolicy.UPDATE,
                notifications
        );
    }

    private void initializeFirebase() {
        if (!FirebaseApp.getApps(this).isEmpty()) return;
        if (BuildConfig.FIREBASE_APPLICATION_ID.isBlank()
                || BuildConfig.FIREBASE_API_KEY.isBlank()
                || BuildConfig.FIREBASE_PROJECT_ID.isBlank()
                || BuildConfig.FIREBASE_SENDER_ID.isBlank()) return;
        FirebaseOptions options = new FirebaseOptions.Builder()
                .setApplicationId(BuildConfig.FIREBASE_APPLICATION_ID)
                .setApiKey(BuildConfig.FIREBASE_API_KEY)
                .setProjectId(BuildConfig.FIREBASE_PROJECT_ID)
                .setGcmSenderId(BuildConfig.FIREBASE_SENDER_ID)
                .build();
        FirebaseApp.initializeApp(this, options);
    }
}
