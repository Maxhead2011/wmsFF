package pro.logoff.wms.tsd;

import android.widget.EditText;
import java.lang.reflect.*;
import java.util.*;
import java.util.concurrent.*;
import org.junit.Test;
import org.junit.runner.RunWith;
import org.robolectric.Robolectric;
import org.robolectric.annotation.Config;
import org.robolectric.RobolectricTestRunner;
import pro.logoff.wms.tsd.data.*;
import pro.logoff.wms.tsd.network.TsdSkuInfo;
import static org.junit.Assert.*;

@RunWith(RobolectricTestRunner.class) @Config(sdk=28)
public class ReceiptVoiceActivityTest {
    static Object get(MainActivity a,String name)throws Exception {Field f=MainActivity.class.getDeclaredField(name);f.setAccessible(true);return f.get(a);}
    static void set(MainActivity a,String name,Object value)throws Exception {Field f=MainActivity.class.getDeclaredField(name);f.setAccessible(true);f.set(a,value);}
    static Object call(MainActivity a,String name,Class<?>[] types,Object... args)throws Exception {Method m=MainActivity.class.getDeclaredMethod(name,types);m.setAccessible(true);return m.invoke(a,args);}
    static void screen(MainActivity a,String value)throws Exception {Field f=MainActivity.class.getDeclaredField("screen");f.setAccessible(true);f.set(a,Enum.valueOf((Class)f.getType(),value));}
    static PendingOperation operation(OperationStatus status){return new PendingOperation("scan-1","receipt_scan",Collections.emptyMap(),1L,status,1,null);}
    static class Audio implements FboScanFeedback {
        final List<FboPackingVoice.Cue> cues=new ArrayList<>(); final List<Boolean> scans=new ArrayList<>();
        public void play(boolean accepted){scans.add(accepted);} public void prompt(FboPackingVoice.Cue cue){cues.add(cue);} public void close(){}
    }
    static class QuietExecutor extends AbstractExecutorService {
        public void execute(Runnable r){} public void shutdown(){} public List<Runnable> shutdownNow(){return Collections.emptyList();}
        public boolean isShutdown(){return false;} public boolean isTerminated(){return false;} public boolean awaitTermination(long n,TimeUnit u){return false;}
    }
    static Audio prepare(MainActivity a)throws Exception {
        a.getSharedPreferences("logoff_wms_tsd_session",0).edit().putString("access_token","test").putString("device_code","TEST").putString("user_id",PersonalScanVoice.SOFIA_ACCOUNT).putString("user_name","Sofia").putString("role_codes","ADMIN").commit();
        screen(a,"RECEIPT");set(a,"receiptClientId","voice-client");set(a,"receiptSourceDocument","voice-doc");set(a,"receiptMode","BOXES");set(a,"receiptBoxCode","FFL_VOICE_1");
        Audio audio=new Audio();set(a,"assemblyScanVoice",audio);set(a,"assemblyScanVoiceOwner",PersonalScanVoice.SOFIA_ACCOUNT);return audio;
    }
    // TEST: local boxed scan says PUT, not server success; redraw does not repeat speech.
    @Test public void localBoxScanUsesExistingPutWithoutFalseServerSuccess()throws Exception {
        try(var c=Robolectric.buildActivity(MainActivity.class)) {
            MainActivity a=c.get();set(a,"executor",new QuietExecutor());set(a,"monitorExecutor",new QuietExecutor());c.setup();Audio audio=prepare(a);
            call(a,"addReceiptItem",new Class[]{String.class,String.class,TsdSkuInfo.class},"4601234567893",null,null);
            assertEquals("logoff".equals(BuildConfig.FLAVOR)?Collections.singletonList(FboPackingVoice.Cue.PUT):Collections.emptyList(),audio.cues);
            assertTrue(audio.scans.isEmpty());call(a,"renderReceiptScreen",new Class[]{});assertTrue(audio.scans.isEmpty());
            assertEquals("logoff".equals(BuildConfig.FLAVOR)?1:0,audio.cues.size());
            a.getSharedPreferences("logoff_wms_tsd_session",0).edit().clear().commit();
        }
    }
    // TEST: rejected barcode and repeated KIZ use existing error audio, with no new unit.
    @Test public void invalidBarcodeAndDuplicateKizCannotSoundSuccessful()throws Exception {
        try(var c=Robolectric.buildActivity(MainActivity.class)) {
            MainActivity a=c.get();set(a,"executor",new QuietExecutor());set(a,"monitorExecutor",new QuietExecutor());c.setup();Audio audio=prepare(a);
            EditText input=new EditText(a);input.setText("BAD");set(a,"scanInput",input);
            call(a,"handleReceiptBarcodeScan",new Class[]{});
            String kiz="0104630584395306215m,arHZxjmufE";
            String key=(String)call(a,"receiptKizKey",new Class[]{String.class},kiz);
            ((Set<String>)get(a,"receiptKizValues")).add(key);input=new EditText(a);input.setText(kiz);set(a,"scanInput",input);
            call(a,"handleReceiptKizScan",new Class[]{});
            assertEquals("logoff".equals(BuildConfig.FLAVOR)?Arrays.asList(FboPackingVoice.Cue.ERROR,FboPackingVoice.Cue.ERROR):Collections.emptyList(),audio.cues);
            assertTrue(audio.scans.isEmpty());assertTrue(((List<?>)get(a,"receiptCurrentItems")).isEmpty());
            a.getSharedPreferences("logoff_wms_tsd_session",0).edit().clear().commit();
        }
    }
    // TEST: only the exact SYNCED receipt gets success, pending is silent, background/paused callbacks silent.
    @Test public void exactOperationAndLifecycleGateSuccess()throws Exception {
        try(var c=Robolectric.buildActivity(MainActivity.class)) {
            MainActivity a=c.get();set(a,"executor",new QuietExecutor());set(a,"monitorExecutor",new QuietExecutor());c.setup();Audio audio=prepare(a);
            PendingOperation op=operation(OperationStatus.PENDING);
            Class<?>[] types={PendingOperation.class};call(a,"speakReceiptResult",types,op);assertTrue(audio.scans.isEmpty());
            op=operation(OperationStatus.REJECTED);call(a,"speakReceiptResult",types,op);
            op=operation(OperationStatus.SYNCED);call(a,"speakReceiptResult",types,op);
            assertEquals("logoff".equals(BuildConfig.FLAVOR)?Arrays.asList(false,true):Collections.emptyList(),audio.scans);
            int count=audio.scans.size();screen(a,"MAIN");call(a,"speakReceiptResult",types,op);assertEquals(count,audio.scans.size());
            screen(a,"RECEIPT");set(a,"assemblyVoicePaused",true);call(a,"speakReceiptResult",types,op);assertEquals(count,audio.scans.size());
            a.getSharedPreferences("logoff_wms_tsd_session",0).edit().clear().commit();
        }
    }
    static class InlineExecutor extends QuietExecutor {public void execute(Runnable r){r.run();}}
    static class Server {
        final java.net.ServerSocket socket; final Thread worker;
        Server(String body)throws Exception {
            socket=new java.net.ServerSocket(0,8,java.net.InetAddress.getByName("127.0.0.1"));
            worker=new Thread(()->{while(!socket.isClosed())try(var client=socket.accept()) {
                client.setSoTimeout(3000);var in=client.getInputStream();var header=new StringBuilder();int ch;
                while((ch=in.read())!=-1){header.append((char)ch);if(header.toString().endsWith("\r\n\r\n"))break;}
                for(String line:header.toString().split("\r\n"))if(line.toLowerCase(java.util.Locale.ROOT).startsWith("content-length:"))in.readNBytes(Integer.parseInt(line.substring(15).trim()));
                byte[] bytes=body.getBytes(java.nio.charset.StandardCharsets.UTF_8);var out=client.getOutputStream();
                out.write(("HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nConnection: close\r\nContent-Length: "+bytes.length+"\r\n\r\n").getBytes(java.nio.charset.StandardCharsets.US_ASCII));out.write(bytes);out.flush();
            }catch(java.io.IOException ignored){}});worker.setDaemon(true);worker.start();
        }
        int port(){return socket.getLocalPort();}
        void stop(int ignored)throws Exception{socket.close();worker.join(3000);}
    }
    static Server server(String body)throws Exception{return new Server(body);}
    // TEST: actual Retrofit barcode lookup triggers the existing KIZ cue, not acceptance.
    @Test public void markedSkuLookupPromptsKiz()throws Exception {
        var server=server("{\"id\":\"sku\",\"needsChestnyZnak\":true,\"isUnmarked\":false}");
        try(var c=Robolectric.buildActivity(MainActivity.class)) {
            MainActivity a=c.get();set(a,"executor",new QuietExecutor());set(a,"monitorExecutor",new QuietExecutor());c.setup();Audio audio=prepare(a);
            set(a,"activeBaseUrl","http://127.0.0.1:"+server.port()+"/");set(a,"executor",new InlineExecutor());
            EditText input=new EditText(a);input.setText("4601234567893");set(a,"scanInput",input);
            call(a,"handleReceiptBarcodeScan",new Class[]{});org.robolectric.Shadows.shadowOf(android.os.Looper.getMainLooper()).idle();
            assertTrue((Boolean)get(a,"pendingReceiptRequiresKiz"));
            assertEquals("logoff".equals(BuildConfig.FLAVOR)?Collections.singletonList(FboPackingVoice.Cue.KIZ):Collections.emptyList(),audio.cues);
            assertTrue(audio.scans.isEmpty());a.getSharedPreferences("logoff_wms_tsd_session",0).edit().clear().commit();
        }finally{server.stop(0);}
    }
    static class Outbox extends OperationOutbox {
        PendingOperation current=operation(OperationStatus.PENDING);
        Outbox(){super(null);}
        @Override public PendingOperation enqueueReceipt(String c,String b,String k,String box,int q,String status,String doc,String mode,String comment,Map<String,String> extra){return current;}
        @Override public List<PendingOperation> pending(){return Collections.singletonList(current);}
        @Override public PendingOperation findOperation(String key){return current;}
        @Override public void markSynced(String key,String message){current=operation(OperationStatus.SYNCED);}
        @Override public void markRejected(String key,String message){current=operation(OperationStatus.REJECTED);}
        @Override public void markRetry(String key,String message){}
        @Override public OperationOutboxCounts counts(){return new OperationOutboxCounts(0,0);}
        @Override public ReceiptProgress receiptProgress(String client,String doc){return new ReceiptProgress();}
    }
    // TEST: real enqueue/sync callbacks distinguish accepted, rejected and missing operation replies.
    @Test public void unboxedServerRepliesDriveFeedbackWithoutFalseAcknowledgement()throws Exception {
        for(String status:new String[]{"APPLIED","REJECTED","MISSING"}) {
            var server=server("MISSING".equals(status)?"[]":"[{\"operationKey\":\"scan-1\",\"status\":\""+status+"\"}]");
            try(var c=Robolectric.buildActivity(MainActivity.class)) {
                MainActivity a=c.get();set(a,"executor",new QuietExecutor());set(a,"monitorExecutor",new QuietExecutor());c.setup();Audio audio=prepare(a);
                set(a,"receiptMode","STANDARD");set(a,"outbox",new Outbox());set(a,"activeBaseUrl","http://127.0.0.1:"+server.port()+"/");set(a,"executor",new InlineExecutor());
                call(a,"enqueueUnboxedReceiptItem",new Class[]{String.class,String.class,TsdSkuInfo.class,String.class},"4601234567893",null,null,null);
                org.robolectric.Shadows.shadowOf(android.os.Looper.getMainLooper()).idle();
                List<Boolean> expected=!"logoff".equals(BuildConfig.FLAVOR)||"MISSING".equals(status)?Collections.emptyList():Collections.singletonList("APPLIED".equals(status));
                assertEquals(status,expected,audio.scans);
                a.getSharedPreferences("logoff_wms_tsd_session",0).edit().clear().commit();
            }finally{server.stop(0);}
        }
    }

}
