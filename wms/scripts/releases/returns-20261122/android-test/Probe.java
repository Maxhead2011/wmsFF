package pro.logoff.test.returns268;
import android.app.*;import android.content.*;import android.os.*;import android.widget.*;import java.lang.reflect.*;import java.util.*;import java.util.concurrent.*;
public class Probe extends Instrumentation {
 final String prefix="pro.logoff.wms.tsd."; Activity activity; final List<String> calls=new ArrayList<>(); Map<String,Object> batch; List<Map<String,Object>> units=new ArrayList<>();
 static Method method(Class<?> type,String name,Class<?>...args)throws Exception{Method m=type.getDeclaredMethod(name,args);m.setAccessible(true);return m;}
 Class<?> cls(String name)throws Exception{return getTargetContext().getClassLoader().loadClass(prefix+name);}
 Object invoke(String method)throws Exception{Method m=activity.getClass().getDeclaredMethod(method);m.setAccessible(true);return m.invoke(activity);}
 Object get(String name)throws Exception{Field f=activity.getClass().getDeclaredField(name);f.setAccessible(true);return f.get(activity);}
 void set(String name,Object value)throws Exception{Field f=activity.getClass().getDeclaredField(name);f.setAccessible(true);f.set(activity,value);}
 interface Work{void run()throws Exception;}void ui(Work w)throws Exception{FutureTask<Void> f=new FutureTask<>(()->{w.run();return null;});runOnMainSync(f);f.get();}
 void waitIdle()throws Exception{for(int i=0;i<60;i++){Thread.sleep(100);if(!(Boolean)get("busy"))return;}throw new Exception("busy timeout");}
 void check(boolean ok,String message){if(!ok)throw new AssertionError(message);}
 @Override public void onCreate(Bundle b){super.onCreate(b);start();}
 @Override public void onStart(){Bundle result=new Bundle();try{
 Context raw=getTargetContext();Class<?> settings=cls("ServerSettings");String profile=(String)method(settings,"selected",Context.class).invoke(null,raw);String url=(String)method(settings,"baseUrl",String.class).invoke(null,profile);
 Constructor<?> scopedCtor=cls("ServerScopedContext").getDeclaredConstructor(Context.class,String.class);scopedCtor.setAccessible(true);Context scoped=(Context)scopedCtor.newInstance(raw,profile);
 scoped.getSharedPreferences("logoff_wms_tsd_session",0).edit().putString("access_token","returns-test").putString("token_type","Bearer").putString("device_code","RETURN-TEST").putString("user_id","return-worker").putString("user_name","Returns test").putString("role_codes","WORKER").commit();
 Class<?> clock=cls("auth.TsdIdleSession$Clock");Object time=Proxy.newProxyInstance(clock.getClassLoader(),new Class[]{clock},(p,m,a)->"elapsed".equals(m.getName())?SystemClock.elapsedRealtime():System.currentTimeMillis());
 Object idle=cls("auth.TsdIdleSession").getConstructors()[0].newInstance(scoped.getSharedPreferences("tsd_idle_session",0),time,(Runnable)()->{},"Bearer returns-test");
 idle.getClass().getMethod("login",String.class).invoke(idle,"Bearer returns-test");
 Class<?> factory=cls("network.WmsApiFactory");factory.getMethod("idleSession",String.class,cls("auth.TsdIdleSession")).invoke(null,url,idle);
 ClassLoader loader=raw.getClassLoader();Class<?> api=cls("network.WmsApi"),call=loader.loadClass("retrofit2.Call"),response=loader.loadClass("retrofit2.Response");
 Object proxy=Proxy.newProxyInstance(loader,new Class[]{api},(p,m,a)->{
  Object data;
  synchronized(calls){calls.add(m.getName());}
  if(m.getName().equals("listClients")){Object client=cls("network.TsdClientSummary").getConstructor().newInstance();client.getClass().getField("id").set(client,"c");client.getClass().getField("name").set(client,"Test client");data=Collections.singletonList(client);}
  else if(m.getName().equals("listReturns"))data=batch==null?Collections.emptyList():Collections.singletonList(batch);
  else if(m.getName().equals("createReturns")){batch=new HashMap<>((Map<String,Object>)a[1]);batch.put("status","SORTING");batch.put("createdAt","2026-11-22");batch.put("units",units);data=batch;}
  else if(m.getName().equals("scanReturn")){Map<String,Object> unit=new HashMap<>((Map<String,Object>)a[2]);units.add(unit);data=unit;}
  else if(m.getName().equals("finishReturns")){batch.put("status","STORED");data=batch;}
  else throw new AssertionError("Unexpected API: "+m.getName());
  final Object value=data;
  return Proxy.newProxyInstance(loader,new Class[]{call},(q,n,args)->{if(n.getName().equals("execute"))return response.getMethod("success",Object.class).invoke(null,value);if(n.getName().equals("isExecuted")||n.getName().equals("isCanceled"))return false;return null;});
 });
 Field apis=factory.getDeclaredField("APIS");apis.setAccessible(true);((Map)apis.get(null)).put(url.endsWith("/")?url:url+"/",proxy);
 Intent intent=new Intent();intent.setClassName(raw.getPackageName(),prefix+"ReturnsActivity");intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);activity=startActivitySync(intent);waitIdle();
 check(!activity.isFinishing(),"activity must remain open");
 ui(()->{set("clientId","c");set("pendingAction","create");Map<String,String> p=new HashMap<>();p.put("id","batch-1");p.put("clientId","c");set("pending",p);invoke("send");});waitIdle();
 ui(()->{EditText input=(EditText)get("input");check(input!=null,"return-code field");input.setText("RETURN-123");invoke("scan");});
 ui(()->{((EditText)get("input")).setText("0461234567890");invoke("scan");});
 ui(()->{((EditText)get("input")).setText("BOX-RETURN-1");invoke("scan");});waitIdle();
 check(units.size()==1,"one unit");check("0461234567890".equals(units.get(0).get("barcode")),"barcode retained");
 ui(()->{set("pendingAction","finish");set("pending",new HashMap<String,String>());invoke("send");});waitIdle();
 check("STORED".equals(batch.get("status")),"stored");check(!calls.contains("receiptScan"),"no ordinary receipt");
 result.putString("verified","published APK: client, return scan, product scan, box, finish; synthetic API only");result.putString("calls",calls.toString());finish(Activity.RESULT_OK,result);
 }catch(Throwable e){result.putString("failure",android.util.Log.getStackTraceString(e));finish(Activity.RESULT_CANCELED,result);}}
}
