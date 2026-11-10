package pro.logoff.wms.tsd;

import android.app.Instrumentation;
import android.content.*;
import android.widget.EditText;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;
import java.lang.reflect.*;
import java.util.*;
import java.util.concurrent.*;
import org.json.JSONArray;
import org.junit.Test;
import org.junit.runner.RunWith;
import pro.logoff.wms.tsd.auth.*;
import pro.logoff.wms.tsd.data.ReceiptCloseBatch;
import pro.logoff.wms.tsd.data.ReceiptBoxDraft;
import pro.logoff.wms.tsd.data.OperationOutbox;
import static org.junit.Assert.*;

// TEST: run against the actual signed APK, with no live session or production mutations.
@RunWith(AndroidJUnit4.class)
public class ReceiptBoxDraftInstrumentedTest {
    // TEST: the real updater requests the installed package's trusted HTTPS channel.
    @Test public void serverChoiceUsesOwnUpdateChannel()throws Exception {
        Instrumentation i=InstrumentationRegistry.getInstrumentation();
        org.junit.Assume.assumeTrue(i.getTargetContext().getPackageName().endsWith(".servers"));
        MainActivity a=launch(i);
        try {
            java.util.concurrent.atomic.AtomicReference<String> request=new java.util.concurrent.atomic.AtomicReference<>();
            java.net.URL.setURLStreamHandlerFactory(protocol->"https".equals(protocol)?new java.net.URLStreamHandler(){
                @Override protected java.net.URLConnection openConnection(java.net.URL url){
                    request.set(url.toString());return new java.net.HttpURLConnection(url){
                        public void disconnect(){}public boolean usingProxy(){return false;}public void connect(){}
                        public int getResponseCode(){return 200;}
                        public java.io.InputStream getInputStream(){return new java.io.ByteArrayInputStream("{\"versionCode\":261}".getBytes(java.nio.charset.StandardCharsets.UTF_8));}
                    };
                }
            }:null);
            set(a,"activeApkUrl","https://wms.logoff.pro/downloads/logoff-tsd.apk");
            Method download=MainActivity.class.getDeclaredMethod("downloadAndVerifyUpdateApk");download.setAccessible(true);
            assertNull(download.invoke(a));
            assertEquals("https://wms.logoff.pro/downloads/logoff-tsd-server-choice.json",request.get());
            assertEquals("https://wms.logoff.pro/downloads/logoff-tsd-server-choice.apk",get(a,"activeApkUrl"));
        }finally{i.runOnMainSync(a::finish);}
    }
    static final String BOX="FFL_NATIVE0811_06",SCOPE="native-draft261-worker-device-client",DOC="native-draft261-document";
    @Test public void seedAndReopenNinetyNineScans()throws Exception {
        Instrumentation i=InstrumentationRegistry.getInstrumentation();Context ctx=i.getTargetContext();
        SharedPreferences prefs=ctx.getSharedPreferences("tsd_ui_preferences",0);SharedPreferences.Editor edit=prefs.edit();for(String key:prefs.getAll().keySet())if(key.contains("native-draft261"))edit.remove(key);assertTrue(edit.commit());
        MainActivity a=launch(i);
        try{i.runOnMainSync(()->{try{
            prepare(a);Method add=MainActivity.class.getDeclaredMethod("addReceiptItem",String.class,String.class,pro.logoff.wms.tsd.network.TsdSkuInfo.class);add.setAccessible(true);
            for(int n=0;n<99;n++)add.invoke(a,"2037359944196","native-kiz-"+n,null);
            assertEquals(99,items(a).size());open(a,BOX);assertEquals("Reopen discarded unsent scans",99,items(a).size());
            Method close=MainActivity.class.getDeclaredMethod("closeReceiptBoxOnServer",TsdSession.class,String.class,List.class);close.setAccessible(true);close.invoke(a,((TsdSessionStore)get(a,"sessionStore")).load(),BOX,new ArrayList<>(items(a)));
            ReceiptCloseBatch batch=(ReceiptCloseBatch)get(a,"receiptCloseBatch");assertNotNull(batch);assertEquals(100,batch.operationKeys().size());
            assertTrue(a.getSharedPreferences("native_draft_expected",0).edit().putString("keys",new JSONArray(batch.operationKeys()).toString()).commit());
            System.out.println("NATIVE_DRAFT_SEEDED: 99 scans retained; 100 stable batch keys persisted");
        }catch(Exception e){throw new RuntimeException(e);}});}finally{i.runOnMainSync(a::finish);}
    }
    // Invoke separately after adb force-stop so Android must reload the draft from disk.
    @Test public void restoreAfterProcessRestart()throws Exception {
        Instrumentation i=InstrumentationRegistry.getInstrumentation();MainActivity a=launch(i);
        try{i.runOnMainSync(()->{try{
            prepare(a);set(a,"receiptBoxCode","");open(a,BOX);assertEquals(99,items(a).size());assertEquals(99,((Set<?>)get(a,"receiptKizValues")).size());
            ReceiptCloseBatch batch=(ReceiptCloseBatch)get(a,"receiptCloseBatch");assertNotNull(batch);
            assertEquals(a.getSharedPreferences("native_draft_expected",0).getString("keys",""),new JSONArray(batch.operationKeys()).toString());
            open(a,"FFL_NATIVE0811_07");assertEquals(BOX,get(a,"receiptBoxCode"));assertEquals(99,items(a).size());
            System.out.println("NATIVE_DRAFT_RESTORED: 99 scans, duplicate guard and original 100 batch keys; other box blocked");
        }catch(Exception e){throw new RuntimeException(e);}});
            // TEST: Room insertion clears the draft only after durable handoff; retries reuse keys.
            ReceiptCloseBatch batch=(ReceiptCloseBatch)get(a,"receiptCloseBatch");
            OperationOutbox outbox=(OperationOutbox)get(a,"outbox");
            outbox.enqueueReceiptBatch(batch);outbox.enqueueReceiptBatch(batch);
            for(String key:batch.operationKeys())assertNotNull(outbox.findOperation(key));
            ReceiptBoxDraft draft=new ReceiptBoxDraft((SharedPreferences)get(a,"uiStore"),SCOPE,"native-draft-client",DOC,BOX);
            assertEquals(0,draft.load().items.size());
        }finally{i.runOnMainSync(a::finish);}
    }
    private MainActivity launch(Instrumentation i){Intent intent=new Intent(i.getTargetContext(),MainActivity.class);intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);return (MainActivity)i.startActivitySync(intent);}
    private void prepare(MainActivity a)throws Exception {
        for(String field:new String[]{"executor","monitorExecutor"}){((ExecutorService)get(a,field)).shutdownNow();set(a,field,new QuietExecutor());}
        set(a,"sessionStore",new TsdSessionStore(a){@Override public TsdSession load(){return new TsdSession("test-only-invalid-token","Bearer","NATIVE-DRAFT-TEST","Test","native-draft261","Test",Collections.singletonList("ADMIN"));}});
        set(a,"receiptMode","BOXES");set(a,"receiptClientId","native-draft-client");set(a,"receiptSourceDocument",DOC);set(a,"receiptDocumentPreferenceKey",SCOPE);set(a,"receiptBoxCode",BOX);
    }
    private static List<Object> items(Object a)throws Exception{return (List<Object>)get(a,"receiptCurrentItems");}
    private static void open(MainActivity a,String box)throws Exception{EditText input=new EditText(a);input.setText(box);set(a,"boxCodeInput",input);Method m=MainActivity.class.getDeclaredMethod("openReceiptBoxFromInput");m.setAccessible(true);m.invoke(a);}
    private static Object get(Object a,String name)throws Exception{Field f=a.getClass().getDeclaredField(name);f.setAccessible(true);return f.get(a);}
    private static void set(Object a,String name,Object v)throws Exception{Field f=a.getClass().getDeclaredField(name);f.setAccessible(true);f.set(a,v);}
    static final class QuietExecutor extends AbstractExecutorService{public void execute(Runnable r){}public void shutdown(){}public List<Runnable> shutdownNow(){return Collections.emptyList();}public boolean isShutdown(){return false;}public boolean isTerminated(){return false;}public boolean awaitTermination(long t,TimeUnit u){return false;}}
}
