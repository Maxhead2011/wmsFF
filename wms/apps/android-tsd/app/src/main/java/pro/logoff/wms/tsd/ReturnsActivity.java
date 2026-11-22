package pro.logoff.wms.tsd;

import android.app.Activity;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.view.KeyEvent;
import android.view.MotionEvent;
import android.widget.*;
import org.json.JSONObject;
import java.util.*;
import java.util.concurrent.*;
import pro.logoff.wms.tsd.auth.*;
import pro.logoff.wms.tsd.network.*;
import retrofit2.Response;

/** FIX: durable scan -> condition -> box flow, isolated from ordinary receipts. */
public final class ReturnsActivity extends Activity {
    public static void addMenu(Activity activity, LinearLayout root) {
        Button button=new Button(activity);button.setText("Возвраты");
        button.setOnClickListener(v->activity.startActivity(new android.content.Intent(activity,ReturnsActivity.class)));
        root.addView(button);
    }
    private String baseUrl, profile;
    private TsdSession session;
    private TsdIdleSession idle;
    private WmsApi api;
    private final ExecutorService executor = Executors.newSingleThreadExecutor();
    private final Handler main = new Handler(Looper.getMainLooper());
    private String clientId="", batchId="", code="", barcode="", condition="NORMAL", marketplace="WILDBERRIES", message="";
    private String pendingAction="";
    private Map<String,String> pending=new LinkedHashMap<>();
    private List<TsdClientSummary> clients=new ArrayList<>();
    private List<Map<String,Object>> batches=new ArrayList<>();
    private EditText input;
    private boolean busy;
    private static final String[] CONDITIONS={"NORMAL","INCOMPLETE","DAMAGED","WRONG_ITEM"};
    private static final String[] TITLES={"Нормальное","Разнопарка / неполный комплект","Испачкан / повреждён","Неверное вложение"};
    @Override protected void attachBaseContext(android.content.Context base) {
        profile=ServerSettings.selected(base); baseUrl=ServerSettings.baseUrl(profile);
        super.attachBaseContext(new ServerScopedContext(base,profile));
    }
    @Override public void onCreate(Bundle state) {
        super.onCreate(state);
        session=new TsdSessionStore(this).load();
        if(session==null||!"logoff".equals(BuildConfig.FLAVOR)){finish();return;}
        idle=WmsApiFactory.idleSession(baseUrl);
        if(idle==null||!idle.activeFor(session.authorizationHeader())){finish();return;}
        api=WmsApiFactory.create(baseUrl);
        restore(); render(); loadClients(); main.post(idleCheck);
    }
    private final Runnable idleCheck=new Runnable(){public void run(){
        if(idle==null||!idle.check()){finish();return;}
        WmsApiFactory.flushIdleActivity(baseUrl);main.postDelayed(this,1000);
    }};
    private boolean physicalInput(){if(idle==null||!idle.input()){finish();return false;}WmsApiFactory.flushIdleActivity(baseUrl);return true;}
    @Override public boolean dispatchTouchEvent(MotionEvent event){if(event.getActionMasked()==MotionEvent.ACTION_DOWN&&!physicalInput())return true;return super.dispatchTouchEvent(event);}
    @Override public boolean dispatchKeyEvent(KeyEvent event){
        if(event.getAction()==KeyEvent.ACTION_DOWN&&!physicalInput())return true;
        if(event.getAction()==KeyEvent.ACTION_DOWN&&event.getKeyCode()==KeyEvent.KEYCODE_ENTER&&input!=null){scan();return true;}
        return super.dispatchKeyEvent(event);
    }
    @Override protected void onResume(){super.onResume();if(session!=null&&(!session.hasSameAccessToken(new TsdSessionStore(this).load())||!profile.equals(ServerSettings.selected(this))))finish();}
    @Override protected void onDestroy(){main.removeCallbacksAndMessages(null);executor.shutdown();super.onDestroy();}
    private String key(){return "returns:"+session.userId+":"+session.deviceCode;}
    private void save(){
        try{JSONObject s=new JSONObject();s.put("client",clientId);s.put("batch",batchId);s.put("code",code);s.put("barcode",barcode);s.put("condition",condition);s.put("marketplace",marketplace);s.put("action",pendingAction);s.put("pending",new JSONObject(pending));getSharedPreferences("returns",MODE_PRIVATE).edit().putString(key(),s.toString()).commit();}catch(Exception e){throw new IllegalStateException(e);}
    }
    private void restore(){try{JSONObject s=new JSONObject(getSharedPreferences("returns",MODE_PRIVATE).getString(key(),"{}"));clientId=s.optString("client");batchId=s.optString("batch");code=s.optString("code");barcode=s.optString("barcode");condition=s.optString("condition","NORMAL");marketplace=s.optString("marketplace","WILDBERRIES");pendingAction=s.optString("action");JSONObject p=s.optJSONObject("pending");if(p!=null){Iterator<String> keys=p.keys();while(keys.hasNext()){String k=keys.next();pending.put(k,p.getString(k));}}}catch(Exception e){message="Не удалось восстановить операцию. Проверьте партию в WMS.";}}
    private void loadClients(){busy=true;executor.execute(()->{try{Response<List<TsdClientSummary>> r=api.listClients(session.authorizationHeader()).execute();if(!r.isSuccessful()||r.body()==null)throw new Exception("Не удалось загрузить клиентов");main.post(()->{clients=r.body();busy=false;render();if(!clientId.isEmpty())refresh();});}catch(Exception e){main.post(()->{busy=false;message=e.getMessage();render();});}});}
    private void refresh(){busy=true;executor.execute(()->{try{Response<List<Map<String,Object>>> r=api.listReturns(session.authorizationHeader(),clientId).execute();if(!r.isSuccessful()||r.body()==null)throw new Exception("Не удалось загрузить возвраты: "+r.code());main.post(()->{batches=r.body();busy=false;render();});}catch(Exception e){main.post(()->{busy=false;message=e.getMessage();render();});}});}
    private TextView text(String value){TextView v=new TextView(this);v.setText(value);v.setTextSize(18);v.setPadding(0,10,0,10);return v;}
    private void button(LinearLayout root,String title,Runnable run){Button b=new Button(this);b.setText(title);b.setEnabled(!busy);b.setOnClickListener(v->run.run());root.addView(b);}
    private Map<String,Object> current(){for(Map<String,Object>b:batches)if(batchId.equals(b.get("id")))return b;return null;}
    private void render(){
        if(isFinishing())return;
        ScrollView scroll=new ScrollView(this);LinearLayout root=new LinearLayout(this);root.setOrientation(LinearLayout.VERTICAL);root.setPadding(20,20,20,20);scroll.addView(root);setContentView(scroll);input=null;
        root.addView(text("Возвраты"));root.addView(text(busy?"Загружаю…":message));
        if(!pendingAction.isEmpty()){root.addView(text("Ответ не подтверждён. Повторите ту же операцию."));button(root,"Повторить тот же запрос",this::send);return;}
        if(clientId.isEmpty()){
            Spinner select=new Spinner(this);List<String> names=new ArrayList<>();for(TsdClientSummary c:clients)names.add(c.name);
            select.setAdapter(new ArrayAdapter<>(this,android.R.layout.simple_spinner_dropdown_item,names));root.addView(select);
            button(root,"Выбрать клиента",()->{if(clients.isEmpty())return;clientId=clients.get(select.getSelectedItemPosition()).id;save();refresh();});
            button(root,"Обновить",this::loadClients);return;
        }
        for(TsdClientSummary c:clients)if(clientId.equals(c.id))root.addView(text(c.name));
        if(batchId.isEmpty()){
            button(root,"Начать сортировку",()->{pendingAction="create";pending.put("id",UUID.randomUUID().toString());pending.put("clientId",clientId);save();send();});
            for(Map<String,Object>b:batches)if("SORTING".equals(b.get("status")))button(root,"Продолжить · "+b.get("createdAt"),()->{batchId=String.valueOf(b.get("id"));save();render();});
            button(root,"Другой клиент",()->{clientId="";save();render();});return;
        }
        Map<String,Object>b=current();
        if(b==null){button(root,"Обновить партию",this::refresh);return;}
        List<?> units=(List<?>)b.get("units");root.addView(text("Отсортировано: "+(units==null?0:units.size())));
        if("STORED".equals(b.get("status"))){root.addView(text("Принято на хранение. До маркировки недоступно для сборки."));button(root,"К партиям",()->{batchId="";code="";barcode="";save();render();});return;}
        if(code.isEmpty()){
            Spinner mp=new Spinner(this);mp.setAdapter(new ArrayAdapter<>(this,android.R.layout.simple_spinner_dropdown_item,new String[]{"Wildberries","Ozon"}));mp.setSelection("OZON".equals(marketplace)?1:0);mp.setOnItemSelectedListener(new android.widget.AdapterView.OnItemSelectedListener(){public void onNothingSelected(android.widget.AdapterView<?>p){}public void onItemSelected(android.widget.AdapterView<?>p,android.view.View v,int pos,long id){marketplace=pos==1?"OZON":"WILDBERRIES";save();}});root.addView(mp);
        }
        String prompt=code.isEmpty()?"Сканируйте код возврата":barcode.isEmpty()?"Сканируйте ШК фактического товара":"Выберите состояние и сканируйте короб";
        root.addView(text(prompt));
        if(!barcode.isEmpty()){
            Spinner state=new Spinner(this);state.setAdapter(new ArrayAdapter<>(this,android.R.layout.simple_spinner_dropdown_item,TITLES));state.setSelection(Arrays.asList(CONDITIONS).indexOf(condition));state.setOnItemSelectedListener(new android.widget.AdapterView.OnItemSelectedListener(){public void onNothingSelected(android.widget.AdapterView<?>p){}public void onItemSelected(android.widget.AdapterView<?>p,android.view.View v,int pos,long id){condition=CONDITIONS[pos];save();}});root.addView(state);
        }
        input=new EditText(this);input.setSingleLine(true);input.setHint(prompt);input.setEnabled(!busy);root.addView(input);input.requestFocus();button(root,"Подтвердить скан",this::scan);
        if(!code.isEmpty())button(root,"Сбросить незавершённый скан",()->{code="";barcode="";save();render();});
        if(units!=null){Set<String> boxes=new LinkedHashSet<>();for(Object u:units)boxes.add(String.valueOf(((Map<?,?>)u).get("boxCode")));root.addView(text("Короба: "+android.text.TextUtils.join(", ",boxes)));}
        if(code.isEmpty())button(root,"Завершить сортировку",()->new android.app.AlertDialog.Builder(this).setMessage("Принять отсортированные короба на хранение и начислить обработку возвратов?").setNegativeButton("Отмена",null).setPositiveButton("Завершить",(d,w)->{pendingAction="finish";save();send();}).show());
        if(code.isEmpty())button(root,"К партиям",()->{batchId="";save();render();});
    }
    private void scan(){if(busy||input==null)return;String value=input.getText().toString().trim();if(value.isEmpty())return;
        if(code.isEmpty())code=value;else if(barcode.isEmpty())barcode=value;else{pendingAction="scan";pending.put("id",UUID.randomUUID().toString());pending.put("marketplace",marketplace);pending.put("returnCode",code);pending.put("barcode",barcode);pending.put("condition",condition);pending.put("boxCode",value);save();send();return;}save();render();}
    private void send(){if(busy||pendingAction.isEmpty())return;busy=true;render();final String action=pendingAction;final Map<String,String> body=new LinkedHashMap<>(pending);
        executor.execute(()->{try{
            Response<Map<String,Object>> r=("create".equals(action)?api.createReturns(session.authorizationHeader(),body):"scan".equals(action)?api.scanReturn(session.authorizationHeader(),batchId,body):api.finishReturns(session.authorizationHeader(),batchId,body)).execute();
            if(!r.isSuccessful()){
                String error=r.errorBody()==null?"Ошибка "+r.code():r.errorBody().string();
                try{error=new JSONObject(error).optString("message",error);}catch(Exception ignored){}
                final String msg=error;main.post(()->{busy=false;message=msg;if(r.code()>=400&&r.code()<500){pendingAction="";pending.clear();save();}render();});return;
            }
            main.post(()->{busy=false;if("create".equals(action)&&r.body()!=null)batchId=String.valueOf(r.body().get("id"));if("scan".equals(action)){code="";barcode="";}pendingAction="";pending.clear();save();message="Сохранено";refresh();});
        }catch(Exception e){main.post(()->{busy=false;message="Нет подтверждения: "+e.getMessage();render();});}});
    }
}
