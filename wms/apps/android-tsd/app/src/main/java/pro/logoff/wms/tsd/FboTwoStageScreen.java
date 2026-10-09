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
    private final FboScanFeedback scanFeedback;
    private final FboPackingVoice packingVoice=new FboPackingVoice();
    private int feedbackColor=Color.TRANSPARENT;
    private boolean retrySending, waitingExpanded, scannedExpanded;
    private final Handler handler=new Handler(Looper.getMainLooper());
    private final ExecutorService executor=Executors.newSingleThreadExecutor();
    private final FboScanState state=new FboScanState();
    private final SharedPreferences prefs;
    private final String pendingKey;
    private TsdFboPlan plan;
    private EditText input;
    private boolean busy,closed,routeStale;
    private boolean manualPackingScan,packingErrorSpeech;
    // FIX: isolate explicit packing modes to our application; sold flavors retain their flow.
    private enum PackingMode { MENU, NEW_BOXES, WHOLE_BOXES, MANUAL }
    private PackingMode packingMode=PackingMode.MENU;
    // FIX: our picker chooses a remaining route; packaging, quantities and the server phase stay shared.
    private FboPickingRoute.Mode pickingMode=FboPickingRoute.Mode.MENU;
    private boolean pickingChoices(){return !packing&&"logoff".equals(BuildConfig.FLAVOR);}
    private List<TsdFboPlan.Route> pickingRoute(){return pickingChoices()?FboPickingRoute.select(plan,pickingMode):plan.route;}
    private void choosePickingMode(FboPickingRoute.Mode mode){
        if(!ready()||!state.barcode.isEmpty())return;
        boolean hadLocation=!state.pallet.isEmpty()||!state.source.isEmpty();
        handler.removeCallbacks(automatic);state.pallet="";state.source="";pickingMode=mode;
        message="";feedbackColor=Color.TRANSPARENT;
        if(hadLocation)refresh();else render();
    }
    private void reconcilePickingMode(){
        if(!pickingChoices()||plan==null||state.pending()!=null)return;
        if(pickingMode==FboPickingRoute.Mode.MENU&&!state.source.isEmpty())
            for(TsdFboPlan.Route row:plan.route)if(row.boxCode.equals(state.source))
                pickingMode=FboPickingRoute.whole(plan,row)?FboPickingRoute.Mode.WHOLE_BOXES:FboPickingRoute.Mode.PARTIAL;
        if(pickingMode==FboPickingRoute.Mode.MENU)return;
        boolean hasSource=false,hasPallet=false;
        for(TsdFboPlan.Route row:pickingRoute()){
            if(row.pallet.equals(state.pallet))hasPallet=true;
            if(row.pallet.equals(state.pallet)&&row.boxCode.equals(state.source))hasSource=true;
        }
        if(!hasPallet)state.pallet="";
        if(!hasSource){state.source="";state.barcode="";}
    }
    private boolean ozon(){return plan!=null&&"OZON".equals(plan.marketplace);}
    private boolean packingChoices(){return !ozon()&&packing&&"logoff".equals(BuildConfig.FLAVOR);}
    private void choosePackingMode(PackingMode mode){
        if(!ready()||!state.target.isEmpty()||!state.barcode.isEmpty())return;
        handler.removeCallbacks(automatic);state.source="";packingMode=mode;prefs.edit().putString(pendingKey+":mode",mode.name()).commit();message="";feedbackColor=Color.TRANSPARENT;render();
    }
    private void packingCompleteButton(LinearLayout root){
        boolean allClosed=true;for(TsdFboPlan.Box b:plan.boxes)if(!b.closed)allClosed=false;
        button(root,packingChoices()?"Сканировать все короба поставки":"Короба разобраны",ready()&&"PACKING".equals(plan.phase)&&plan.packed==plan.needed&&allClosed,()->send("SORTED",null));
    }
    private Runnable statusCheck;
    private String message="";
    private final Runnable automatic=this::submit;
    FboTwoStageScreen(Activity activity,TsdSession session,WmsApi api,String baseUrl,String id,boolean packing,Runnable back) {
        this(activity,session,api,baseUrl,id,packing,back,null);
    }
    FboTwoStageScreen(Activity activity,TsdSession session,WmsApi api,String baseUrl,String id,boolean packing,Runnable back,Runnable moveRemainder) {
        this(activity,session,api,baseUrl,id,packing,back,moveRemainder,
            "logoff".equals(BuildConfig.FLAVOR)?new FboScanFeedback.Voice(activity,session.userId):null);
    }
    FboTwoStageScreen(Activity activity,TsdSession session,WmsApi api,String baseUrl,String id,boolean packing,Runnable back,Runnable moveRemainder,FboScanFeedback scanFeedback) {
        this.scanFeedback=scanFeedback;
        this.moveRemainder=moveRemainder;
        this.packing=packing;
        this.activity=activity;this.session=session;this.api=api;this.baseUrl=baseUrl;this.id=id;this.back=back;
        prefs=activity.getSharedPreferences("fbo-pending",Context.MODE_PRIVATE);pendingKey=session.userId+":"+id;
        if(pickingChoices())try{pickingMode=FboPickingRoute.Mode.valueOf(prefs.getString(pendingKey+":picking-mode","MENU"));}catch(Exception ignored){}
        if(packingChoices())try{packingMode=PackingMode.valueOf(prefs.getString(pendingKey+":mode","MENU"));}catch(Exception ignored){}
        try{state.restoreCheckpoint(readSaved(pendingKey+":position"));}catch(Exception ignored){}
        try {String saved=prefs.getString(pendingKey,"");if(!saved.isEmpty()){JSONObject json=new JSONObject(saved);Map<String,String> p=new LinkedHashMap<>();Iterator<String> keys=json.keys();while(keys.hasNext()){String k=keys.next();p.put(k,json.getString(k));}state.restore(p);if(packingChoices())packingMode=p.getOrDefault("action","").startsWith("MANUAL_")?PackingMode.MANUAL:"PACK_BOX".equals(p.get("action"))?PackingMode.WHOLE_BOXES:PackingMode.NEW_BOXES;}}catch(Exception e){message="Не удалось прочитать сохранённую операцию.";}
        if(pickingChoices()&&state.pending()!=null){String action=state.pending().get("action");
            if("PICK_BOX".equals(action))pickingMode=FboPickingRoute.Mode.WHOLE_BOXES;
            else if("PICK_UNIT".equals(action))pickingMode=FboPickingRoute.Mode.PARTIAL;
        }
        if(fastConfirmation()&&state.pending()!=null)checkPending(0);else refresh();
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
        p.put("screenLabel","ФБО · "+FboFeedback.phase(plan==null?null:screenPhase()));
        p.put("fboWorkflow",packing?"PACKING":"PICKING");
        p.put("stage",plan==null?"LOADING":screenPhase());p.put("boxCode",packing?state.target:state.source);
        p.put("barcode",state.barcode);p.put("lastAction",routeStale?message+" Обновляется маршрут.":busy?"Отправка запроса…":state.pending()!=null?"Подтверждение не получено. Повторите отправку.":message);
        if(plan!=null){boolean control="CONTROL".equals(screenPhase());int total=control?plan.boxes.size():plan.needed;
            int done=control?FboFeedback.confirmed(plan):"PICKING".equals(screenPhase())||"NOT_STARTED".equals(screenPhase())?plan.picked:plan.packed;
            p.put("total",total);p.put("completed",done);p.put("remaining",Math.max(0,total-done));}
        return p;
    }
    boolean canLeave(){return !busy&&state.pending()==null;}
    EditText scannerField(){return quantityInput!=null?quantityInput:input;}
    void close(){closed=true;if(scanFeedback!=null)scanFeedback.close();if(quantityDialog!=null)quantityDialog.dismiss();handler.removeCallbacks(automatic);if(statusCheck!=null)handler.removeCallbacks(statusCheck);executor.shutdownNow();}
    private void text(LinearLayout root,String value){TextView v=new TsdUi.Label(activity);v.setText(value);v.setTextSize(19);v.setTextColor(Color.BLACK);v.setPadding(0,9,0,9);root.addView(v);}
    private void card(LinearLayout root,String value,int color){text(root,value);root.getChildAt(root.getChildCount()-1).setBackgroundColor(color);}
    private void button(LinearLayout root,String title,boolean enabled,Runnable action){Button b=new TsdUi.Button(activity);b.setText(title);b.setAllCaps(false);b.setEnabled(enabled&&!busy);b.setOnClickListener(v->action.run());root.addView(b);}
    private TsdFboPlan.Route source(){if(plan!=null&&plan.route!=null)for(TsdFboPlan.Route r:pickingRoute())if(r.boxCode.equals(state.source))return r;return null;}
    // FIX: speak for locations and product barcodes during picking, never for KIZ or server responses.
    // FIX: packing can start with the first confirmed unit while collection stays open.
    private String screenPhase(){return FboScanState.screenPhase(plan,packing && "logoff".equals(BuildConfig.FLAVOR));}
    private void speakScan(boolean accepted){if(!closed&&!packing&&plan!=null&&"PICKING".equals(screenPhase())&&"logoff".equals(BuildConfig.FLAVOR)&&scanFeedback!=null)scanFeedback.scan(accepted,"picking:"+(state.source.isEmpty()?"location":"barcode"));}
    // FIX: preserve parallel packing and acknowledge speech only after a durable receipt.
    private boolean packingVoiceActive(){return !closed&&packingChoices()&&(packingMode==PackingMode.NEW_BOXES||packingMode==PackingMode.MANUAL)&&plan!=null&&"PACKING".equals(screenPhase());}
    private void packingPrompt(FboPackingVoice.Cue cue){if(!closed&&scanFeedback!=null&&cue!=null)scanFeedback.prompt(cue);}
    private void packingAccepted(Map<String,String> payload){
        if(closed||!packingChoices())return;
        if("PACK_BOX".equals(payload.get("action")))packingPrompt(packingVoice.boxAccepted(payload.get("operationId")));
        else if("PACK_UNIT".equals(payload.get("action"))||"MANUAL_PACK_UNIT".equals(payload.get("action")))packingPrompt(packingVoice.accepted(payload.get("operationId")));
    }
    // FIX: cancel only the unsubmitted barcode/KIZ pair, never a committed packing operation.
    private boolean packingScanRecovery(){return !closed&&packingChoices()&&plan!=null&&"PACKING".equals(screenPhase())&&!state.target.isEmpty()&&!state.barcode.isEmpty();}
    private void cancelPackingScan(){
        if(!packingScanRecovery()||!ready())return;
        handler.removeCallbacks(automatic);state.barcode="";manualPackingScan=false;
        message="Скан отменён. Отсканируйте ШК следующего товара.";feedbackColor=Color.TRANSPARENT;render();
    }
    private void manualPackingKiz(){
        if(!packingScanRecovery()||!ready()||!plan.manualPackingEnabled)return;
        handler.removeCallbacks(automatic);manualPackingScan=true;
        message="Отсканируйте КИЗ для товара "+state.barcode;feedbackColor=Color.TRANSPARENT;render();
    }
    // FIX: expanding lists does not rebuild the scanner or discard its current text.
    private void cartonList(LinearLayout root,String title,List<String> codes,boolean waiting){
        boolean expanded=waiting?waitingExpanded:scannedExpanded;
        Button toggle=new TsdUi.Button(activity);toggle.setAllCaps(false);
        LinearLayout content=new LinearLayout(activity);content.setOrientation(LinearLayout.VERTICAL);
        for(String code:codes)text(content,code);
        if(codes.isEmpty())text(content,"Нет коробов");
        content.setVisibility(expanded?android.view.View.VISIBLE:android.view.View.GONE);
        toggle.setText((expanded?"▼ ":"▶ ")+title+" ("+codes.size()+")");
        toggle.setOnClickListener(v->{boolean open=content.getVisibility()!=android.view.View.VISIBLE;
            if(waiting)waitingExpanded=open;else scannedExpanded=open;
            content.setVisibility(open?android.view.View.VISIBLE:android.view.View.GONE);
            toggle.setText((open?"▼ ":"▶ ")+title+" ("+codes.size()+")");
            AssemblyAutoFocus.request(input,()->ready()&&!closed&&quantityDialog==null);
        });
        root.addView(toggle);root.addView(content);
    }
    private void wholeCartonProgress(LinearLayout root){
        FboPackingProgress progress=new FboPackingProgress(plan);
        text(root,"Целые короба: отсканировано "+progress.scanned.size()+" из "+progress.total()+" · осталось "+progress.waiting.size());
        cartonList(root,"Целые короба к добавлению",progress.waiting,true);
        cartonList(root,"Отсканированные целые короба",progress.scanned,false);
    }
    private boolean ready(){return state.pending()==null&&!busy&&!routeStale;}
    private LinearLayout compactRoot;
    private TextView compactProgress,compactTarget,compactHint,compactMessage;
    private Button compactSubmit,compactClose,compactCancel,compactManual,compactEmpty,compactModes,compactRefresh,compactRetry,compactBack;
    private TextView compactLabel(){TextView v=new TsdUi.Label(activity);v.setTextSize(22);v.setPadding(0,12,0,12);compactRoot.addView(v);return v;}
    private Button compactButton(String title,Runnable action){Button b=new TsdUi.Button(activity);b.setText(title);b.setAllCaps(false);b.setOnClickListener(v->action.run());compactRoot.addView(b);return b;}
    // FIX: retain the actual scan field while only status labels and enabled states change.
    private boolean renderCompactPacking(){
        if(!packingChoices()||plan==null||!plan.compactPackingSupported||!"PACKING".equals(screenPhase())||
            !(packingMode==PackingMode.NEW_BOXES||packingMode==PackingMode.MANUAL)){compactRoot=null;return false;}
        if(compactRoot==null){
            compactRoot=new LinearLayout(activity);compactRoot.setOrientation(LinearLayout.VERTICAL);compactRoot.setPadding(24,20,24,24);
            compactLabel().setText("Упаковка FBO · "+plan.title);
            compactProgress=compactLabel();compactTarget=compactLabel();compactMessage=compactLabel();compactHint=compactLabel();
            input=new EditText(activity);input.setSingleLine(true);input.setTextSize(24);compactRoot.addView(input);
            input.setOnEditorActionListener((v,a,e)->{submit();return true;});
            input.addTextChangedListener(new TextWatcher(){public void beforeTextChanged(CharSequence s,int a,int c,int f){}public void onTextChanged(CharSequence s,int a,int b,int c){}public void afterTextChanged(Editable s){handler.removeCallbacks(automatic);if(ready()&&s.length()>0)handler.postDelayed(automatic,350);}});
            compactSubmit=compactButton("Подтвердить скан",this::submit);
            compactCancel=compactButton("Отменить скан",this::cancelPackingScan);
            compactManual=compactButton("Добавить КИЗ вручную",this::manualPackingKiz);
            compactClose=compactButton("Закрыть короб",()->{if(ready())send("CLOSE_BOX",null);});
            compactEmpty=compactButton("Отложить пустой короб",()->{if(ready())send("CANCEL_EMPTY_BOX",null);});
            compactModes=compactButton("К выбору упаковки",()->{if(ready()&&state.barcode.isEmpty())choosePackingMode(PackingMode.MENU);});
            compactRetry=compactButton("Повторить отправку",()->{if(!busy&&state.pending()!=null)send(state.pending().get("action"),state.pending().get("kiz"));});
            compactRefresh=compactButton("Обновить",this::refresh);
            compactBack=compactButton("В меню",()->{if(!busy&&state.pending()==null){close();back.run();}});
            ScrollView scroll=new ScrollView(activity);scroll.setFillViewport(true);scroll.addView(compactRoot);activity.setContentView(scroll);
        }
        TsdFboPlan.Box target=null;for(TsdFboPlan.Box b:plan.boxes)if(b.code.equals(state.target))target=b;
        compactProgress.setText("Отобрано "+plan.picked+" из "+plan.needed+" · Упаковано "+plan.packed+" · Осталось вложить "+Math.max(0,plan.picked-plan.packed));
        compactTarget.setText(state.target.isEmpty()?"Откройте короб":("Короб "+state.target+" · "+(target==null?0:target.quantity)+" шт."));
        String hint=state.target.isEmpty()?"ШК короба для упаковки":state.barcode.isEmpty()?"ШК товара":"КИЗ товара";
        compactHint.setText(hint);TsdUi.hint(input,hint);
        compactMessage.setText(busy?"Сохраняю…":routeStale?"Нужна сверка. Нажмите «Обновить».":message);
        compactRoot.setBackgroundColor(AssemblyScreenFeedback.background(true,retrySending&&busy&&state.pending()!=null,packingErrorSpeech?Color.rgb(254,202,202):feedbackColor));
        input.setEnabled(ready());compactSubmit.setEnabled(ready());
        compactCancel.setVisibility(state.barcode.isEmpty()?android.view.View.GONE:android.view.View.VISIBLE);compactCancel.setEnabled(ready());
        compactManual.setVisibility(plan.manualPackingEnabled&&!state.barcode.isEmpty()?android.view.View.VISIBLE:android.view.View.GONE);compactManual.setEnabled(ready());
        compactClose.setEnabled(ready()&&target!=null&&!target.closed&&target.quantity>0&&state.barcode.isEmpty());
        compactEmpty.setEnabled(ready()&&target!=null&&!target.closed&&target.quantity==0&&state.barcode.isEmpty());
        compactModes.setEnabled(ready()&&state.barcode.isEmpty());compactRefresh.setEnabled(!busy&&state.pending()==null);compactBack.setEnabled(!busy&&state.pending()==null);
        compactRetry.setVisibility(state.pending()==null?android.view.View.GONE:android.view.View.VISIBLE);compactRetry.setEnabled(!busy&&state.pending()!=null);
        if(ready())input.requestFocus();packingPrompt(packingVoice.step(packingVoiceActive(),ready(),state.target,state.barcode));
        return true;
    }

    private void render(){
        if(closed||activity.isDestroyed())return;
        if(pickingChoices())prefs.edit().putString(pendingKey+":picking-mode",pickingMode.name()).commit();
        prefs.edit().putString(pendingKey+":position",new JSONObject(state.checkpoint()).toString()).commit();
        if(renderCompactPacking())return;
        LinearLayout root=new LinearLayout(activity);root.setOrientation(LinearLayout.VERTICAL);root.setPadding(24,20,24,24);int screenColor=AssemblyScreenFeedback.background("logoff".equals(BuildConfig.FLAVOR),retrySending&&busy&&state.pending()!=null,packingErrorSpeech?Color.rgb(254,202,202):feedbackColor);root.setBackgroundColor(screenColor);
        text(root,packing?"Упаковка FBO":ozon()?"FBO Ozon":"FBO WB");if(!message.isEmpty())card(root,message,feedbackColor);
        if("logoff".equals(BuildConfig.FLAVOR)&&retrySending&&busy&&state.pending()!=null)text(root,"Повторная отправка запроса");
        input=null;
        if(packingChoices()&&packingMode==PackingMode.MENU&&!state.target.isEmpty())packingMode=PackingMode.NEW_BOXES;
        if(plan!=null){text(root,plan.title);text(root,"Этап: "+FboFeedback.phase(screenPhase()));
            text(root,"Отобрано "+plan.picked+" из "+plan.needed+" · Упаковано "+plan.packed+" из "+plan.needed);
            text(root,"Проверено коробов "+FboFeedback.confirmed(plan)+" из "+plan.boxes.size());
            if(ozon()&&plan.directions!=null){
                text(root,"Одна сборка · "+plan.directions.size()+" направлений");
                for(TsdFboPlan.Direction d:plan.directions){
                    String label=d.name+" · упаковано "+d.packed+" из "+d.needed;
                    if("PACKING".equals(screenPhase())&&state.target.isEmpty())button(root,label,ready(),()->{state.direction=d.name;render();});
                    else text(root,label);
                }
                text(root,"Направление короба: "+state.direction);
            }
            if(plan.parallelPackingSupported)text(root,"\u041e\u0436\u0438\u0434\u0430\u0435\u0442 \u0443\u043f\u0430\u043a\u043e\u0432\u043a\u0438: "+Math.max(0,plan.picked-plan.packed));
            if(packingChoices()&&("PACKING".equals(plan.phase)||"PICKING".equals(plan.phase)))wholeCartonProgress(root);
            if(plan.compositionChanged)text(root,"Состав заявки изменился. Нужна сверка.");
            if(plan.shortage>0)text(root,"Недостаточно доступного остатка: "+plan.shortage+" ед.");
            // FIX: do not describe accepted goods awaiting placement as absent.
            if(plan.pendingPlacementQuantity>0)text(root,"Принято, ожидает размещения: "+plan.pendingPlacementQuantity+" шт. Разместите короба на палет-сорте и обновите маршрут.");
            if(!FboScanState.phaseAllowed(packing,screenPhase()))text(root,packing?"Сначала завершите отбор в Сборка FBO.":"Отбор завершён. Откройте Упаковка FBO.");
            else if("NOT_STARTED".equals(screenPhase()))button(root,"Начать отбор",ready(),()->send("START",null));
            else if("COMPLETED".equals(screenPhase())){text(root,"Все короба поставки подтверждены");
                // FIX: both confirmed-shipment templates remain downloadable from the request.
                if(ozon()){text(root,"Все направления собраны");}else if(packingChoices()){
                    button(root,"Скачать состав для WB",ready(),()->download("products"));
                    button(root,"Скачать распределение по коробам для WB",ready(),()->download("packages"));
                }else button(root,"Скачать файл WB",ready(),this::download);
            }
            else if(pickingChoices()&&"PICKING".equals(screenPhase())&&pickingMode==FboPickingRoute.Mode.MENU&&state.pending()==null){
                for(FboPickingRoute.Mode mode:new FboPickingRoute.Mode[]{FboPickingRoute.Mode.WHOLE_BOXES,FboPickingRoute.Mode.PARTIAL}){
                    List<TsdFboPlan.Route> route=FboPickingRoute.select(plan,mode);
                    String title=mode==FboPickingRoute.Mode.WHOLE_BOXES?"Сборка целых коробов":"Частичный отбор";
                    button(root,title+" · "+route.size()+" коробов · "+FboPickingRoute.quantity(route)+" ед.",ready(),()->choosePickingMode(mode));
                }
                button(root,"Завершить отбор",ready()&&plan.picked==plan.needed,()->send("FINISH_PICK",null));
            }
            // FIX: a pending request remains retryable after a restart with the same operation id.
            else if(packingChoices()&&"PACKING".equals(screenPhase())&&packingMode==PackingMode.MENU&&state.pending()==null){
                button(root,"Собрать новые короба",ready(),()->choosePackingMode(PackingMode.NEW_BOXES));
                button(root,"Отсканировать целые короба",ready(),()->choosePackingMode(PackingMode.WHOLE_BOXES));
                if(plan.manualPackingEnabled)button(root,"Добавить товар вручную",ready(),()->choosePackingMode(PackingMode.MANUAL));
                packingCompleteButton(root);
                for(TsdFboPlan.Box b:plan.boxes)if(!packingChoices()||(!"PACKING".equals(plan.phase)&&!"PICKING".equals(plan.phase))||!b.wholeBox)text(root,b.code+(b.direction==null?"":" · "+b.direction)+" · "+b.quantity+" ед. · "+(b.closed?"Закрыт":"Открыт"));
            }
            else {
                String hint="ШК товара";
                if("CONTROL".equals(screenPhase()))hint="ШК короба поставки";
                else if("PICKING".equals(screenPhase())&&state.source.isEmpty())hint=state.pallet.isEmpty()?"ШК паллета / короба без паллета":"ШК короба на выбранном паллете";
                else if("PACKING".equals(screenPhase())&&state.target.isEmpty())hint=packingChoices()
                    ?(packingMode==PackingMode.WHOLE_BOXES?"ШК целого короба":packingMode==PackingMode.MANUAL&&plan.reusablePackingEnabled?"ШК нового или закрытого короба для дополнения":"ШК короба для упаковки")
                    :plan.wholeBoxes.isEmpty()?"ШК короба для упаковки / целого короба":"Сначала отсканируйте целые короба.";
                else if(!state.barcode.isEmpty())hint="КИЗ товара";
                if(pickingChoices()&&"PICKING".equals(screenPhase())&&pickingMode==FboPickingRoute.Mode.WHOLE_BOXES&&!state.source.isEmpty())hint="Подтвердите отбор целого короба кнопкой ниже";
                text(root,hint);input=new EditText(activity);input.setSingleLine(true);TsdUi.hint(input,hint);input.setEnabled(ready());root.addView(input);
                input.setOnEditorActionListener((v,a,e)->{submit();return true;});
                input.addTextChangedListener(new TextWatcher(){public void beforeTextChanged(CharSequence s,int a,int c,int f){}public void onTextChanged(CharSequence s,int a,int b,int c){}public void afterTextChanged(Editable s){handler.removeCallbacks(automatic);if(ready()&&s.length()>0)handler.postDelayed(automatic,350);}});
                button(root,"Подтвердить скан",ready(),this::submit);
                if(packingScanRecovery()){
                    button(root,"Отменить скан",ready(),this::cancelPackingScan);
                    if(plan.manualPackingEnabled)button(root,"Добавить КИЗ вручную",ready(),this::manualPackingKiz);
                }
                if("PICKING".equals(screenPhase())){
                    if(pickingChoices()){
                        text(root,pickingMode==FboPickingRoute.Mode.WHOLE_BOXES?"Сборка целых коробов":"Частичный отбор");
                        text(root,"В этом маршруте: "+pickingRoute().size()+" коробов · "+FboPickingRoute.quantity(pickingRoute())+" ед.");
                        if(pickingRoute().isEmpty())text(root,plan.picked==plan.needed?"Весь товар отобран. Можно завершить отбор.":"Нет коробов для выбранного отбора. Проверьте второй маршрут.");
                        button(root,"К выбору отбора",ready()&&state.barcode.isEmpty(),()->choosePickingMode(FboPickingRoute.Mode.MENU));
                    }
                    text(root,"Осталось отобрать "+(plan.needed-plan.picked));TsdFboPlan.Route r=source();
                    if(r!=null){card(root,r.boxCode+" · "+r.pallet+" · "+r.zone,Color.rgb(187,247,208));for(TsdFboPlan.Task t:r.tasks)text(root,"Отберите "+t.quantity+" ед. · "+t.displayLabel(t.name+" · "+t.barcode));
                        if(r.wholeBox&&"logoff".equals(BuildConfig.FLAVOR))card(root,(FboScanState.reusableBin(plan,r.boxCode)?"Отобрать весь товар, бокс остаётся на стеллаже · ":"Короб уезжает целиком · ")+r.wholeBoxQuantity+" ед.",Color.rgb(187,247,208));
                        if(r.recount)text(root,"Для целого короба требуется актуализация: количество и КИЗ расходятся.");
                        // FIX: picking and transferring the surplus are explicit choices, never automatic writes.
                        if(!pickingChoices()||pickingMode==FboPickingRoute.Mode.PARTIAL)button(root,"Отобрать товар по ШК + КИЗ",ready(),()->{state.barcode="";message="Сканируйте ШК нужного товара, затем КИЗ.";render();});
                        if(r.remainderQuantity>0&&moveRemainder!=null)button(root,"Переместить ненужный остаток ("+r.remainderQuantity+" ед.)",ready()&&state.barcode.isEmpty(),()->{if(!canLeave())return;close();moveRemainder.run();});
                        if(r.wholeBox&&(!pickingChoices()||!r.recount))button(root,FboScanState.wholePickTitle(plan,r.boxCode),ready()&&state.barcode.isEmpty(),this::confirmWholeBoxDialog);
                        button(root,"Другой исходный короб",ready(),()->{state.source="";state.barcode="";render();});
                    }else {
                        if(state.pallet.isEmpty()){
                            Map<String,Integer> pallets=new LinkedHashMap<>();for(TsdFboPlan.Route row:pickingRoute())if(!row.pallet.isEmpty())pallets.put(row.pallet,pallets.getOrDefault(row.pallet,0)+1);
                            for(Map.Entry<String,Integer> p:pallets.entrySet())text(root,p.getKey()+" · Нужных коробов: "+p.getValue());
                        }
                        for(TsdFboPlan.Route row:pickingRoute())if(row.pallet.equals(state.pallet)){card(root,(row.pallet.isEmpty()?"Без паллета":row.pallet)+" · "+row.zone+" → "+row.boxCode,Color.rgb(254,240,138));for(TsdFboPlan.Task t:row.tasks)text(root,t.displayLabel(t.name)+": "+t.quantity+" ед.");}
                    }
                    if(!state.pallet.isEmpty()){text(root,"Паллет "+state.pallet);button(root,"Другой паллет",ready(),()->{state.pallet="";state.source="";state.barcode="";render();});}
                    button(root,"Завершить отбор",ready()&&plan.picked==plan.needed,()->send("FINISH_PICK",null));
                }else if("PACKING".equals(screenPhase())){
                    text(root,"Осталось вложить "+(plan.needed-plan.packed));
                    if(!state.target.isEmpty()){text(root,"Открыт короб "+state.target);button(root,"Закрыть короб",ready(),()->send("CLOSE_BOX",null));}
                    for(TsdFboPlan.Box b:plan.boxes)if(b.code.equals(state.target)&&!b.closed&&b.quantity==0)button(root,"Отложить пустой короб",ready(),()->send("CANCEL_EMPTY_BOX",null));
                    if(!packingChoices()&&!plan.wholeBoxes.isEmpty())text(root,"Целые короба к добавлению: "+String.join(", ",plan.wholeBoxes));
                    if(packingChoices()){
                        String finish=packingMode==PackingMode.WHOLE_BOXES?"Завершить сканирование целых коробов":"Завершить формирование новых коробов";
                        button(root,finish,ready()&&state.target.isEmpty()&&state.barcode.isEmpty(),()->choosePackingMode(PackingMode.MENU));
                    }else packingCompleteButton(root);
                }else if("CONTROL".equals(screenPhase())){
                    int count=0;for(TsdFboPlan.Box b:plan.boxes)if(b.confirmed)count++;
                    text(root,"Подтверждено коробов "+count+" из "+plan.boxes.size());
                    if(packingChoices())text(root,"Осталось отсканировать: "+String.join(", ",unconfirmedBoxes()));
                    button(root,ozon()?"Завершить проверку направлений":packingChoices()?"Завершить проверку и сформировать файлы WB":"Завершить проверку и сформировать файл WB",ready()&&count==plan.boxes.size(),()->send("FINISH",null));
                }
                for(TsdFboPlan.Box b:plan.boxes)if(!packingChoices()||(!"PACKING".equals(plan.phase)&&!"PICKING".equals(plan.phase))||!b.wholeBox)text(root,b.code+(b.direction==null?"":" · "+b.direction)+" · "+b.quantity+" ед. · "+(b.confirmed?"Подтверждён":b.closed?"Закрыт":"Открыт"));
            }
        }
        if(state.pending()!=null){
            text(root,busy?"Отправка запроса…":"Подтверждение не получено. Запрос сохранён — повторное сканирование не требуется.");
            button(root,"Повторить отправку",!busy,()->send("",null));
        }
        if(routeStale)text(root,"Операция подтверждена. Ожидается обновление маршрута; повторный отбор не нужен.");
        button(root,"Обновить",state.pending()==null&&!busy,this::refresh);button(root,"Назад",canLeave(),()->{close();back.run();});
        ScrollView scroll=new ScrollView(activity);scroll.setFillViewport("logoff".equals(BuildConfig.FLAVOR));scroll.setBackgroundColor(screenColor);scroll.addView(root);activity.setContentView(scroll);if(input!=null&&ready())input.requestFocus();
        final EditText scanTarget=input;
        AssemblyAutoFocus.request(scanTarget,()->!closed&&input==scanTarget&&ready()&&quantityDialog==null);
        if(plan!=null)packingPrompt(packingVoice.step(packingVoiceActive(),ready(),state.target,state.barcode));
        if(packingErrorSpeech){packingErrorSpeech=false;if(packingChoices()&&scanFeedback!=null)scanFeedback.error("packing:"+message);}
        // FIX: scanner Enter may move focus after this render; focus the new KIZ field on the next UI turn.
        if("logoff".equals(BuildConfig.FLAVOR)&&input!=null&&ready()&&!state.barcode.isEmpty()){
            EditText kizInput=input;
            handler.post(()->{if(!closed&&input==kizInput&&ready()&&!state.barcode.isEmpty()&&quantityDialog==null)kizInput.requestFocus();});
        }
    }
    void submit(){if(quantityDialog!=null){confirmWholeBoxQuantity();return;}handler.removeCallbacks(automatic);if(!ready()||input==null||plan==null)return;String value=input.getText().toString().trim();if(value.isEmpty())return;input.setText("");message="";
        if("CONTROL".equals(screenPhase())){state.target=value;send("CONFIRM_BOX",null);return;}
        feedbackColor=Color.rgb(254,202,202);
        if(!FboScanState.phaseAllowed(packing,screenPhase()))return;
        if("PICKING".equals(screenPhase())&&state.source.isEmpty()){
            boolean accepted=state.scanLocation(pickingRoute(),value);
            feedbackColor=accepted?Color.rgb(187,247,208):Color.rgb(254,202,202);
            message=accepted?(state.source.isEmpty()?"Паллет найден":"Нужный короб"):"Короб или паллет не требуется для этой сборки.";
            if(!AssemblyScanVoice.isKiz(value))speakScan(accepted);if(accepted&&plan.localRouteEnabled){refresh();}else render();return;
        }
        if(pickingChoices()&&"PICKING".equals(screenPhase())&&pickingMode==FboPickingRoute.Mode.WHOLE_BOXES){
            message="Подтвердите отбор целого короба кнопкой ниже.";render();return;
        }
        if("PACKING".equals(screenPhase())&&state.target.isEmpty()){
            if(ozon()&&state.direction.isEmpty()){message="Выберите направление короба";render();return;}
            // FIX: mode selection is navigation only; never convert a wrong scan into the other action.
            if(FboScanState.alreadyPackedBox(plan,value,packingMode==PackingMode.MANUAL)){
                message="Данный короб уже упакован в поставку";packingErrorSpeech=true;render();return;
            }
            if(packingChoices()){
                if(packingMode==PackingMode.WHOLE_BOXES){
                    if(plan.wholeBoxes.contains(value)){state.source=value;send("PACK_BOX",null);}
                    else{message="Этот короб не ожидается среди целых коробов заявки.";packingErrorSpeech=true;render();}
                }else if(packingMode==PackingMode.NEW_BOXES||packingMode==PackingMode.MANUAL){
                    if(plan.wholeBoxes.contains(value)){message="Выберите «Отсканировать целые короба» для этого короба.";packingErrorSpeech=true;render();}
                    else{state.source="";state.target=value;send(packingMode==PackingMode.MANUAL?"MANUAL_OPEN_BOX":"OPEN_BOX",null);}
                }
                return;
            }
            if(plan.wholeBoxes.contains(value)){state.source=value;send("PACK_BOX",null);}
            else if(!plan.wholeBoxes.isEmpty()){message="Сначала отсканируйте целые короба.";packingErrorSpeech=true;feedbackColor=Color.rgb(254,202,202);render();}
            else{state.source="";state.target=value;send("OPEN_BOX",null);}return;
        }
        // FIX: manual packing accepts products outside the plan; the server validates KIZ ownership and stock.
        if(packingChoices()&&packingMode==PackingMode.MANUAL&&"PACKING".equals(screenPhase())){
            if(!state.barcode.isEmpty())send("MANUAL_PACK_UNIT",value);
            else if(AssemblyScanVoice.isKiz(value)){message="Сначала отсканируйте ШК товара.";packingErrorSpeech=true;render();}
            else{feedbackColor=Color.rgb(187,247,208);state.barcode=value;if(scanFeedback!=null)scanFeedback.success();message="Отсканируйте КИЗ товара.";render();}
            return;
        }
        if(manualPackingScan&&packingScanRecovery()){send("MANUAL_PACK_UNIT",value);return;}
        if(!state.barcode.isEmpty()){send("PICKING".equals(screenPhase())?"PICK_UNIT":"PACK_UNIT",value);return;}
        TsdFboPlan.Line line=null;for(TsdFboPlan.Line l:plan.lines)if(value.equals(l.barcode)&&("PICKING".equals(screenPhase())?l.remaining>0:l.picked>l.packed)){line=l;break;}
        if(line==null){if(!AssemblyScanVoice.isKiz(value))speakScan(false);message="Этот ШК не требуется на текущем этапе.";packingErrorSpeech=true;render();return;}
        // FIX: show the accepted product while waiting for its KIZ; a barcode alone is not a completed pick.
        feedbackColor=Color.rgb(187,247,208);message="Нужный товар";speakScan(true);
        state.barcode=value;if(scanFeedback!=null)scanFeedback.success();if(line.requiresKiz)render();else send("PICKING".equals(screenPhase())?"PICK_UNIT":"PACK_UNIT",null);
    }
    private void refresh(){if(busy||closed)return;busy=true;render();executor.execute(()->{try{Response<TsdFboPlan> res=api.getFboPlanAtLocation(session.authorizationHeader(),id,state.pallet,state.source).execute();if(!res.isSuccessful()||res.body()==null)throw new Exception(error(res));TsdFboPlan next=res.body();handler.post(()->{if(closed)return;plan=next;routeStale=false;if(state.pending()==null){String scanned=state.barcode,target=state.target;state.reconcile(plan,packing);reconcilePickingMode();if(packingMode==PackingMode.MANUAL&&!target.isEmpty()&&target.equals(state.target))state.barcode=scanned;}busy=false;render();});}catch(Exception e){handler.post(()->{if(closed)return;busy=false;if(!routeStale)message="Не удалось обновить: "+e.getMessage();render();});}});}
    private boolean fastConfirmation(){return "logoff".equals(BuildConfig.FLAVOR)&&((plan!=null&&plan.fastAcknowledgementSupported)||prefs.getBoolean(pendingKey+":fast",false));}
    // FIX: the compact receipt clears the durable request before any route recalculation.
    private boolean validReceipt(TsdFboAcknowledgement ack,Map<String,String> payload){return ack!=null&&ack.accepted&&id.equals(ack.requestId)
        &&payload.get("operationId").equals(ack.operationId)&&payload.get("action").equals(ack.action);}
    private void acceptReceipt(TsdFboAcknowledgement ack,Map<String,String> payload){
        if(closed||!validReceipt(ack,payload))return;
        Map<String,String> position=state.checkpoint();position.put("barcode","");
        if("OPEN_BOX".equals(payload.get("action"))||"MANUAL_OPEN_BOX".equals(payload.get("action")))position.put("targetBoxCode",payload.get("targetBoxCode"));
        if(!prefs.edit().remove(pendingKey).remove(pendingKey+":fast").putString(pendingKey+":position",new JSONObject(position).toString()).commit()){
            busy=false;message="Операция принята, но подтверждение не сохранилось на ТСД. Повторите отправку.";render();return;
        }
        state.accepted();if(scanFeedback!=null)scanFeedback.success();manualPackingScan=false;state.restoreCheckpoint(position);busy=false;routeStale=true;feedbackColor=Color.rgb(187,247,208);
        // FIX: compact absolute state enables the next scan without fetching the full route.
        boolean compact=FboPackingReceipt.apply(plan,ack.packing,packing,BuildConfig.FLAVOR);
        if(compact){routeStale=false;state.reconcile(plan,true);}
        message=FboFeedback.accepted(payload,plan);packingAccepted(payload);render();
        if(compact)return;
        if("FINISH".equals(payload.get("action"))&&!packingChoices())download();refresh();
    }
    private void sendAcknowledged(Map<String,String> payload){
        if(statusCheck!=null)handler.removeCallbacks(statusCheck);
        busy=true;message="";render();executor.execute(()->{try{
            Response<TsdFboAcknowledgement> res=api.acknowledgeFbo(session.authorizationHeader(),id,payload).execute();
            if(res.isSuccessful()&&validReceipt(res.body(),payload)){handler.post(()->acceptReceipt(res.body(),payload));return;}
            if(!res.isSuccessful()&&FboFeedback.definitiveRejection(res.code())&&res.code()!=404&&res.code()!=405){
                String detail=error(res);handler.post(()->{if(closed)return;busy=false;
                    if(prefs.edit().remove(pendingKey).remove(pendingKey+":fast").commit()){state.rejected();if("OPEN_BOX".equals(payload.get("action"))||"MANUAL_OPEN_BOX".equals(payload.get("action")))state.target="";}
                    message=detail;packingErrorSpeech=true;feedbackColor=Color.rgb(254,202,202);if(res.code()==409&&state.pending()==null&&!packingScanRecovery())refresh();else render();});return;
            }
        }catch(Exception e){android.util.Log.w("FboConfirmation","Acknowledgement unavailable: "+e.getClass().getSimpleName());}
            handler.post(()->{if(closed)return;busy=false;checkPending(0);});
        });
    }
    // FIX: bounded automatic checks are read-only; they never resubmit an unknown stock mutation.
    private void checkPending(int attempt){
        if(closed||busy||state.pending()==null)return;Map<String,String> payload=state.pending();busy=true;
        message="Проверяю результат отправленного запроса…";render();executor.execute(()->{
            TsdFboAcknowledgement receipt=null;
            try{Response<TsdFboAcknowledgement> res=api.fboOperationStatus(session.authorizationHeader(),id,payload).execute();if(res.isSuccessful()&&validReceipt(res.body(),payload))receipt=res.body();}
            catch(Exception e){android.util.Log.w("FboConfirmation","Status unavailable: "+e.getClass().getSimpleName());}
            TsdFboAcknowledgement result=receipt;handler.post(()->{if(closed)return;
                if(result!=null){acceptReceipt(result,payload);return;}
                busy=false;message="Подтверждение не получено. Запрос сохранён. Повторное сканирование не требуется.";render();
                if(attempt<2){statusCheck=()->{Map<String,String> current=state.pending();if(current!=null&&payload.get("operationId").equals(current.get("operationId")))checkPending(attempt+1);};handler.postDelayed(statusCheck,attempt==0?1500:3000);}
            });
        });
    }
    private void send(String action,String kiz){send(action,kiz,null);}
    private void send(String action,String kiz,Integer quantity){if(busy||closed)return;retrySending=state.pending()!=null;feedbackColor=Color.TRANSPARENT;Map<String,String> payload=state.prepare(action,kiz,quantity);
        // FIX: persist before sending, so a restart can retry the identical operation.
        boolean fast=fastConfirmation();
        if(!prefs.edit().putString(pendingKey,new JSONObject(payload).toString()).putBoolean(pendingKey+":fast",fast).commit()){message="Не удалось сохранить операцию. Проверьте память ТСД.";packingErrorSpeech=true;render();return;}
        if(fast){sendAcknowledged(payload);return;}
        busy=true;message="";render();executor.execute(()->{try{
            Response<TsdFboPlan> res=api.actFbo(session.authorizationHeader(),id,payload).execute();
            if(!res.isSuccessful()||res.body()==null){boolean rejected=FboFeedback.definitiveRejection(res.code());String detail=error(res);handler.post(()->{if(closed)return;if(rejected&&prefs.edit().remove(pendingKey).commit()){state.rejected();if("OPEN_BOX".equals(payload.get("action"))||"MANUAL_OPEN_BOX".equals(payload.get("action")))state.target="";}busy=false;feedbackColor=Color.rgb(254,202,202);message=detail;packingErrorSpeech=true;
                // FIX: a definitive stock/route conflict must not leave the picker on a stale box.
                if(res.code()==409&&rejected&&!packingScanRecovery())refresh();else render();});return;}
            TsdFboPlan next=res.body();handler.post(()->{if(closed)return;plan=next;busy=false;
                if(!prefs.edit().remove(pendingKey).commit()){message="Сервер принял операцию, но ТСД не сохранил подтверждение. Повторите отправку.";render();return;}
                state.accepted();if(scanFeedback!=null)scanFeedback.success();manualPackingScan=false;feedbackColor=Color.rgb(187,247,208);message=FboFeedback.accepted(payload,plan);
                if("OPEN_BOX".equals(payload.get("action"))||"MANUAL_OPEN_BOX".equals(payload.get("action")))state.target=payload.get("targetBoxCode");state.reconcile(plan,packing);reconcilePickingMode();packingAccepted(payload);
                // FIX: preserve confirmed state persistence before announcing closure.
                if(packingVoiceActive()&&"CLOSE_BOX".equals(payload.get("action")))packingPrompt(packingVoice.closed(payload.get("operationId")));
                if("FINISH".equals(payload.get("action"))&&!packingChoices())download();render();});
        }catch(Exception e){handler.post(()->{if(closed)return;busy=false;feedbackColor=Color.rgb(254,202,202);message="Подтверждение не получено. Нажмите «Повторить отправку».";packingErrorSpeech=true;render();});}});
    }
    // FIX: do not prefill a physical count or submit stock movements before confirmation.
    private void confirmWholeBoxDialog(){
        if(!ready()||source()==null)return;
        handler.removeCallbacks(automatic);
        quantityInput=new EditText(activity);quantityInput.setInputType(InputType.TYPE_CLASS_NUMBER);
        quantityInput.setSingleLine(true);quantityInput.setHint("Фактическое количество единиц");
        quantityDialog=new AlertDialog.Builder(activity).setTitle(FboScanState.wholePickTitle(plan,state.source))
            .setMessage("Введите количество единиц товара в коробе. По учёту: "+source().wholeBoxQuantity)
            .setView(quantityInput).setPositiveButton("Подтвердить",null).setNegativeButton("Отмена",null).create();
        quantityDialog.setOnDismissListener(d->{quantityDialog=null;quantityInput=null;if(!closed)render();});
        quantityDialog.show();quantityDialog.getButton(AlertDialog.BUTTON_POSITIVE).setOnClickListener(v->confirmWholeBoxQuantity());
        quantityInput.requestFocus();
        AssemblyAutoFocus.request(quantityInput,()->quantityDialog!=null&&quantityDialog.isShowing());
    }
    private void confirmWholeBoxQuantity(){
        if(quantityInput==null||!ready())return;
        int count;try{count=Integer.parseInt(quantityInput.getText().toString().trim());}catch(Exception e){quantityInput.setError("Введите целое положительное количество");return;}
        TsdFboPlan.Route route=source();
        if(count<1||route==null||count!=route.wholeBoxQuantity){quantityInput.setError("Количество не совпадает с учётом. Проверьте короб и обновите задание.");return;}
        quantityDialog.dismiss();send("PICK_BOX",null,count);
    }
    private String error(Response<?> response){try{if(response.errorBody()!=null){Object m=new JSONObject(response.errorBody().string()).opt("message");if(m!=null)return m.toString();}}catch(Exception ignored){}return "Ошибка ВМС "+response.code();}
    // FIX: an explicit list makes omitted boxes visible without changing confirmation counts.
    private List<String> unconfirmedBoxes(){List<String> result=new ArrayList<>();for(TsdFboPlan.Box b:plan.boxes)if(!b.confirmed)result.add(b.code);return result;}
    private void download(){download("packages");}
    private void download(String kind){if(ozon())return;try{DownloadManager manager=(DownloadManager)activity.getSystemService(Context.DOWNLOAD_SERVICE);String url=baseUrl.replaceAll("/+$","")+"/api/v1/tsd/requests/"+id+"/fbo/wb-"+kind+".xlsx";
        DownloadManager.Request req=new DownloadManager.Request(Uri.parse(url));req.addRequestHeader("Authorization",session.authorizationHeader());req.setTitle("products".equals(kind)?"Состав ФБО для WB":"Короба ФБО для WB");req.setNotificationVisibility(DownloadManager.Request.VISIBILITY_VISIBLE_NOTIFY_COMPLETED);req.setDestinationInExternalFilesDir(activity,Environment.DIRECTORY_DOWNLOADS,"wb-"+kind+"-"+id+"-"+System.currentTimeMillis()+".xlsx");manager.enqueue(req);message="Файл загружается. Откройте его из уведомления.";render();}catch(Exception e){message="Не удалось скачать файл: "+e.getMessage();render();}}
}
