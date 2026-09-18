package pro.logoff.wms.tsd;

import android.app.Activity;
import android.app.AlertDialog;
import android.text.InputType;
import android.app.DownloadManager;
import android.content.Context;
import android.content.SharedPreferences;
import android.graphics.Color;
import android.net.Uri;
import android.os.Environment;
import android.os.Handler;
import android.os.Looper;
import android.text.Editable;
import android.text.TextWatcher;
import android.view.KeyEvent;
import android.widget.*;
import org.json.JSONObject;
import java.util.*;
import java.util.concurrent.*;
import pro.logoff.wms.tsd.auth.TsdSession;
import pro.logoff.wms.tsd.network.*;
import retrofit2.Response;

final class FboTwoStageScreen {
    private final Activity activity;
    private final TsdSession session;
    private final WmsApi api;
    private final String id, baseUrl;
    private final Runnable back, moveRemainder;
    private AlertDialog quantityDialog;
    private EditText quantityInput;
    private final boolean packing;
    private int feedbackColor=Color.TRANSPARENT;
    private final Handler handler=new Handler(Looper.getMainLooper());
    private final ExecutorService executor=Executors.newSingleThreadExecutor();
    private final FboScanState state=new FboScanState();
    private final SharedPreferences prefs;
    private final String pendingKey;
    private TsdFboPlan plan;
    private EditText input;
    private boolean busy,closed;
    private String message="";
    private final Runnable automatic=this::submit;
    FboTwoStageScreen(Activity activity,TsdSession session,WmsApi api,String baseUrl,String id,boolean packing,Runnable back) {
        this(activity,session,api,baseUrl,id,packing,back,null);
    }
    FboTwoStageScreen(Activity activity,TsdSession session,WmsApi api,String baseUrl,String id,boolean packing,Runnable back,Runnable moveRemainder) {
        this.moveRemainder=moveRemainder;
        this.packing=packing;
        this.activity=activity;this.session=session;this.api=api;this.baseUrl=baseUrl;this.id=id;this.back=back;
        prefs=activity.getSharedPreferences("fbo-pending",Context.MODE_PRIVATE);pendingKey=session.userId+":"+id;
        try{state.restoreCheckpoint(readSaved(pendingKey+":position"));}catch(Exception ignored){}
        try {String saved=prefs.getString(pendingKey,"");if(!saved.isEmpty()){JSONObject json=new JSONObject(saved);Map<String,String> p=new LinkedHashMap<>();Iterator<String> keys=json.keys();while(keys.hasNext()){String k=keys.next();p.put(k,json.getString(k));}state.restore(p);}}catch(Exception e){message="Не удалось прочитать сохранённую операцию.";}
        refresh();
    }
    boolean belongsTo(TsdSession current){return session.hasSameAccessToken(current);}
    private Map<String,String> readSaved(String key)throws Exception {
        String raw=prefs.getString(key,"");if(raw.isEmpty())return null;
        JSONObject json=new JSONObject(raw);Map<String,String> saved=new LinkedHashMap<>();
        Iterator<String> keys=json.keys();while(keys.hasNext()){String k=keys.next();saved.put(k,json.getString(k));}return saved;
    }
    // FIX: report the actual FBO request even during loading or an unanswered operation.
    Map<String,Object> monitorPayload(){
        Map<String,Object> p=new LinkedHashMap<>();p.put("requestId",id);
        p.put("screenLabel","ФБО · "+FboFeedback.phase(plan==null?null:plan.phase));
        p.put("stage",plan==null?"LOADING":plan.phase);p.put("boxCode",packing?state.target:state.source);
        p.put("barcode",state.barcode);p.put("lastAction",busy?"Отправка запроса…":state.pending()!=null?"Подтверждение не получено. Повторите отправку.":message);
        if(plan!=null){boolean control="CONTROL".equals(plan.phase);int total=control?plan.boxes.size():plan.needed;
            int done=control?FboFeedback.confirmed(plan):"PICKING".equals(plan.phase)||"NOT_STARTED".equals(plan.phase)?plan.picked:plan.packed;
            p.put("total",total);p.put("completed",done);p.put("remaining",Math.max(0,total-done));}
        return p;
    }
    boolean canLeave(){return !busy&&state.pending()==null;}
    EditText scannerField(){return quantityInput!=null?quantityInput:input;}
    void close(){closed=true;if(quantityDialog!=null)quantityDialog.dismiss();handler.removeCallbacks(automatic);executor.shutdownNow();}
    private void text(LinearLayout root,String value){TextView v=new TsdUi.Label(activity);v.setText(value);v.setTextSize(19);v.setTextColor(Color.BLACK);v.setPadding(0,9,0,9);root.addView(v);}
    private void card(LinearLayout root,String value,int color){text(root,value);root.getChildAt(root.getChildCount()-1).setBackgroundColor(color);}
    private void button(LinearLayout root,String title,boolean enabled,Runnable action){Button b=new TsdUi.Button(activity);b.setText(title);b.setAllCaps(false);b.setEnabled(enabled&&!busy);b.setOnClickListener(v->action.run());root.addView(b);}
    private TsdFboPlan.Route source(){if(plan!=null&&plan.route!=null)for(TsdFboPlan.Route r:plan.route)if(r.boxCode.equals(state.source))return r;return null;}
    private boolean ready(){return state.pending()==null&&!busy;}
    private void render(){
        if(closed||activity.isDestroyed())return;
        prefs.edit().putString(pendingKey+":position",new JSONObject(state.checkpoint()).toString()).commit();
        LinearLayout root=new LinearLayout(activity);root.setOrientation(LinearLayout.VERTICAL);root.setPadding(24,20,24,24);root.setBackgroundColor(Color.WHITE);
        text(root,packing?"Упаковка FBO":"FBO WB");if(!message.isEmpty())card(root,message,feedbackColor);
        input=null;
        if(plan!=null){text(root,plan.title);text(root,"Этап: "+FboFeedback.phase(plan.phase));
            text(root,"Отобрано "+plan.picked+" из "+plan.needed+" · Упаковано "+plan.packed+" из "+plan.needed);
            text(root,"Проверено коробов "+FboFeedback.confirmed(plan)+" из "+plan.boxes.size());
            if(plan.compositionChanged)text(root,"Состав заявки изменился. Нужна сверка.");
            if(plan.shortage>0)text(root,"Недостаточно доступного остатка: "+plan.shortage+" ед.");
            if(!FboScanState.phaseAllowed(packing,plan.phase))text(root,packing?"Сначала завершите отбор в Сборка FBO.":"Отбор завершён. Откройте Упаковка FBO.");
            else if("NOT_STARTED".equals(plan.phase))button(root,"Начать отбор",ready(),()->send("START",null));
            else if("COMPLETED".equals(plan.phase)){text(root,"Все короба поставки подтверждены");button(root,"Скачать файл WB",ready(),this::download);}
            else {
                String hint="ШК товара";
                if("CONTROL".equals(plan.phase))hint="ШК короба поставки";
                else if("PICKING".equals(plan.phase)&&state.source.isEmpty())hint=state.pallet.isEmpty()?"ШК паллета / короба без паллета":"ШК короба на выбранном паллете";
                else if("PACKING".equals(plan.phase)&&state.target.isEmpty())hint=plan.wholeBoxes.isEmpty()?"ШК короба для упаковки / целого короба":"Сначала отсканируйте целые короба.";
                else if(!state.barcode.isEmpty())hint="КИЗ товара";
                text(root,hint);input=new EditText(activity);input.setSingleLine(true);TsdUi.hint(input,hint);input.setEnabled(ready());root.addView(input);
                input.setOnEditorActionListener((v,a,e)->{submit();return true;});
                input.addTextChangedListener(new TextWatcher(){public void beforeTextChanged(CharSequence s,int a,int c,int f){}public void onTextChanged(CharSequence s,int a,int b,int c){}public void afterTextChanged(Editable s){handler.removeCallbacks(automatic);if(ready()&&s.length()>0)handler.postDelayed(automatic,350);}});
                button(root,"Подтвердить скан",ready(),this::submit);
                if("PICKING".equals(plan.phase)){
                    text(root,"Осталось отобрать "+(plan.needed-plan.picked));TsdFboPlan.Route r=source();
                    if(r!=null){card(root,r.boxCode+" · "+r.pallet+" · "+r.zone,Color.rgb(187,247,208));for(TsdFboPlan.Task t:r.tasks)text(root,"Отберите "+t.quantity+" ед. · "+t.name+" · "+t.barcode);
                        if(r.recount)text(root,"Для целого короба требуется актуализация: количество и КИЗ расходятся.");
                        // FIX: picking and transferring the surplus are explicit choices, never automatic writes.
                        button(root,"Отобрать товар по ШК + КИЗ",ready(),()->{state.barcode="";message="Сканируйте ШК нужного товара, затем КИЗ.";render();});
                        if(r.remainderQuantity>0&&moveRemainder!=null)button(root,"Переместить ненужный остаток ("+r.remainderQuantity+" ед.)",ready()&&state.barcode.isEmpty(),()->{if(!canLeave())return;close();moveRemainder.run();});
                        if(r.wholeBox)button(root,"Короб забран целиком",ready()&&state.barcode.isEmpty(),this::confirmWholeBoxDialog);
                        button(root,"Другой исходный короб",ready(),()->{state.source="";state.barcode="";render();});
                    }else {
                        if(state.pallet.isEmpty()){
                            Map<String,Integer> pallets=new LinkedHashMap<>();for(TsdFboPlan.Route row:plan.route)if(!row.pallet.isEmpty())pallets.put(row.pallet,pallets.getOrDefault(row.pallet,0)+1);
                            for(Map.Entry<String,Integer> p:pallets.entrySet())text(root,p.getKey()+" · Нужных коробов: "+p.getValue());
                        }
                        for(TsdFboPlan.Route row:plan.route)if(row.pallet.equals(state.pallet)){card(root,(row.pallet.isEmpty()?"Без паллета":row.pallet)+" · "+row.zone+" → "+row.boxCode,Color.rgb(254,240,138));for(TsdFboPlan.Task t:row.tasks)text(root,t.name+": "+t.quantity+" ед.");}
                    }
                    if(!state.pallet.isEmpty()){text(root,"Паллет "+state.pallet);button(root,"Другой паллет",ready(),()->{state.pallet="";state.source="";state.barcode="";render();});}
                    button(root,"Завершить отбор",ready()&&plan.picked==plan.needed,()->send("FINISH_PICK",null));
                }else if("PACKING".equals(plan.phase)){
                    text(root,"Осталось вложить "+(plan.needed-plan.packed));
                    if(!state.target.isEmpty()){text(root,"Открыт короб "+state.target);button(root,"Закрыть короб",ready(),()->send("CLOSE_BOX",null));}
                    for(TsdFboPlan.Box b:plan.boxes)if(b.code.equals(state.target)&&!b.closed&&b.quantity==0)button(root,"Отложить пустой короб",ready(),()->send("CANCEL_EMPTY_BOX",null));
                    if(!plan.wholeBoxes.isEmpty())text(root,"Целые короба к добавлению: "+String.join(", ",plan.wholeBoxes));
                    boolean allClosed=true;for(TsdFboPlan.Box b:plan.boxes)if(!b.closed)allClosed=false;
                    button(root,"Короба разобраны",ready()&&plan.packed==plan.needed&&allClosed,()->send("SORTED",null));
                }else if("CONTROL".equals(plan.phase)){
                    int count=0;for(TsdFboPlan.Box b:plan.boxes)if(b.confirmed)count++;
                    text(root,"Подтверждено коробов "+count+" из "+plan.boxes.size());
                    button(root,"Завершить проверку и сформировать файл WB",ready()&&count==plan.boxes.size(),()->send("FINISH",null));
                }
                for(TsdFboPlan.Box b:plan.boxes)text(root,b.code+" · "+b.quantity+" ед. · "+(b.confirmed?"Подтверждён":b.closed?"Закрыт":"Открыт"));
            }
        }
        if(state.pending()!=null){
            text(root,busy?"Отправка запроса…":"Подтверждение не получено. Запрос сохранён — повторное сканирование не требуется.");
            button(root,"Повторить отправку",!busy,()->send("",null));
        }
        button(root,"Обновить",ready(),this::refresh);button(root,"Назад",canLeave(),()->{close();back.run();});
        ScrollView scroll=new ScrollView(activity);scroll.addView(root);activity.setContentView(scroll);if(input!=null&&ready())input.requestFocus();
    }
    void submit(){if(quantityDialog!=null){confirmWholeBoxQuantity();return;}handler.removeCallbacks(automatic);if(!ready()||input==null||plan==null)return;String value=input.getText().toString().trim();if(value.isEmpty())return;input.setText("");message="";
        if("CONTROL".equals(plan.phase)){state.target=value;send("CONFIRM_BOX",null);return;}
        feedbackColor=Color.rgb(254,202,202);
        if(!FboScanState.phaseAllowed(packing,plan.phase))return;
        if("PICKING".equals(plan.phase)&&state.source.isEmpty()){
            boolean accepted=state.scanLocation(plan,value);
            feedbackColor=accepted?Color.rgb(187,247,208):Color.rgb(254,202,202);
            message=accepted?(state.source.isEmpty()?"Паллет найден":"Нужный короб"):"Короб или паллет не требуется для этой сборки.";
            render();return;
        }
        if("PACKING".equals(plan.phase)&&state.target.isEmpty()){
            if(plan.wholeBoxes.contains(value)){state.source=value;send("PACK_BOX",null);}
            else if(!plan.wholeBoxes.isEmpty()){message="Сначала отсканируйте целые короба.";feedbackColor=Color.rgb(254,202,202);render();}
            else{state.source="";state.target=value;send("OPEN_BOX",null);}return;
        }
        if(!state.barcode.isEmpty()){send("PICKING".equals(plan.phase)?"PICK_UNIT":"PACK_UNIT",value);return;}
        TsdFboPlan.Line line=null;for(TsdFboPlan.Line l:plan.lines)if(value.equals(l.barcode)&&("PICKING".equals(plan.phase)?l.remaining>0:l.picked>l.packed)){line=l;break;}
        if(line==null){message="Этот ШК не требуется на текущем этапе.";render();return;}
        // FIX: show the accepted product while waiting for its KIZ; a barcode alone is not a completed pick.
        feedbackColor=Color.rgb(187,247,208);message="Нужный товар";
        state.barcode=value;if(line.requiresKiz)render();else send("PICKING".equals(plan.phase)?"PICK_UNIT":"PACK_UNIT",null);
    }
    private void refresh(){if(busy||closed)return;busy=true;render();executor.execute(()->{try{Response<TsdFboPlan> res=api.getFboPlan(session.authorizationHeader(),id).execute();if(!res.isSuccessful()||res.body()==null)throw new Exception(error(res));TsdFboPlan next=res.body();handler.post(()->{if(closed)return;plan=next;if(state.pending()==null)state.reconcile(plan);busy=false;render();});}catch(Exception e){handler.post(()->{if(closed)return;busy=false;message="Не удалось обновить: "+e.getMessage();render();});}});}
    private void send(String action,String kiz){send(action,kiz,null);}
    private void send(String action,String kiz,Integer quantity){if(busy||closed)return;Map<String,String> payload=state.prepare(action,kiz,quantity);
        // FIX: persist before sending, so a restart can retry the identical operation.
        if(!prefs.edit().putString(pendingKey,new JSONObject(payload).toString()).commit()){message="Не удалось сохранить операцию. Проверьте память ТСД.";render();return;}
        busy=true;message="";render();executor.execute(()->{try{
            Response<TsdFboPlan> res=api.actFbo(session.authorizationHeader(),id,payload).execute();
            if(!res.isSuccessful()||res.body()==null){boolean rejected=FboFeedback.definitiveRejection(res.code());String detail=error(res);handler.post(()->{if(closed)return;if(rejected&&prefs.edit().remove(pendingKey).commit()){state.rejected();if("OPEN_BOX".equals(payload.get("action")))state.target="";}busy=false;feedbackColor=Color.rgb(254,202,202);message=detail;
                // FIX: a definitive stock/route conflict must not leave the picker on a stale box.
                if(res.code()==409&&rejected)refresh();else render();});return;}
            TsdFboPlan next=res.body();handler.post(()->{if(closed)return;plan=next;busy=false;
                if(!prefs.edit().remove(pendingKey).commit()){message="Сервер принял операцию, но ТСД не сохранил подтверждение. Повторите отправку.";render();return;}
                state.accepted();feedbackColor=Color.rgb(187,247,208);message=FboFeedback.accepted(payload,plan);
                if("OPEN_BOX".equals(payload.get("action")))state.target=payload.get("targetBoxCode");state.reconcile(plan);if("FINISH".equals(payload.get("action")))download();render();});
        }catch(Exception e){handler.post(()->{if(closed)return;busy=false;feedbackColor=Color.rgb(254,202,202);message="Подтверждение не получено. Нажмите «Повторить отправку».";render();});}});
    }
    // FIX: do not prefill a physical count or submit stock movements before confirmation.
    private void confirmWholeBoxDialog(){
        if(!ready()||source()==null)return;
        handler.removeCallbacks(automatic);
        quantityInput=new EditText(activity);quantityInput.setInputType(InputType.TYPE_CLASS_NUMBER);
        quantityInput.setSingleLine(true);quantityInput.setHint("Фактическое количество единиц");
        quantityDialog=new AlertDialog.Builder(activity).setTitle("Короб забран целиком")
            .setMessage("Введите количество единиц товара в коробе. По учёту: "+source().wholeBoxQuantity)
            .setView(quantityInput).setPositiveButton("Подтвердить",null).setNegativeButton("Отмена",null).create();
        quantityDialog.setOnDismissListener(d->{quantityDialog=null;quantityInput=null;if(!closed)render();});
        quantityDialog.show();quantityDialog.getButton(AlertDialog.BUTTON_POSITIVE).setOnClickListener(v->confirmWholeBoxQuantity());
        quantityInput.requestFocus();
    }
    private void confirmWholeBoxQuantity(){
        if(quantityInput==null||!ready())return;
        int count;try{count=Integer.parseInt(quantityInput.getText().toString().trim());}catch(Exception e){quantityInput.setError("Введите целое положительное количество");return;}
        TsdFboPlan.Route route=source();
        if(count<1||route==null||count!=route.wholeBoxQuantity){quantityInput.setError("Количество не совпадает с учётом. Проверьте короб и обновите задание.");return;}
        quantityDialog.dismiss();send("PICK_BOX",null,count);
    }
    private String error(Response<?> response){try{if(response.errorBody()!=null){Object m=new JSONObject(response.errorBody().string()).opt("message");if(m!=null)return m.toString();}}catch(Exception ignored){}return "Ошибка ВМС "+response.code();}
    private void download(){try{DownloadManager manager=(DownloadManager)activity.getSystemService(Context.DOWNLOAD_SERVICE);String url=baseUrl.replaceAll("/+$","")+"/api/v1/tsd/requests/"+id+"/fbo/wb-packages.xlsx";
        DownloadManager.Request req=new DownloadManager.Request(Uri.parse(url));req.addRequestHeader("Authorization",session.authorizationHeader());req.setTitle("Короба ФБО для WB");req.setNotificationVisibility(DownloadManager.Request.VISIBILITY_VISIBLE_NOTIFY_COMPLETED);req.setDestinationInExternalFilesDir(activity,Environment.DIRECTORY_DOWNLOADS,"wb-packages-"+id+"-"+System.currentTimeMillis()+".xlsx");manager.enqueue(req);message="Файл загружается. Откройте его из уведомления.";render();}catch(Exception e){message="Не удалось скачать файл: "+e.getMessage();render();}}
}
