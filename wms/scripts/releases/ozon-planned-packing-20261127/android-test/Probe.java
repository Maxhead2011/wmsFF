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
 @Override public void onCreate(Bundle b){super.onCreate(b);start();}
 @Override public void onStart(){Bundle result=new Bundle();try{
 Context raw=getTargetContext();ClassLoader loader=raw.getClassLoader();String profile=(String)method(cls("ServerSettings"),"selected",Context.class).invoke(null,raw),url=(String)method(cls("ServerSettings"),"baseUrl",String.class).invoke(null,profile);
 Constructor<?> ctor=cls("ServerScopedContext").getDeclaredConstructor(Context.class,String.class);ctor.setAccessible(true);Context scoped=(Context)ctor.newInstance(raw,profile);
 scoped.getSharedPreferences("logoff_wms_tsd_session",0).edit().putString("access_token","planned-test").putString("token_type","Bearer").putString("device_code","PLAN-TEST").putString("user_id","planned-worker").putString("user_name","Plan test").putString("role_codes","WORKER").commit();
 Class<?> clock=cls("auth.TsdIdleSession$Clock");Object time=Proxy.newProxyInstance(loader,new Class[]{clock},(p,m,a)->"elapsed".equals(m.getName())?SystemClock.elapsedRealtime():System.currentTimeMillis());Object sessionIdle=cls("auth.TsdIdleSession").getConstructors()[0].newInstance(scoped.getSharedPreferences("tsd_idle_session",0),time,(Runnable)()->{},"Bearer planned-test");sessionIdle.getClass().getMethod("login",String.class).invoke(sessionIdle,"Bearer planned-test");cls("network.WmsApiFactory").getMethod("idleSession",String.class,cls("auth.TsdIdleSession")).invoke(null,url,sessionIdle);
 String fixture="{\"requestId\":\"planned-test\",\"title\":\"Упаковка по плану\",\"phase\":\"PACKING\",\"marketplace\":\"OZON\",\"plannedPackingRequired\":true,\"packingByProductSupported\":true,\"needed\":2,\"picked\":2,\"packed\":0,\"directions\":[{\"name\":\"Тест\",\"needed\":2,\"packed\":0,\"items\":[{\"skuId\":\"s\",\"barcode\":\"4601234567890\",\"quantity\":2,\"packed\":0}]}],\"lines\":[{\"skuId\":\"s\",\"barcode\":\"4601234567890\",\"name\":\"Товар\",\"needed\":2,\"picked\":2,\"packed\":0,\"remaining\":0,\"requiresKiz\":false}],\"route\":[],\"boxes\":[],\"wholeBoxes\":[],\"packingSuggestions\":[]}";
 plan=fromJson(new org.json.JSONObject(fixture),cls("network.TsdFboPlan"));line=((List)get(plan,"lines")).get(0);
 Class<?> api=cls("network.WmsApi"),call=loader.loadClass("retrofit2.Call"),response=loader.loadClass("retrofit2.Response");
 Object proxy=Proxy.newProxyInstance(loader,new Class[]{api},(p,m,a)->{Object data;boolean lost=false;
  if(m.getName().equals("listClients")||m.getName().equals("listReturns"))data=Collections.emptyList();
  else if(m.getName().equals("getFboPlanAtLocation")||m.getName().equals("getFboPlan"))data=plan;
  else if(m.getName().equals("resolvePlannedPacking")){resolves++;Map body=(Map)a[2];check("4601234567890".equals(body.get("barcode")),"resolved barcode");data=cls("network.TsdFboPlan$PackingSuggestion").getConstructor().newInstance();for(String[] f:new String[][]{{"skuId","s"},{"barcode","4601234567890"},{"direction","Тест"},{"targetBoxCode","FFL_PLAN_001"},{"cargoId","123456"},{"packingUnitId","unit-1"}})set(data,f[0],f[1]);set(data,"remaining",2);}
  else if(m.getName().equals("actFbo")){writes++;last=new LinkedHashMap<>((Map<String,String>)a[2]);check("unit-1".equals(last.get("packingUnitId")),"exact physical unit");check("FFL_PLAN_001".equals(last.get("targetBoxCode")),"planned box");check("PACK_PRODUCT".equals(last.get("action")),"product flow");if(operation==null){operation=last.get("operationId");commits++;lost=true;}else check(operation.equals(last.get("operationId")),"stable retry identity");set(plan,"packed",1);set(line,"packed",1);data=plan;}
  else throw new AssertionError("Unexpected API "+m.getName());
  final Object value=data;final boolean drop=lost;return Proxy.newProxyInstance(loader,new Class[]{call},(q,n,args)->{if(n.getName().equals("execute")){if(drop)throw new java.io.IOException("lost response");return response.getMethod("success",Object.class).invoke(null,value);}if(n.getName().equals("isExecuted")||n.getName().equals("isCanceled"))return false;return null;});});
 Field apis=cls("network.WmsApiFactory").getDeclaredField("APIS");apis.setAccessible(true);((Map)apis.get(null)).put(url.endsWith("/")?url:url+"/",proxy);
 Intent intent=new Intent();intent.setClassName(raw.getPackageName(),prefix+"ReturnsActivity");intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);activity=startActivitySync(intent);Thread.sleep(500);
 Object session=cls("auth.TsdSession").getConstructors()[0].newInstance("planned-test","Bearer","PLAN-TEST","Test","planned-worker","Worker",Collections.singletonList("WORKER"));
 ui(()->{activity.getSharedPreferences("fbo-pending",0).edit().clear().commit();Constructor<?> c=cls("FboTwoStageScreen").getDeclaredConstructor(Activity.class,cls("auth.TsdSession"),api,String.class,String.class,boolean.class,Runnable.class,Runnable.class,cls("FboScanFeedback"));c.setAccessible(true);screen=c.newInstance(activity,session,proxy,url,"planned-test",true,(Runnable)()->{},null,null);});idle();
 check((Boolean)method(screen.getClass(),"productActive").invoke(screen),"planned product mode selected");
 scan("4601234567890");check(resolves==1,"one resolve");check("unit-1".equals(get(get(screen,"state"),"packingUnitId")),"unit stored");check(text(activity.getWindow().getDecorView()).contains("FFL_PLAN_001"),"visible box hint");
 scan("FFL_WRONG");check(writes==0,"wrong box blocked before network");
 scan("123456");check(writes==1&&commits==1,"Ozon cargo sticker resolved; first write accepted but response lost");check(method(get(screen,"state").getClass(),"pending").invoke(get(screen,"state"))!=null,"pending retained");
 ui(()->method(screen.getClass(),"send",String.class,String.class).invoke(screen,"PACK_PRODUCT",""));idle();check(writes==2&&commits==1,"retry without second unit");
 scan("FFL_PLAN_001");check(writes==2,"duplicate box does not pack another unit");
 set(line,"requiresKiz",true);scan("4601234567890");check(resolves==1,"marked item waits for KIZ");scan("not-a-kiz");check(resolves==1,"invalid KIZ rejected");scan("010461046084052621AAAAAAAAAAAAA\u001d91ABCD\u001d92testcrypto");check(resolves==2,"marked item resolved only after KIZ");scan("010461046084052621AAAAAAAAAAAAA\u001d91ABCD\u001d92testcrypto");check(writes==2,"repeated KIZ cannot confirm box");
 ui(()->method(screen.getClass(),"close").invoke(screen));
 result.putString("verified","signed APK: automatic planned mode, product resolution, exact box, rejected wrong/duplicate box, stable retry unit and operation, one commit");result.putString("writes",String.valueOf(writes));finish(Activity.RESULT_OK,result);
 }catch(Throwable e){result.putString("failure",android.util.Log.getStackTraceString(e));finish(Activity.RESULT_CANCELED,result);}}
}
