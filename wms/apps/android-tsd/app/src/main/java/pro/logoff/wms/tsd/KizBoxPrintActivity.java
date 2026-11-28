package pro.logoff.wms.tsd;

import android.app.*;
import android.os.*;
import android.view.*;
import android.widget.*;
import android.text.*;
import java.util.*;
import java.util.concurrent.*;
import org.json.JSONObject;
import pro.logoff.wms.tsd.auth.*;
import pro.logoff.wms.tsd.network.*;
import retrofit2.Response;

// FIX: independent printing screen, no assembly/receipt state and no offline print queue.
public final class KizBoxPrintActivity extends Activity {
 public static void addMenu(Activity a,LinearLayout root){
  if(!"logoff".equals(BuildConfig.FLAVOR))return;
  Button b=new Button(a);b.setText("Печать");b.setAllCaps(false);b.setTextSize(20);b.setTextColor(0xffffffff);b.setBackgroundColor(0xffd71920);
  float d=a.getResources().getDisplayMetrics().density;LinearLayout.LayoutParams lp=new LinearLayout.LayoutParams(-1,Math.round(86*d));lp.setMargins(0,0,0,Math.round(16*d));b.setLayoutParams(lp);
  b.setOnClickListener(v->a.startActivity(new android.content.Intent(a,KizBoxPrintActivity.class)));root.addView(b);
 }
 public static void open(Activity a,String kiz){a.startActivity(new android.content.Intent(a,KizBoxPrintActivity.class).putExtra("kiz",kiz));}
 private String profile,baseUrl,station="",stationName="",pendingId="",pendingKiz="",pendingStation="",lastKiz="",lastId="",message="Выберите принтер и сканируйте КИЗ.";
 private TsdSession session;private TsdIdleSession idle;private WmsApi api;private FboScanFeedback voice;
 private EditText input;private boolean busy,closed;private AlertDialog dialog;
 private final Handler main=new Handler(Looper.getMainLooper());private final ExecutorService executor=Executors.newSingleThreadExecutor();
 @Override protected void attachBaseContext(android.content.Context base){profile=ServerSettings.selected(base);baseUrl=ServerSettings.baseUrl(profile);super.attachBaseContext(new ServerScopedContext(base,profile));}
 @Override public void onCreate(Bundle b){super.onCreate(b);session=new TsdSessionStore(this).load();if(session==null||!"logoff".equals(BuildConfig.FLAVOR)){finish();return;}
  idle=WmsApiFactory.idleSession(baseUrl);if(idle==null||!idle.activeFor(session.authorizationHeader())){finish();return;}
  api=WmsApiFactory.create(baseUrl);voice=new FboScanFeedback.Voice(this);restore();render();main.post(checkIdle);
  if(pendingId.isEmpty())choosePrinter();else message="Есть неподтверждённая отправка. Проверьте её статус.";
 }
 private final Runnable checkIdle=new Runnable(){public void run(){if(closed)return;if(!idle.check()||!session.hasSameAccessToken(new TsdSessionStore(KizBoxPrintActivity.this).load())||!profile.equals(ServerSettings.selected(KizBoxPrintActivity.this))){finish();return;}WmsApiFactory.flushIdleActivity(baseUrl);main.postDelayed(this,1000);}};
 private boolean inputEvent(){if(idle==null||!idle.input()){finish();return false;}WmsApiFactory.flushIdleActivity(baseUrl);return true;}
 @Override public boolean dispatchTouchEvent(MotionEvent e){if(e.getActionMasked()==MotionEvent.ACTION_DOWN&&!inputEvent())return true;return super.dispatchTouchEvent(e);}
 @Override public boolean dispatchKeyEvent(KeyEvent e){if(e.getAction()==KeyEvent.ACTION_DOWN&&!inputEvent())return true;if(e.getAction()==KeyEvent.ACTION_DOWN&&e.getKeyCode()==KeyEvent.KEYCODE_ENTER){scan();return true;}return super.dispatchKeyEvent(e);}
 @Override protected void onDestroy(){closed=true;main.removeCallbacksAndMessages(null);if(dialog!=null)dialog.dismiss();if(voice!=null)voice.close();executor.shutdown();super.onDestroy();}
 private String key(){return session.userId+":"+session.deviceCode;}
 private void save(){try{JSONObject o=new JSONObject();o.put("id",pendingId);o.put("kiz",pendingKiz);o.put("station",pendingStation);o.put("lastKiz",lastKiz);o.put("lastId",lastId);if(!getSharedPreferences("kiz-box-print",0).edit().putString(key(),o.toString()).commit())throw new Exception();}catch(Exception e){throw new IllegalStateException("Не удалось сохранить ключ печати",e);}}
 private void restore(){try{JSONObject o=new JSONObject(getSharedPreferences("kiz-box-print",0).getString(key(),"{}"));pendingId=o.optString("id");pendingKiz=o.optString("kiz");pendingStation=o.optString("station");lastKiz=o.optString("lastKiz");lastId=o.optString("lastId");}catch(Exception e){message="Не удалось прочитать состояние печати.";}}
 private int dp(int n){return Math.round(n*getResources().getDisplayMetrics().density);}
 private TextView text(String s){TextView t=new TextView(this);t.setText(s);t.setTextColor(0xff1e293b);t.setTextSize(19);t.setPadding(0,dp(10),0,dp(10));return t;}
 private void button(LinearLayout root,String label,Runnable fn){Button b=new Button(this);b.setText(label);b.setAllCaps(false);b.setTextSize(18);b.setMinHeight(dp(56));android.graphics.drawable.GradientDrawable bg=new android.graphics.drawable.GradientDrawable();bg.setColor(0xffd71920);bg.setCornerRadius(dp(12));b.setBackground(bg);b.setTextColor(0xffffffff);LinearLayout.LayoutParams lp=new LinearLayout.LayoutParams(-1,-2);lp.setMargins(0,dp(6),0,dp(6));root.addView(b,lp);b.setEnabled(!busy);b.setOnClickListener(v->fn.run());}
 private void render(){if(closed)return;LinearLayout r=new LinearLayout(this);r.setOrientation(1);r.setPadding(dp(18),dp(16),dp(18),dp(20));r.setBackgroundColor(0xfff8fafc);r.addView(text("Печать · короб и паллет-сорт"));r.addView(text(message));
  button(r,stationName.isEmpty()?"Выбрать принтер":"Принтер: "+stationName,this::choosePrinter);
  input=new EditText(this);input.setSingleLine(true);input.setHint("Сканируйте КИЗ");input.setTextSize(20);input.setInputType(android.text.InputType.TYPE_CLASS_TEXT|android.text.InputType.TYPE_TEXT_FLAG_NO_SUGGESTIONS);input.setEnabled(!busy&&pendingId.isEmpty()&&!station.isEmpty());r.addView(input);
  input.setOnEditorActionListener((v,id,event)->{scan();return true;});input.addTextChangedListener(new TextWatcher(){public void beforeTextChanged(CharSequence s,int a,int c,int f){}public void onTextChanged(CharSequence s,int a,int b,int c){}public void afterTextChanged(Editable e){main.removeCallbacks(autoScan);if(e.length()>0&&!busy)main.postDelayed(autoScan,350);}});
  if(!pendingId.isEmpty())button(r,"Проверить / повторить тот же запрос",this::sendPending);else button(r,"Подтвердить скан",this::scan);
  if(!lastId.isEmpty())button(r,"Статус последней печати",this::status);
  button(r,"В главное меню",()->finish());ScrollView scroll=new ScrollView(this);scroll.addView(r);setContentView(scroll);if(input.isEnabled())input.requestFocus();
 }
 private final Runnable autoScan=this::scan;
 private <T>T read(Response<T> r)throws Exception{if(r.isSuccessful()&&r.body()!=null)return r.body();String msg="Нет подтверждения ВМС ("+r.code()+").";if(r.errorBody()!=null){Object m=new JSONObject(r.errorBody().string()).opt("message");if(m instanceof String)msg=(String)m;}throw new Exception(msg);}
 private void fail(String s){if(closed)return;busy=false;message=s;voice.error("box-print:"+s);render();dialog=new AlertDialog.Builder(this).setMessage(s).setPositiveButton("ОК",(d,w)->{dialog=null;render();voice.prompt(FboPackingVoice.Cue.KIZ);}).create();dialog.show();}
 private void choosePrinter(){if(busy||!pendingId.isEmpty())return;busy=true;render();executor.execute(()->{try{List<TsdPrintStation> list=read(api.kizBoxPrintStations(session.authorizationHeader()).execute());main.post(()->{if(closed)return;busy=false;render();if(list.isEmpty()){fail("Нет доступного принтера 58 × 40 мм.");return;}String[] names=new String[list.size()];for(int i=0;i<names.length;i++)names[i]=list.get(i).name+" · "+list.get(i).printerName;dialog=new AlertDialog.Builder(this).setTitle("Выберите принтер").setItems(names,(d,n)->{station=list.get(n).id;stationName=names[n];dialog=null;render();voice.prompt(FboPackingVoice.Cue.KIZ);String extra=getIntent().getStringExtra("kiz");if(extra!=null&&!extra.isEmpty()){getIntent().removeExtra("kiz");input.setText(extra);}}).setNegativeButton("Отмена",null).create();dialog.show();});}catch(Exception e){main.post(()->fail(e.getMessage()));}});}
 void scan(){if(closed||busy||dialog!=null&&dialog.isShowing()||input==null||station.isEmpty()||!pendingId.isEmpty())return;String kiz=input.getText().toString().trim();if(kiz.isEmpty())return;main.removeCallbacks(autoScan);
  if(kiz.equals(lastKiz)){input.setText("");dialog=new AlertDialog.Builder(this).setMessage("Этот КИЗ уже отправлялся на печать. Напечатать новый комплект?").setPositiveButton("Напечатать повторно",(d,w)->{dialog=null;lookup(kiz);}).setNegativeButton("Отмена",(d,w)->{dialog=null;}).create();dialog.show();return;}lookup(kiz);
 }
 private void lookup(String kiz){busy=true;message="Ищу короб…";render();executor.execute(()->{try{Map<String,Object> found=read(api.kizBoxPrintLookup(session.authorizationHeader(),Collections.singletonMap("kiz",kiz)).execute());main.post(()->{if(closed)return;voice.play(true);message=printLocation(found);pendingId=UUID.randomUUID().toString();pendingKiz=kiz;pendingStation=station;try{save();}catch(Exception e){pendingId="";fail(e.getMessage());return;}busy=false;sendPending();});}catch(Exception e){main.post(()->fail(e.getMessage()));}});}
 private void sendPending(){if(closed||busy||pendingId.isEmpty())return;busy=true;render();final String id=pendingId,kiz=pendingKiz,printer=pendingStation;executor.execute(()->{try{Map<String,String>b=new HashMap<>();b.put("printId",id);b.put("kiz",kiz);b.put("stationId",printer);Map<String,Object> job=read(api.kizBoxPrintCreate(session.authorizationHeader(),b).execute());main.post(()->{if(closed)return;lastId=id;lastKiz=kiz;pendingId="";pendingKiz="";pendingStation="";save();busy=false;message=printLocation(job)+"\n"+describe(job);render();});}catch(Exception e){main.post(()->fail(e.getMessage()+"\nПовторите тот же запрос: второй комплект создан не будет."));}});}
 // FIX: older APIs may omit labelCount; pallet presence remains compatible.
 static boolean hasPallet(Map<String,Object> j){Object p=j.get("palletCode");return p!=null&&!String.valueOf(p).trim().isEmpty();}
 static String printLocation(Map<String,Object> j){return "Короб: "+j.get("boxCode")+(hasPallet(j)?"\nПаллет-сорт: "+j.get("palletCode"):"\nПаллет-сорт не указан — печатается только короб.");}
 String describe(Map<String,Object> j){String s=String.valueOf(j.get("status"));if("PRINTED".equals(s))return hasPallet(j)?"Агент подтвердил печать двух этикеток.":"Агент подтвердил печать стикера короба.";if("FAILED".equals(s))return "Ошибка печати: "+j.get("error")+". Проверьте принтер перед повторной печатью.";if("CLAIMED".equals(s))return "Задание у агента. Подтверждение печати ещё не получено.";return hasPallet(j)?"Две этикетки отправлены в очередь. Сканируйте следующий КИЗ.":"Стикер короба отправлен в очередь. Сканируйте следующий КИЗ.";}
 private void status(){if(busy||lastId.isEmpty())return;busy=true;render();executor.execute(()->{try{Map<String,Object>j=read(api.kizBoxPrintStatus(session.authorizationHeader(),lastId).execute());main.post(()->{if(closed)return;busy=false;message=describe(j);render();});}catch(Exception e){main.post(()->fail(e.getMessage()));}});}
}
