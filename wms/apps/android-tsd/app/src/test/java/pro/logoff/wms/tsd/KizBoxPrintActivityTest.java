package pro.logoff.wms.tsd;
import android.app.Activity;
import android.widget.*;
import java.lang.reflect.*;
import java.util.*;
import java.util.concurrent.*;
import org.junit.Test;
import org.junit.runner.RunWith;
import org.robolectric.*;
import org.robolectric.annotation.Config;
import pro.logoff.wms.tsd.auth.*;
import pro.logoff.wms.tsd.network.*;
import retrofit2.*;
import static org.junit.Assert.*;
@RunWith(RobolectricTestRunner.class) @Config(sdk=28)
public class KizBoxPrintActivityTest {
 // TEST: one print action replaces Phone before utility buttons for every warehouse role.
 @Test public void printingReplacesPhoneInMainMenu()throws Exception{
  for(String role:Arrays.asList("OWNER","ADMIN","OPERATOR","WAREHOUSE_KEEPER"))try(var c=Robolectric.buildActivity(MainActivity.class).setup()){
   MainActivity a=c.get();var prefs=a.getSharedPreferences("logoff_wms_tsd_session",0);
   prefs.edit().putString("access_token","test").putString("device_code","TEST").putString("user_id","test").putString("user_name","Test").putString("role_codes",role).commit();
   Method render=MainActivity.class.getDeclaredMethod("renderMainScreen");render.setAccessible(true);render.invoke(a);
   List<String> labels=new ArrayList<>();buttons(a.findViewById(android.R.id.content),labels);
   assertEquals(role,1,Collections.frequency(labels,"Печать"));
   assertFalse(role,labels.stream().anyMatch(s->s.startsWith("Телефон")));
   assertTrue(role,labels.indexOf("Печать")<labels.indexOf("Настройки / вход"));
   assertTrue(role,labels.indexOf("Печать")>labels.indexOf("Инвентаризация"));
   prefs.edit().clear().commit();
  }
 }
 private static void buttons(android.view.View v,List<String> labels){if(v instanceof Button)labels.add(((Button)v).getText().toString());if(v instanceof android.view.ViewGroup){var g=(android.view.ViewGroup)v;for(int i=0;i<g.getChildCount();i++)buttons(g.getChildAt(i),labels);}}
 // TEST: last button opens an independent screen for an ordinary worker.
 @Test public void menuIsLastAndOpensPrinting(){Activity a=Robolectric.buildActivity(Activity.class).setup().get();LinearLayout r=new LinearLayout(a);r.addView(new Button(a));KizBoxPrintActivity.addMenu(a,r);assertEquals("Печать",((Button)r.getChildAt(1)).getText());r.getChildAt(1).performClick();assertEquals(KizBoxPrintActivity.class.getName(),Shadows.shadowOf(a).getNextStartedActivity().getComponent().getClassName());}
 @Test public void successfulLookupVoicesSuccessAndQueuesOnePair()throws Exception{try(var c=Robolectric.buildActivity(KizBoxPrintActivity.class)){
  KizBoxPrintActivity a=c.get();List<String> calls=new ArrayList<>();FakeVoice voice=new FakeVoice();setup(a,calls,voice,false);
  EditText input=(EditText)get(a,"input");input.setText("0104640684266352215pwnNt7VfBWyc");a.scan();a.scan();Shadows.shadowOf(android.os.Looper.getMainLooper()).idle();
  assertEquals(Arrays.asList("kizBoxPrintLookup","kizBoxPrintCreate"),calls);assertEquals(1,voice.hits);assertEquals("",get(a,"pendingId"));assertFalse(((String)get(a,"lastId")).isEmpty());
 }}
 @Test public void uncertainSendKeepsSameKeyAndDoesNotAcceptNextScan()throws Exception{try(var c=Robolectric.buildActivity(KizBoxPrintActivity.class)){
  KizBoxPrintActivity a=c.get();List<String> calls=new ArrayList<>();FakeVoice voice=new FakeVoice();setup(a,calls,voice,true);
  ((EditText)get(a,"input")).setText("0104640684266352215pwnNt7VfBWyc");a.scan();Shadows.shadowOf(android.os.Looper.getMainLooper()).idle();String key=(String)get(a,"pendingId");assertFalse(key.isEmpty());assertEquals(1,voice.errors);
  a.scan();assertEquals(key,get(a,"pendingId"));assertEquals(2,calls.size());
 }}
 private void setup(KizBoxPrintActivity a,List<String> calls,FakeVoice voice,boolean fail)throws Exception{
  set(a,"session",new TsdSession("test","Bearer","d","device","u","worker",Arrays.asList("WORKER")));set(a,"voice",voice);set(a,"station","p");set(a,"stationName","printer");set(a,"executor",new Direct());
  WmsApi api=(WmsApi)Proxy.newProxyInstance(WmsApi.class.getClassLoader(),new Class[]{WmsApi.class},(p,m,args)->{calls.add(m.getName());return Proxy.newProxyInstance(Call.class.getClassLoader(),new Class[]{Call.class},(q,n,x)->{if(n.getName().equals("execute")){if(fail&&m.getName().equals("kizBoxPrintCreate"))throw new java.io.IOException("network");Map<String,Object> r=new HashMap<>();r.put("boxCode","FFL_TEST");r.put("palletCode","VP_PALET_SORT_001");r.put("status","QUEUED");return Response.success(r);}return null;});});set(a,"api",api);Method m=a.getClass().getDeclaredMethod("render");m.setAccessible(true);m.invoke(a);
 }
 private static Object get(Object o,String n)throws Exception{Field f=o.getClass().getDeclaredField(n);f.setAccessible(true);return f.get(o);}private static void set(Object o,String n,Object v)throws Exception{Field f=o.getClass().getDeclaredField(n);f.setAccessible(true);f.set(o,v);}
 static class FakeVoice implements FboScanFeedback{int hits,errors;public void play(boolean ok){if(ok)hits++;else errors++;}public void error(String k){errors++;}public void close(){}}
 static class Direct extends AbstractExecutorService{public void execute(Runnable r){r.run();}public void shutdown(){}public List<Runnable> shutdownNow(){return Collections.emptyList();}public boolean isShutdown(){return false;}public boolean isTerminated(){return false;}public boolean awaitTermination(long n,TimeUnit u){return true;}}
}
