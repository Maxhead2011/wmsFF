package pro.logoff.wms.tsd;

import android.content.Context;
import android.content.SharedPreferences;
import android.view.View;
import android.view.ViewGroup;
import android.widget.Spinner;
import android.widget.TextView;
import java.lang.reflect.Field;
import java.util.Collections;
import java.util.List;
import java.util.Map;
import java.util.concurrent.AbstractExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;
import org.junit.After;
import org.junit.Before;
import org.junit.Test;
import org.junit.runner.RunWith;
import org.robolectric.Robolectric;
import org.robolectric.RobolectricTestRunner;
import org.robolectric.RuntimeEnvironment;
import org.robolectric.annotation.Config;
import pro.logoff.wms.tsd.auth.TsdSessionStore;
import pro.logoff.wms.tsd.data.OperationEntity;
import pro.logoff.wms.tsd.data.TsdDatabase;
import static org.junit.Assert.*;

@RunWith(RobolectricTestRunner.class)
@Config(sdk = 28)
@org.robolectric.annotation.SQLiteMode(org.robolectric.annotation.SQLiteMode.Mode.LEGACY)
public class ServerSelectionTest {
    private Context app;
    @Before public void prepare() {
        org.junit.Assume.assumeTrue("logoff".equals(BuildConfig.FLAVOR));
        app = RuntimeEnvironment.getApplication();
        app.getSharedPreferences(ServerSettings.PREFS, 0).edit().clear().commit();
        ServerSettings.select(app, ServerSettings.MAIN);
        pro.logoff.wms.tsd.network.WmsApiFactory.idleSession(ServerSettings.MAIN_URL,null);
        pro.logoff.wms.tsd.network.WmsApiFactory.idleSession(ServerSettings.BACKUP_URL,null);
        for (String profile : new String[]{ServerSettings.MAIN, ServerSettings.BACKUP}) {
            new ServerScopedContext(app, profile).getSharedPreferences("logoff_wms_tsd_session", 0)
                .edit().clear().commit();
        }
    }
    @After public void closeDatabases() throws Exception {
        if (app == null) return;
        Field field = TsdDatabase.class.getDeclaredField("instances"); field.setAccessible(true);
        Map<?, ?> databases = (Map<?, ?>) field.get(null);
        for (Object db : databases.values()) ((TsdDatabase) db).close();
        databases.clear();
    }

    @Test public void legacyMainSessionStaysMainAndBackupNeverReusesIt() {
        saveSession(app, "legacy-main-token");
        Context main = new ServerScopedContext(app, ServerSettings.MAIN);
        Context backup = new ServerScopedContext(app, ServerSettings.BACKUP);
        assertEquals("legacy-main-token", new TsdSessionStore(main).load().accessToken);
        assertNull(new TsdSessionStore(backup).load());
        saveSession(backup, "backup-token");
        assertEquals("backup-token", new TsdSessionStore(backup).load().accessToken);
        assertEquals("legacy-main-token", new TsdSessionStore(main).load().accessToken);
        ServerSettings.select(backup, ServerSettings.BACKUP);
        assertEquals(ServerSettings.BACKUP, ServerSettings.selected(app));
        assertEquals(ServerSettings.BACKUP_URL, ServerSettings.baseUrl(ServerSettings.selected(app)));
    }

    @Test public void pendingScansAndDraftsStayWithTheirOriginalEndpoint() throws Exception {
        Context main = new ServerScopedContext(app, ServerSettings.MAIN);
        Context backup = new ServerScopedContext(app, ServerSettings.BACKUP);
        app.getSharedPreferences("fbs-pending", 0).edit().putString("order", "main-draft").commit();
        assertEquals("main-draft", main.getSharedPreferences("fbs-pending", 0).getString("order", ""));
        assertFalse(backup.getSharedPreferences("fbs-pending", 0).contains("order"));
        backup.getSharedPreferences("fbs-pending", 0).edit().putString("order", "backup-draft").commit();
        TsdDatabase mainDb = TsdDatabase.get(main), backupDb = TsdDatabase.get(backup);
        assertNotSame(mainDb, backupDb);
        assertEquals(app.getDatabasePath("logoff_wms_tsd.db"), main.getDatabasePath("logoff_wms_tsd.db"));
        assertNotEquals(main.getDatabasePath("logoff_wms_tsd.db"), backup.getDatabasePath("logoff_wms_tsd.db"));
        var executor = Executors.newSingleThreadExecutor();
        try {
            executor.submit(() -> {
                OperationEntity row = new OperationEntity(); row.operationKey = "main-pending";
                row.operationType = "receipt_scan"; row.payloadJson = "{}"; row.status = "PENDING";
                mainDb.operationDao().insert(row);
                assertEquals(0, backupDb.operationDao().countByStatus("PENDING"));
                row.operationKey = "backup-pending"; backupDb.operationDao().insert(row);
                assertNull(mainDb.operationDao().findByKey("backup-pending"));
                assertNull(backupDb.operationDao().findByKey("main-pending"));
                return null;
            }).get(30, TimeUnit.SECONDS);
        } finally { executor.shutdownNow(); }
        assertTrue(backup.getDatabasePath("logoff_wms_tsd.db").isFile());
        assertEquals("main-draft", main.getSharedPreferences("fbs-pending", 0).getString("order", ""));
        assertSame(mainDb, TsdDatabase.get(main));
    }

    @Test public void backupActivityRoutesEveryMainWorkflowAndUpdatesToBackup() throws Exception {
        ServerSettings.select(app, ServerSettings.BACKUP);
        try (var controller = Robolectric.buildActivity(MainActivity.class)) {
            MainActivity a = controller.get(); quiet(a); controller.setup();
            assertEquals(ServerSettings.BACKUP_URL, value(a, "activeBaseUrl"));
            assertTrue(((android.content.ContextWrapper)a.getApplicationContext()).getBaseContext()
                instanceof android.app.Application);
            assertEquals(ServerSettings.BACKUP_URL + ServerSettings.apkPath(a.getPackageName()), value(a, "activeApkUrl"));
            assertTrue(text(a.getWindow().getDecorView()).contains("Резервный сервер"));
            Spinner selector = serverSpinner(a.getWindow().getDecorView());
            assertNotNull(selector); assertTrue(selector.isEnabled()); assertEquals(1, selector.getSelectedItemPosition());
        }
    }

    @Test public void authenticatedOperatorMustLogOutBeforeChangingServer() throws Exception {
        saveSession(app, "main-token");
        activeIdleSession(app,"main-token",ServerSettings.MAIN_URL);
        try (var controller = Robolectric.buildActivity(MainActivity.class)) {
            MainActivity a = controller.get(); quiet(a); controller.setup();
            var render = MainActivity.class.getDeclaredMethod("renderSettingsScreen"); render.setAccessible(true); render.invoke(a);
            Spinner selector = serverSpinner(a.getWindow().getDecorView());
            assertNotNull(selector); assertFalse(selector.isEnabled());
            assertEquals(ServerSettings.MAIN_URL, value(a, "activeBaseUrl"));
        }
    }

    @Test public void secondaryTransferScreenUsesBackupSessionAndRoute() throws Exception {
        ServerSettings.select(app, ServerSettings.BACKUP);
        saveSession(new ServerScopedContext(app, ServerSettings.BACKUP), "backup-token");
        activeIdleSession(new ServerScopedContext(app, ServerSettings.BACKUP),"backup-token",ServerSettings.BACKUP_URL);
        try (var controller = Robolectric.buildActivity(StorageBoxTransferActivity.class).setup()) {
            StorageBoxTransferActivity a = controller.get();
            assertFalse(a.isFinishing()); assertEquals(ServerSettings.BACKUP_URL, value(a, "activeBaseUrl"));
            assertEquals("backup-token", new TsdSessionStore(a).load().accessToken);
        }
    }

    @Test public void backupApiRequestsUseHttpsAndApiRootRatherThanWebPagePath() {
        var request = pro.logoff.wms.tsd.network.WmsApiFactory.create(ServerSettings.BACKUP_URL)
            .receiptPlacementTasks("Bearer backup-only").request();
        assertEquals("https", request.url().scheme());
        assertEquals("77.37.144.211", request.url().host());
        assertTrue(request.url().encodedPath().startsWith("/api/v1/"));
        assertFalse(request.url().encodedPath().startsWith("/WMS"));
        assertEquals("Bearer backup-only", request.header("Authorization"));
    }

    @Test public void cancellingServerChangePreservesMainSelection() throws Exception {
        try (var controller = Robolectric.buildActivity(MainActivity.class)) {
            MainActivity a = controller.get(); quiet(a); controller.setup();
            Spinner spinner = serverSpinner(a.getWindow().getDecorView());
            spinner.setSelection(1);
            org.robolectric.Shadows.shadowOf(android.os.Looper.getMainLooper()).idle();
            var dialog = org.robolectric.shadows.ShadowAlertDialog.getLatestAlertDialog();
            assertNotNull(dialog);
            dialog.getButton(android.app.AlertDialog.BUTTON_NEGATIVE).performClick();
            assertEquals(ServerSettings.MAIN, ServerSettings.selected(app));
            assertEquals(ServerSettings.MAIN_URL, value(a, "activeBaseUrl"));
        }
    }

    @Test public void separateInstallationDefaultsToBackupAndHasItsOwnUpdateChannel() {
        app.getSharedPreferences(ServerSettings.PREFS, 0).edit().clear().commit();
        assertEquals(ServerSettings.defaultProfile(app.getPackageName()), ServerSettings.selected(app));
        assertEquals(ServerSettings.BACKUP, ServerSettings.defaultProfile("pro.logoff.wms.tsd.servers"));
        assertEquals(ServerSettings.MAIN, ServerSettings.defaultProfile("pro.logoff.wms.tsd"));
        assertEquals("downloads/logoff-tsd-server-choice.apk", ServerSettings.apkPath("pro.logoff.wms.tsd.servers"));
        assertEquals("downloads/logoff-tsd.apk", ServerSettings.apkPath("pro.logoff.wms.tsd"));
    }

    // TEST: represent an authenticated current-version terminal, not a legacy token needing re-login.
    private static void activeIdleSession(Context context,String token,String baseUrl){
        var gate=new pro.logoff.wms.tsd.auth.TsdIdleSession(context.getSharedPreferences("tsd_idle_session",0),
            new pro.logoff.wms.tsd.auth.TsdIdleSession.Clock(){
                public long elapsed(){return android.os.SystemClock.elapsedRealtime();}
                public long wall(){return System.currentTimeMillis();}
            },()->{},null);
        gate.login("Bearer "+token);pro.logoff.wms.tsd.network.WmsApiFactory.idleSession(baseUrl,gate);
    }
    private static void saveSession(Context context, String token) {
        context.getSharedPreferences("logoff_wms_tsd_session", 0).edit()
            .putString("access_token", token).putString("token_type", "Bearer")
            .putString("device_code", "TSD-TEST").putString("device_name", "Test")
            .putString("user_id", "operator").putString("user_name", "Operator")
            .putString("role_codes", "OWNER").commit();
    }
    private static Object value(Object a, String name) throws Exception {
        Field f = a.getClass().getDeclaredField(name); f.setAccessible(true); return f.get(a);
    }
    private static void quiet(MainActivity a) throws Exception {
        for (String name : new String[]{"executor", "monitorExecutor"}) {
            Field f = MainActivity.class.getDeclaredField(name); f.setAccessible(true); f.set(a, new QuietExecutor());
        }
    }
    private static Spinner serverSpinner(View v) {
        if (v instanceof Spinner && "Сервер WMS".equals(String.valueOf(v.getContentDescription()))) return (Spinner) v;
        if (v instanceof ViewGroup) for (int i=0; i<((ViewGroup)v).getChildCount(); i++) {
            Spinner found=serverSpinner(((ViewGroup)v).getChildAt(i)); if(found!=null)return found;
        }
        return null;
    }
    private static String text(View v) {
        String s=v instanceof TextView?((TextView)v).getText().toString():"";
        if(v instanceof ViewGroup)for(int i=0;i<((ViewGroup)v).getChildCount();i++)s+="\n"+text(((ViewGroup)v).getChildAt(i));
        return s;
    }
    private static class QuietExecutor extends AbstractExecutorService {
        public void shutdown(){} public List<Runnable> shutdownNow(){return Collections.emptyList();}
        public boolean isShutdown(){return false;}public boolean isTerminated(){return false;}
        public boolean awaitTermination(long t,TimeUnit u){return true;}public void execute(Runnable r){}
    }
}
