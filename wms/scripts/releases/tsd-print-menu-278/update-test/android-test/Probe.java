package pro.logoff.test.returns268;
import android.app.*;import android.content.*;import android.os.*;import android.widget.*;import java.lang.reflect.*;import java.util.*;import java.util.concurrent.*;
// TEST: execute the actual signed APK screen with synthetic network responses, never warehouse data.
public class Probe extends Instrumentation {
 final String prefix="pro.logoff.wms.tsd.";Activity activity;Object screen,plan,line;int resolves=0,writes=0,commits=0;String operation;Map<String,String> last;
 Class<?> cls(String n)throws Exception{return getTargetContext().getClassLoader().loadClass(prefix+n);}
 static Method method(Class<?> c,String n,Class<?>...args)throws Exception{Method m=c.getDeclaredMethod(n,args);m.setAccessible(true);return m;}
 static Object get(Object o,String n)throws Exception{Field f=o.getClass().getDeclaredField(n);f.setAccessible(true);return f.get(o);}
 static void set(Object o,String n,Object v)throws Exception{Field f=o.getClass().getDeclaredField(n);f.setAccessible(true);f.set(o,v);}
 interface Work{void run()throws Exception;}void ui(Work w)throws Exception{FutureTask<Void> f=new FutureTask<>(()->{w.run();return null;});runOnMainSync(f);f.get();}
 void check(boolean b,String s){if(!b)throw new AssertionError(s);}
 String text(android.view.View v){String s=v instanceof TextView?((TextView)v).getText().toString():"";if(v instanceof android.view.ViewGroup){android.view.ViewGroup g=(android.view.ViewGroup)v;for(int i=0;i<g.getChildCount();i++)s+="\n"+text(g.getChildAt(i));}return s;}
 Object fromJson(org.json.JSONObject json,Class<?> type)throws Exception{Object o=type.getConstructor().newInstance();Iterator<String> keys=json.keys();while(keys.hasNext()){String k=keys.next();Field f=type.getField(k);Object value=json.get(k);if(value instanceof org.json.JSONArray){List<Object> list=new ArrayList<>();Class<?> item=(Class<?>)((ParameterizedType)f.getGenericType()).getActualTypeArguments()[0];org.json.JSONArray a=(org.json.JSONArray)value;for(int i=0;i<a.length();i++)list.add(a.get(i) instanceof org.json.JSONObject?fromJson(a.getJSONObject(i),item):a.get(i));value=list;}f.set(o,value);}return o;}
 void idle()throws Exception{for(int i=0;i<100;i++){Thread.sleep(100);if(!(Boolean)get(screen,"busy"))return;}throw new Exception("screen busy");}
 void scan(String text)throws Exception{ui(()->{((EditText)get(screen,"input")).setText(text);method(screen.getClass(),"submit").invoke(screen);});idle();}
 android.view.View find(android.view.View v,String label){if(v instanceof Button&&((Button)v).getText().toString().equals(label))return v;if(v instanceof android.view.ViewGroup){android.view.ViewGroup g=(android.view.ViewGroup)v;for(int i=0;i<g.getChildCount();i++){android.view.View found=find(g.getChildAt(i),label);if(found!=null)return found;}}return null;}
 @Override public void onCreate(Bundle b){super.onCreate(b);start();}
 @Override public void onStart(){Bundle result=new Bundle();try{
 Context raw=getTargetContext();ClassLoader loader=raw.getClassLoader();String profile=(String)method(cls("ServerSettings"),"selected",Context.class).invoke(null,raw),url=(String)method(cls("ServerSettings"),"baseUrl",String.class).invoke(null,profile);
 Constructor<?> ctor=cls("ServerScopedContext").getDeclaredConstructor(Context.class,String.class);ctor.setAccessible(true);Context scoped=(Context)ctor.newInstance(raw,profile);
 scoped.getSharedPreferences("logoff_wms_tsd_session",0).edit().putString("access_token","planned-test").putString("token_type","Bearer").putString("device_code","PLAN-TEST").putString("user_id","planned-worker").putString("user_name","Plan test").putString("role_codes","WORKER").commit();
 Class<?> clock=cls("auth.TsdIdleSession$Clock");Object time=Proxy.newProxyInstance(loader,new Class[]{clock},(p,m,a)->"elapsed".equals(m.getName())?SystemClock.elapsedRealtime():System.currentTimeMillis());Object sessionIdle=cls("auth.TsdIdleSession").getConstructors()[0].newInstance(scoped.getSharedPreferences("tsd_idle_session",0),time,(Runnable)()->{},"Bearer planned-test");sessionIdle.getClass().getMethod("login",String.class).invoke(sessionIdle,"Bearer planned-test");cls("network.WmsApiFactory").getMethod("idleSession",String.class,cls("auth.TsdIdleSession")).invoke(null,url,sessionIdle);


 Class<?> api=cls("network.WmsApi"),call=loader.loadClass("retrofit2.Call"),response=loader.loadClass("retrofit2.Response");
 Object proxy=Proxy.newProxyInstance(loader,new Class[]{api},(p,m,a)->{Object data=Collections.emptyList();return Proxy.newProxyInstance(loader,new Class[]{call},(q,n,args)->{if(n.getName().equals("execute"))return response.getMethod("success",Object.class).invoke(null,data);if(n.getName().equals("isExecuted")||n.getName().equals("isCanceled"))return false;return null;});});
 Field apis=cls("network.WmsApiFactory").getDeclaredField("APIS");apis.setAccessible(true);((Map)apis.get(null)).put(url.endsWith("/")?url:url+"/",proxy);
 Intent intent=new Intent();intent.setClassName(raw.getPackageName(),prefix+"MainActivity");intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);activity=startActivitySync(intent);Thread.sleep(300);
 // TEST: a synthetic pending scan prevents installation but permits the real menu download.
 scoped.getSharedPreferences("fbs-pending",0).edit().putString("update-test-guard","synthetic").commit();
 for(String server:new String[]{"main","backup"}){
  ui(()->{set(activity,"serverProfile",server);set(activity,"waitingUpdate",null);set(activity,"nextIdleUpdateCheck",Long.MAX_VALUE);method(activity.getClass(),"renderMainScreen").invoke(activity);android.view.View button=find(activity.getWindow().getDecorView(),"\u041f\u0440\u043e\u0432\u0435\u0440\u0438\u0442\u044c \u043e\u0431\u043d\u043e\u0432\u043b\u0435\u043d\u0438\u0435");check(button!=null,"update menu button present");button.performClick();});
  java.io.File downloaded=null;
  for(int i=0;i<600;i++){Thread.sleep(100);downloaded=(java.io.File)get(activity,"waitingUpdate");if(downloaded!=null&&!(Boolean)get(activity,"appUpdateBusy"))break;}
  check(downloaded!=null&&downloaded.getName().contains("278")&&downloaded.length()==6079513,"menu downloaded278: "+server+" "+get(activity,"statusMessage"));
  java.security.MessageDigest digest=java.security.MessageDigest.getInstance("SHA-256");try(java.io.InputStream in=new java.io.FileInputStream(downloaded)){byte[] buf=new byte[8192];int n;while((n=in.read(buf))>0)digest.update(buf,0,n);}StringBuilder hash=new StringBuilder();for(byte v:digest.digest())hash.append(String.format("%02x",v));check(hash.toString().equals("046d0d2f40f204972862de52d9c50c4bdab2d8fb19cf9bf77199fa976567007b"),"published hash: "+server);
  check(method(activity.getClass(),"pendingUpdateScans").invoke(activity).equals(true),"pending scan guards installation");
  downloaded.delete();
 }
 check(raw.getPackageManager().getPackageInfo(raw.getPackageName(),0).versionCode==277,"no installation during guarded download");
 result.putString("verified","Actual signed277 menu button downloads and SHA-verifies published278 from both servers; pending scan retained; installation safely deferred; no printing");finish(Activity.RESULT_OK,result);
 }catch(Throwable e){result.putString("failure",android.util.Log.getStackTraceString(e));finish(Activity.RESULT_CANCELED,result);}}
}
