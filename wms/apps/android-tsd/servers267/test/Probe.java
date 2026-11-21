package pro.logoff.test.idle267;

import android.app.*;
import android.content.*;
import android.os.Bundle;
import java.io.*;
import java.lang.reflect.*;
import java.net.*;
import java.util.*;
import java.util.concurrent.*;

public class Probe extends Instrumentation {
    Activity activity;
    final List<String> requests = new CopyOnWriteArrayList<>();
    final String prefix = "pro.logoff.wms.tsd.";
    Class<?> cls(String name) throws Exception { return getTargetContext().getClassLoader().loadClass(prefix + name); }
    Field field(String name) throws Exception {
        Field f = activity.getClass().getDeclaredField(name);
        f.setAccessible(true);
        return f;
    }
    Object call(String name) throws Exception {
        Method m = activity.getClass().getDeclaredMethod(name);
        m.setAccessible(true);
        return m.invoke(activity);
    }
    interface Checked { void run() throws Exception; }
    void ui(Checked task) throws Exception {
        FutureTask<Void> f = new FutureTask<>(() -> { task.run(); return null; });
        runOnMainSync(f);
        f.get();
    }
    void check(boolean ok, String what) { if (!ok) throw new AssertionError(what); }
    boolean live;
    @Override public void onCreate(Bundle args) { super.onCreate(args); live="yes".equals(args.getString("live")); start(); }
    void verifyPublished() throws Exception {
        Context target = getTargetContext();
        activity = startActivitySync(new Intent().setClassName(target, prefix+"MainActivity").addFlags(Intent.FLAG_ACTIVITY_NEW_TASK));
        Method bytes=activity.getClass().getDeclaredMethod("downloadBytes",String.class);
        bytes.setAccessible(true);
        Method channel=cls("IdleUpdateGuard").getDeclaredMethod("channelUrl",String.class);
        channel.setAccessible(true);
        for (String profile : new String[]{"main","backup"}) {
            field("serverProfile").set(activity,profile);
            check(call("downloadAndVerifyUpdateApk")==null,"published version differs from installed version: "+profile);
            String apk=(String)channel.invoke(null,profile);
            String feed=apk.substring(0,apk.length()-4)+".json";
            org.json.JSONObject record=new org.json.JSONObject(new String((byte[])bytes.invoke(activity,feed),"UTF-8"));
            byte[] downloaded=(byte[])bytes.invoke(activity,apk);
            byte[] digest=java.security.MessageDigest.getInstance("SHA-256").digest(downloaded);
            StringBuilder hex=new StringBuilder();
            for(byte b:digest)hex.append(String.format(java.util.Locale.ROOT,"%02x",b & 255));
            check(record.getInt("versionCode")==267 && record.getLong("size")==downloaded.length
                && record.getString("sha256").equals(hex.toString())
                && hex.toString().equals("6f67f9574b4d4e5a5bfadf2140fc8a375de5b6cb6ec3e6157d82809df68bbb5f"),"published APK "+profile);
        }
    }
    @Override public void onStart() {
        Bundle result = new Bundle();
        try {
            if(live){verifyPublished();result.putString("verified","published 267 APK and feed on main and backup via Android");finish(Activity.RESULT_OK,result);return;}
            // TEST: exercise both HTTP requests from the signed APK with deterministic responses.
            URL.setURLStreamHandlerFactory(proto -> !proto.equals("https") ? null : new URLStreamHandler() {
                protected URLConnection openConnection(URL u) {
                    return new HttpURLConnection(u) {
                        public void connect() {}
                        public void disconnect() {}
                        public boolean usingProxy() {return false;}
                        public int getResponseCode() {return 200;}
                        public InputStream getInputStream() throws IOException {
                            requests.add(u.toString());
                            String body = u.getPath().endsWith(".json")
                                ? "{\"packageId\":\"pro.logoff.wms.tsd.servers\",\"versionCode\":268,\"apkUrl\":\"https://incorrect.invalid/file\",\"sha256\":\"e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855\"}"
                                : "";
                            return new ByteArrayInputStream(body.getBytes("UTF-8"));
                        }
                    };
                }
            });
            Context target = getTargetContext();
            activity = startActivitySync(new Intent().setClassName(target, prefix+"MainActivity").addFlags(Intent.FLAG_ACTIVITY_NEW_TASK));
            String backupSuffix = "_server_backup_77_37_144_211";
            for (String profile : new String[]{"main","backup"}) {
                field("serverProfile").set(activity,profile);
                requests.clear();
                File downloaded = (File)call("downloadAndVerifyUpdateApk");
                check(downloaded != null && requests.size()==2, "download "+profile+" "+requests);
                String root = cls("ServerSettings").getDeclaredField(profile.equals("main")?"MAIN_URL":"BACKUP_URL").getName();
                Field url = cls("ServerSettings").getDeclaredField(root); url.setAccessible(true);
                String expected = url.get(null)+"downloads/logoff-tsd-server-choice";
                check(requests.get(0).equals(expected+".json") && requests.get(1).equals(expected+".apk?v=268"),"routing "+profile);
            }
            SharedPreferences stored = activity.getSharedPreferences("logoff_wms_tsd_session",0);
            stored.edit().putString("access_token","emulator-only").putString("device_code","test")
                .putString("user_id","probe").putString("user_name","Probe").putString("role_codes","WAREHOUSE").commit();
            Object main = Enum.valueOf((Class)field("screen").getType(),"MAIN");
            Object operation = Enum.valueOf((Class)field("screen").getType(),"FBO_TWO_STAGE");
            ui(()->{
                field("screen").set(activity,operation);
                check(!(Boolean)call("idleUpdateState"),"active operation");
                field("screen").set(activity,main);
                check((Boolean)call("idleUpdateState"),"idle state");
            });
            check(!(Boolean)call("pendingUpdateScans"),"initial queue");
            for(String suffix:new String[]{"",backupSuffix}){
                SharedPreferences fbo = target.getSharedPreferences("fbo-pending"+suffix,0);
                fbo.edit().putString("probe:position","{\"barcode\":\"pending\"}").commit();
                check((Boolean)call("pendingUpdateScans"),"pending barcode "+suffix);
                fbo.edit().remove("probe:position").commit();
                SharedPreferences receipt = target.getSharedPreferences("tsd_ui_preferences"+suffix,0);
                receipt.edit().putString("receipt-box-draft:v1:probe","{}").commit();
                check((Boolean)call("pendingUpdateScans"),"receipt draft "+suffix);
                receipt.edit().remove("receipt-box-draft:v1:probe").commit();
            }
            check(!(Boolean)call("pendingUpdateScans"),"queue cleared");
            // TEST: an unsent Room operation blocks installation after leaving its screen.
            Object db=cls("data.TsdDatabase").getMethod("get",Context.class).invoke(null,activity);
            Object dao=cls("data.TsdDatabase").getMethod("operationDao").invoke(db);
            Class<?> entityType=cls("data.OperationEntity");
            Object entity=entityType.newInstance();
            entityType.getField("operationKey").set(entity,"emulator-probe");
            entityType.getField("status").set(entity,"PENDING");
            cls("data.OperationDao").getMethod("insert",entityType).invoke(dao,entity);
            check((Boolean)call("pendingUpdateScans"),"durable operation waiting for server acknowledgement");
            cls("data.OperationDao").getMethod("setTerminalStatus",String.class,String.class,String.class,long.class,Long.class)
                .invoke(dao,"emulator-probe","SYNCED","test",1L,Long.valueOf(1L));
            check(!(Boolean)call("pendingUpdateScans"),"durable acknowledgement");
            File candidate = new File(activity.getApplicationInfo().sourceDir);
            SharedPreferences scan = target.getSharedPreferences("fbo-pending",0);
            scan.edit().putString("probe:command","pending").commit();
            ui(()->{
                field("waitingUpdate").set(activity,candidate);
                field("nextQueueCheck").setLong(activity,0);
                call("tryIdleUpdate");
            });
            Thread.sleep(1500);
            check(field("waitingUpdate").get(activity)!=null && field("updateBarrier").get(activity)==null,"install deferred with scan");
            scan.edit().remove("probe:command").commit();
            ui(()->{
                field("screen").set(activity,operation);
                field("nextQueueCheck").setLong(activity,0);
                call("tryIdleUpdate");
                check(field("updateBarrier").get(activity)==null,"install deferred during operation");
                field("screen").set(activity,main);
                call("tryIdleUpdate");
            });
            for(int i=0;i<50 && field("waitingUpdate").get(activity)!=null;i++)Thread.sleep(100);
            check(field("waitingUpdate").get(activity)==null && field("appUpdateBusy").getBoolean(activity),"APK submitted after confirmation");
            result.putString("verified","two metadata and APK routes; active operation; drafts in both profiles; confirmed state");
            finish(Activity.RESULT_OK,result);
        } catch(Throwable e){
            result.putString("failure",android.util.Log.getStackTraceString(e));
            finish(Activity.RESULT_CANCELED,result);
        }
    }
}
