package pro.logoff.wms.soswb;
import android.app.Application;
import android.os.Looper;
import android.widget.*;
import org.junit.*;
import org.junit.runner.RunWith;
import org.robolectric.*;
import org.robolectric.annotation.Config;
import java.net.*;
import java.io.*;
import java.lang.reflect.*;
import java.util.*;
import java.util.concurrent.CopyOnWriteArrayList;
import static org.junit.Assert.*;

// TEST: real activity routes post-pick scans only to printing and retains retry identity.
@RunWith(RobolectricTestRunner.class)
@Config(sdk=28,application=Application.class)
public class PostPickPrintingTest {
 static final List<Fake> calls=new CopyOnWriteArrayList<>();
 @Before public void reset(){calls.clear();}
 static Object field(Object a,String n)throws Exception {Field f=MainActivity.class.getDeclaredField(n);f.setAccessible(true);return f.get(a);}
 static void set(Object a,String n,Object v)throws Exception {Field f=MainActivity.class.getDeclaredField(n);f.setAccessible(true);f.set(a,v);}
 static void invoke(Object a,String n)throws Exception {Method m=MainActivity.class.getDeclaredMethod(n);m.setAccessible(true);m.invoke(a);}
 void ready(FakeActivity a)throws Exception {
  ((android.content.SharedPreferences)field(a,"prefs")).edit().clear().commit();set(a,"token","synthetic");
  ((ArrayList<String>)field(a,"requestIds")).add("r");((ArrayList<Boolean>)field(a,"requestPrintOnly")).add(true);
  ((ArrayList<String>)field(a,"stationIds")).add("s");
  ((Spinner)field(a,"request")).setAdapter(new ArrayAdapter<>(a,android.R.layout.simple_spinner_dropdown_item,new String[]{"Request"}));
  ((Spinner)field(a,"station")).setAdapter(new ArrayAdapter<>(a,android.R.layout.simple_spinner_dropdown_item,new String[]{"Printer"}));
  ((Spinner)field(a,"mode")).setAdapter(new ArrayAdapter<>(a,android.R.layout.simple_spinner_dropdown_item,new String[]{"Request"}));
  Shadows.shadowOf(Looper.getMainLooper()).idle();
 }
 @Test public void scanQueuesOnlyPrintingAndDoesNotAskForKiz()throws Exception {
  try(var c=Robolectric.buildActivity(FakeActivity.class).setup()) {
   FakeActivity a=c.get();ready(a);((EditText)field(a,"code")).setText("123456");invoke(a,"scan");await();
   assertEquals(1,calls.size());assertTrue(calls.get(0).url().endsWith("/fbs/sos/post-pick/print"));
   String body=calls.get(0).out.toString("UTF-8");assertTrue(body.contains("operationId"));assertTrue(body.contains("123456"));
   assertEquals(false,field(a,"waitingKiz"));assertEquals("",field(a,"activeTaskId"));
   assertEquals("a",field(a,"lastPostAssembly"));
  }
 }
 @Test public void pendingRetryKeepsOperationId()throws Exception {
  try(var c=Robolectric.buildActivity(FakeActivity.class).setup()) {
   FakeActivity a=c.get();ready(a);android.content.SharedPreferences p=(android.content.SharedPreferences)field(a,"prefs");
   p.edit().putString("post-pick-pending","{\"requestId\":\"r\",\"stationId\":\"s\",\"barcode\":\"123456\",\"operationId\":\"same-id\"}").commit();
   ((EditText)field(a,"code")).setText("123456");invoke(a,"scan");await();
   assertTrue(calls.get(0).out.toString("UTF-8").contains("same-id"));
  }
 }
 @Test public void anotherBarcodeCannotReplaceUncertainPrint()throws Exception {
  try(var c=Robolectric.buildActivity(FakeActivity.class).setup()) {
   FakeActivity a=c.get();ready(a);android.content.SharedPreferences p=(android.content.SharedPreferences)field(a,"prefs");
   p.edit().putString("post-pick-pending","{\"requestId\":\"r\",\"stationId\":\"s\",\"barcode\":\"old\",\"operationId\":\"same-id\"}").commit();
   ((EditText)field(a,"code")).setText("123456");invoke(a,"scan");Shadows.shadowOf(Looper.getMainLooper()).idle();
   assertTrue(calls.isEmpty());assertTrue(p.getString("post-pick-pending","").contains("same-id"));
  }
 }
 static void await()throws Exception {for(int i=0;i<100;i++){Shadows.shadowOf(Looper.getMainLooper()).idle();if(!calls.isEmpty()&&calls.get(0).done){Thread.sleep(20);Shadows.shadowOf(Looper.getMainLooper()).idle();return;}Thread.sleep(10);}fail("No request");}
 public static class FakeActivity extends MainActivity {protected HttpURLConnection openConnection(String url)throws Exception {Fake f=new Fake(new URL(url));calls.add(f);return f;}}
 static class Fake extends HttpURLConnection {ByteArrayOutputStream out=new ByteArrayOutputStream();volatile boolean done;
 Fake(URL u){super(u);}String url(){return url.toString();}public void connect(){} public void disconnect(){done=true;}public boolean usingProxy(){return false;}
 public OutputStream getOutputStream(){return out;}public int getResponseCode(){return 200;}
 public InputStream getInputStream(){return new ByteArrayInputStream("{\"assemblyId\":\"a\",\"orderId\":\"o\",\"printStatus\":\"QUEUED\"}".getBytes(java.nio.charset.StandardCharsets.UTF_8));}}
}
