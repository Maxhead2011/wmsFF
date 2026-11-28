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

 Object loaded=cls("network.TsdStoragePalletResponse").getConstructor().newInstance();set(loaded,"state","RECOVERY");
 Object pallet=cls("network.TsdStoragePalletResponse$Pallet").getConstructor().newInstance();set(pallet,"id","test-pallet");set(pallet,"code","PALET_SORT_TEST");set(pallet,"status","OPEN");set(pallet,"boxes",new ArrayList<>());
 Object client=cls("network.TsdStoragePalletResponse$Client").getConstructor().newInstance();set(client,"id","test-client");set(client,"name","Synthetic client");set(pallet,"client",client);set(loaded,"pallet",pallet);
 Object recovery=cls("network.TsdStoragePalletResponse$Recovery").getConstructor().newInstance();set(recovery,"boxCode","FFL_TEST_280");set(recovery,"reasonLabel","Test empty box");set(loaded,"recovery",recovery);
 Object sku=cls("network.TsdSkuInfo").getConstructor().newInstance();set(sku,"id","test-sku");set(sku,"name","Test product");
 List<Map> sent=new ArrayList<>();
 Object proxy=Proxy.newProxyInstance(loader,new Class[]{api},(p,m,a)->{Object data=Collections.emptyList();
   if(m.getName().equals("findSkuByBarcode")){resolves++;data=sku;}
   if(m.getName().equals("restoreStoragePalletBox")){writes++;sent.add((Map)a[2]);data=loaded;}
   final Object payload=data;final boolean failure=m.getName().equals("restoreStoragePalletBox")&&writes==1;
   return Proxy.newProxyInstance(loader,new Class[]{call},(q,n,args)->{if(n.getName().equals("execute")){if(failure)throw new java.io.IOException("synthetic lost response");return response.getMethod("success",Object.class).invoke(null,payload);}if(n.getName().equals("isExecuted")||n.getName().equals("isCanceled"))return false;return null;});});
 Field apis=cls("network.WmsApiFactory").getDeclaredField("APIS");apis.setAccessible(true);((Map)apis.get(null)).put(url.endsWith("/")?url:url+"/",proxy);
 Intent intent=new Intent();intent.setClassName(raw.getPackageName(),prefix+"MainActivity");intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);activity=startActivitySync(intent);Thread.sleep(300);
 ui(()->{set(activity,"nextIdleUpdateCheck",Long.MAX_VALUE);set(activity,"storagePalletAssembly",loaded);method(activity.getClass(),"prepareStoragePalletRecovery",loaded.getClass()).invoke(activity,loaded);method(activity.getClass(),"renderStoragePalletAssemblyScreen").invoke(activity);});
 scanRecovery("4610460840526");waitLookup();check(count()==0,"barcode must not count");
 ui(()->method(activity.getClass(),"completeStoragePalletRecovery").invoke(activity));check(writes==0,"incomplete pair must not save");
 scanRecovery("0104610460840526215TEST1");check(count()==1,"KIZ adds exactly one");
 scanRecovery("0104610460840526215TEST1");check(count()==1,"immediate repeat unchanged");
 scanRecovery("4610460840526");waitLookup();scanRecovery("]d20104610460840526215TEST1");check(count()==1,"duplicate identity unchanged");
 ui(()->method(activity.getClass(),"completeStoragePalletRecovery").invoke(activity));check(writes==0,"duplicate leaves incomplete pair");
 scanRecovery("0104610460840526215TEST2");check(count()==2,"second unique pair counted");
 ui(()->method(activity.getClass(),"completeStoragePalletRecovery").invoke(activity));Thread.sleep(800);check(writes==1,"first save attempted");
 ui(()->method(activity.getClass(),"completeStoragePalletRecovery").invoke(activity));Thread.sleep(800);check(writes==2,"save retry possible");
 check(sent.get(0).equals(sent.get(1)),"retry key and physical pair payload unchanged");
 List<Map> items=(List<Map>)sent.get(0).get("items");check(items.size()==2,"two pairs in server payload");for(Map item:items){check(item.get("kiz")!=null,"KIZ sent");check(item.get("quantity").equals(1),"one per pair");}
 result.putString("verified","APK280: barcode=0, uniqueKIZ=1, duplicate=unchanged, incompleteSave=blocked, retry=identical; no production writes or printing");finish(Activity.RESULT_OK,result);
 }catch(Throwable e){result.putString("failure",android.util.Log.getStackTraceString(e));finish(Activity.RESULT_CANCELED,result);}}
 int count()throws Exception{int n=0;for(Object row:((Map)get(activity,"storagePalletRecoveryItems")).values())n+=(Integer)get(row,"quantity");return n;}
 void scanRecovery(String value)throws Exception{ui(()->{((EditText)get(activity,"storagePalletScanInput")).setText(value);method(activity.getClass(),"scanStoragePalletRecoveryItem").invoke(activity);});}
 void waitLookup()throws Exception{for(int i=0;i<60;i++){Thread.sleep(100);Object pairs=get(activity,"recoveryPairs");if(!(Boolean)get(pairs,"lookingUp"))return;}throw new AssertionError("lookup timeout");}
}
