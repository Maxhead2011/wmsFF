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
    // FIX: asynchronous print completion refreshes only this active Lamoda screen.
    private final LamodaPrintRefresh lamodaPrintRefresh = new LamodaPrintRefresh(
        new LamodaPrintRefresh.Scheduler() {
            public void post(Runnable action,long delay){handler.postDelayed(action,delay);}
            public void cancel(Runnable action){handler.removeCallbacks(action);}
        }, this::canRefreshLamodaPrint, this::refresh);
    private boolean canRefreshLamodaPrint(){
        return ready()&&!closed&&quantityDialog==null&&state.barcode.isEmpty()
            &&(input==null||input.getText().length()==0);
    }
    private boolean manualPackingScan,packingErrorSpeech;
    // FIX: isolate explicit packing modes to our application; sold flavors retain their flow.
    private enum PackingMode { MENU, NEW_BOXES, WHOLE_BOXES, MANUAL }
    private PackingMode packingMode=PackingMode.MENU;
    // FIX: our picker chooses a remaining route; packaging, quantities and the server phase stay shared.
    private FboPickingRoute.Mode pickingMode=FboPickingRoute.Mode.MENU;
    private boolean unboxedPicking(){return plan!=null&&plan.unboxedPickingSupported&&"logoff".equals(BuildConfig.FLAVOR);}
    private boolean pickingChoices(){return !packing&&!unboxedPicking()&&"logoff".equals(BuildConfig.FLAVOR);}
    private List<TsdFboPlan.Route> pickingRoute(){return pickingChoices()?FboPickingRoute.select(plan,pickingMode,state.source,state.pallet):plan.route;}
    // FIX: a server-approved remainder can be taken whole without leaving partial picking.
    private boolean showWholePicking(TsdFboPlan.Route row){return !pickingChoices()||pickingMode==FboPickingRoute.Mode.WHOLE_BOXES||pickingMode==FboPickingRoute.Mode.PARTIAL||FboScanState.reusableBin(plan,row.boxCode);}
    private boolean partialWholePicking(){return pickingChoices()&&pickingMode==FboPickingRoute.Mode.PARTIAL;}
    private String wholePickingTitle(){return partialWholePicking()&&!FboScanState.reusableBin(plan,state.source)?"Забрать остаток короба целиком":FboScanState.wholePickTitle(plan,state.source);}
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
    private boolean yandex(){return plan!=null&&"YANDEX_MARKET".equals(plan.marketplace);}
    private boolean ozon(){return plan!=null&&"OZON".equals(plan.marketplace);}
    // FIX: Lamoda has destination quotas but must never offer WB export.
    private boolean lamoda(){return plan!=null&&"LAMODA".equals(plan.marketplace);}
    private boolean directed(){return ozon()||lamoda();}
    private boolean productAvailable(){return packing&&directed()&&"logoff".equals(BuildConfig.FLAVOR)&&plan.packingByProductSupported;}
    private boolean productActive(){return productAvailable()&&state.productMode&&"PACKING".equals(screenPhase());}
    private TsdFboPlan.PackingSuggestion productSuggestion(){
        if(plan.packingSuggestions==null||plan.lines==null)return null;
        for(TsdFboPlan.Line l:plan.lines)if(FboScanState.matches(plan,l,state.barcode))
            for(TsdFboPlan.PackingSuggestion s:plan.packingSuggestions)if(l.skuId!=null&&l.skuId.equals(s.skuId))return s;
        return null;
    }
    private void chooseProductMode(boolean enabled){
        if(!ready()||!state.barcode.isEmpty())return;
        handler.removeCallbacks(automatic);state.productMode=enabled;state.productReady=false;state.productKiz="";
        state.target="";state.direction="";message="";render();
    }
    // FIX: no packing mutation before the destination box is physically scanned.
    private void scanProduct(String value){
        if(state.barcode.isEmpty()){
            TsdFboPlan.Line found=null;for(TsdFboPlan.Line l:plan.lines)if(FboScanState.matches(plan,l,value)&&l.picked>l.packed){found=l;break;}
            if(found==null){message="Этот ШК не ожидает упаковки.";render();return;}
            state.barcode=value;state.productKiz="";state.productReady=!found.requiresKiz;state.target="";
        }else if(!state.productReady){
            if(!AssemblyScanVoice.isKiz(value)){message="Отсканируйте КИЗ товара.";render();return;}
            state.productKiz=value;state.productReady=true;
        }else{
            TsdFboPlan.PackingSuggestion suggestion=productSuggestion();
            if(suggestion==null){message="Нет направления для этого товара. Обновите заявку.";render();return;}
            if(suggestion.targetBoxCode!=null&&!suggestion.targetBoxCode.equals(value)){
                message="Сканируйте короб "+suggestion.targetBoxCode+" · "+suggestion.direction;render();return;
            }
            for(TsdFboPlan.Box box:plan.boxes)if(value.equals(box.code)&&(box.closed||box.wholeBox||!suggestion.direction.equals(box.direction))){
                message="Короб закрыт или относится к другому направлению.";render();return;
            }
            if(!value.matches("(?i)^FFL[\\w-]{1,96}$")){message="Отсканируйте ШК короба FFL.";render();return;}
            state.direction=suggestion.direction;state.target=value;send("PACK_PRODUCT",state.productKiz);return;
        }
        TsdFboPlan.PackingSuggestion suggestion=productSuggestion();
        if(suggestion!=null)state.direction=suggestion.direction;
        message=suggestion==null?"Нет направления для этого товара. Обновите заявку.":state.productReady?"Подтвердите вложение сканированием короба.":"Отсканируйте КИЗ товара.";
        feedbackColor=Color.rgb(187,247,208);render();
    }
    private void productInstructions(LinearLayout root){
        text(root,"Упаковка по товару");
        if(!state.barcode.isEmpty()){
            text(root,"ШК: "+state.barcode);
            if(state.productReady){
                TsdFboPlan.PackingSuggestion s=productSuggestion();
                if(s!=null)card(root,s.direction+" · "+(s.targetBoxCode==null?"Сканируйте новый пустой короб": "Сканируйте короб "+s.targetBoxCode),Color.rgb(254,240,138));
                else text(root,"Нет направления для этого товара. Обновите заявку.");
            }
            button(root,"Отложить товар",ready(),()->{state.barcode="";state.productReady=false;state.productKiz="";state.target="";message="";render();});
        }else{
            for(TsdFboPlan.Box box:plan.boxes)if(!box.closed&&!box.wholeBox&&box.quantity>0)
                button(root,"Закрыть "+box.code+" · "+box.direction,ready(),()->{state.target=box.code;state.direction=box.direction;send("CLOSE_BOX",null);});
            packingCompleteButton(root);
        }
    }
    // FIX: unknown results must be resolved before cancelling either a scan or an accepted unit.
    private boolean undoAvailable(){return packing&&plan!=null&&plan.packingUndoSupported&&"logoff".equals(BuildConfig.FLAVOR)&&"PACKING".equals(screenPhase());}
    private boolean undoReady(){
        if(!undoAvailable()||!ready())return false;
        if(!state.barcode.isEmpty())return true;
        for(TsdFboPlan.Box b:plan.boxes)if(b.code.equals(state.lastPackingBox)&&!b.closed&&!b.wholeBox&&b.quantity>0)return !state.lastPackingOperation.isEmpty();
        return false;
    }
    private void undoLastUnit(){
        if(!undoReady())return;
        handler.removeCallbacks(automatic);
        if(!state.barcode.isEmpty()){
            state.barcode="";state.productReady=false;state.productKiz="";manualPackingScan=false;
            message="Скан отменён. Товар не вложен.";render();return;
        }
        String expectedOperation=state.lastPackingOperation;
        new AlertDialog.Builder(activity).setTitle("Отменить последнюю единицу?")
            .setMessage("Достаньте 1 шт. товара "+state.lastPackingBarcode+" из короба "+state.lastPackingBox+" и верните к отобранному товару.")
            .setNegativeButton("Назад",null).setPositiveButton("Подтвердить отмену",(d,w)->{if(undoReady()&&state.barcode.isEmpty()&&expectedOperation.equals(state.lastPackingOperation))send("UNDO_PACK_UNIT",null);}).show();
    }
    private boolean packingChoices(){return !directed()&&packing&&"logoff".equals(BuildConfig.FLAVOR);}
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
            // FIX: a pending whole-remainder operation retains its saved partial-picking mode.
            if("PICK_BOX".equals(action)&&pickingMode!=FboPickingRoute.Mode.PARTIAL)pickingMode=FboPickingRoute.Mode.WHOLE_BOXES;
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
    void close(){closed=true;lamodaPrintRefresh.close();if(scanFeedback!=null)scanFeedback.close();if(quantityDialog!=null)quantityDialog.dismiss();handler.removeCallbacks(automatic);if(statusCheck!=null)handler.removeCallbacks(statusCheck);executor.shutdownNow();}
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
    private Button compactUndo,compactSubmit,compactClose,compactCancel,compactManual,compactEmpty,compactModes,compactRefresh,compactRetry,compactBack;
    private TextView compactLabel(){TextView v=new TsdUi.Label(activity);v.setTextSize(22);v.setPadding(0,12,0,12);compactRoot.addView(v);return v;}
    private Button compactButton(String title,Runnable action){Button b=new TsdUi.Button(activity);b.setText(title);b.setAllCaps(false);b.setOnClickListener(v->action.run());compactRoot.addView(b);return b;}
    // FIX: retain the actual scan field while only status labels and enabled states change.
    private boolean renderCompactPacking(){
        if(!packingChoices()||plan==null||!plan.compactPackingSupported||!"PACKING".equals(screenPhase())||
            !(packingMode==PackingMode.NEW_BOXES||packingMode==PackingMode.MANUAL)){compactRoot=null;return false;}
        if(compactRoot==null){
            compactRoot=new LinearLayout(activity);compactRoot.setOrientation(LinearLayout.VERTICAL);compactRoot.setPadding(24,20,24,24);
            compactLabel().setText("Упаковка FBO · "+plan.title+("logoff".equals(BuildConfig.FLAVOR)&&!FboStoreContext.label(plan).isEmpty()?"\n"+FboStoreContext.label(plan):""));
            compactProgress=compactLabel();compactTarget=compactLabel();compactMessage=compactLabel();compactHint=compactLabel();
            input=new EditText(activity);input.setSingleLine(true);input.setTextSize(24);compactRoot.addView(input);
            input.setOnEditorActionListener((v,a,e)->{submit();return true;});
            input.addTextChangedListener(new TextWatcher(){public void beforeTextChanged(CharSequence s,int a,int c,int f){}public void onTextChanged(CharSequence s,int a,int b,int c){}public void afterTextChanged(Editable s){handler.removeCallbacks(automatic);if(ready()&&s.length()>0)handler.postDelayed(automatic,350);}});
            compactSubmit=compactButton("Подтвердить скан",this::submit);
            compactUndo=compactButton("Отменить последнюю единицу",this::undoLastUnit);
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
        compactUndo.setVisibility(undoAvailable()?android.view.View.VISIBLE:android.view.View.GONE);compactUndo.setEnabled(undoReady());
        compactCancel.setVisibility(state.barcode.isEmpty()?android.view.View.GONE:android.view.View.VISIBLE);compactCancel.setEnabled(ready());
        compactManual.setVisibility(plan.manualPackingEnabled&&!state.barcode.isEmpty()?android.view.View.VISIBLE:android.view.View.GONE);compactManual.setEnabled(ready());
        compactClose.setEnabled(ready()&&target!=null&&!target.closed&&target.quantity>0&&state.barcode.isEmpty());
        compactEmpty.setEnabled(ready()&&target!=null&&!target.closed&&target.quantity==0&&state.barcode.isEmpty());
        compactModes.setEnabled(ready()&&state.barcode.isEmpty());compactRefresh.setEnabled(!busy&&state.pending()==null);compactBack.setEnabled(!busy&&state.pending()==null);
        compactRetry.setVisibility(state.pending()==null?android.view.View.GONE:android.view.View.VISIBLE);compactRetry.setEnabled(!busy&&state.pending()!=null);
        if(ready())input.requestFocus();
        // FIX: compact packing also restores KIZ focus after the scanner's trailing Enter.
        EditText scanTarget=input;
        AssemblyAutoFocus.request(scanTarget,()->!closed&&compactRoot!=null&&input==scanTarget&&ready()&&quantityDialog==null);
        packingPrompt(packingVoice.step(packingVoiceActive(),ready(),state.target,state.barcode));
        return true;
    }

    // FIX: loose stock has no box route; show demand from the server before the scan field.
    private void unboxedPickingContents(LinearLayout root) {
        if(!unboxedPicking()||packing||!"PICKING".equals(screenPhase())||plan.lines==null)return;
        boolean heading=false;
        for(TsdFboPlan.Line line:plan.lines)if(line.remaining>0){
            if(!heading){text(root,"Товары к отбору");heading=true;}
            card(root,line.displayLabel()+"\nНужно: "+line.needed+" · Отобрано: "+line.picked+
                " · Осталось: "+line.remaining,Color.rgb(241,245,249));
        }
    }

    // FIX: show only the selected destination; no additional stock requests or local counting.
    private void directionContents(LinearLayout root) {
        if(!"logoff".equals(BuildConfig.FLAVOR)||!packing||!"PACKING".equals(screenPhase()))return;
        for(TsdFboPlan.Direction d:plan.directions) {
            if(!d.name.equals(state.direction))continue;
            text(root,"Состав направления · "+d.name+" · упаковано "+d.packed+" из "+d.needed);
            if(d.items==null){text(root,"Состав направления недоступен. Обновите заявку.");return;}
            for(TsdFboPlan.DirectionItem item:d.items) {
                TsdFboPlan.Line line=null;
                if(plan.lines!=null)for(TsdFboPlan.Line candidate:plan.lines)
                    if(item.skuId!=null&&item.skuId.equals(candidate.skuId)){line=candidate;break;}
                String name=line==null||line.name==null||line.name.isEmpty()?"Товар":line.name;
                String size=line==null||line.size==null||line.size.isEmpty()?"—":line.size;
                card(root,"ШК: "+(item.barcode==null?"—":item.barcode)+"\n"+name+" · Размер: "+size+
                    "\nКоличество: "+item.quantity+" · упаковано "+item.packed+" из "+item.quantity+
                    " · осталось "+Math.max(0,item.quantity-item.packed),
                    item.packed>=item.quantity?Color.rgb(187,247,208):Color.rgb(241,245,249));
            }
            return;
        }
    }

    private void render(){
        if(closed||activity.isDestroyed())return;
        // FIX: a packing checkpoint must not block reopened picking; unanswered commands stay intact.
        if(!packing&&"logoff".equals(BuildConfig.FLAVOR)&&state.productMode&&state.pending()==null){
            state.productMode=false;state.productReady=false;state.productKiz="";
            state.barcode="";state.target="";state.direction="";
        }
        if(productActive()&&state.pending()==null){TsdFboPlan.PackingSuggestion suggestion=productSuggestion();if(suggestion!=null)state.direction=suggestion.direction;}
        if(pickingChoices())prefs.edit().putString(pendingKey+":picking-mode",pickingMode.name()).commit();
        prefs.edit().putString(pendingKey+":position",new JSONObject(state.checkpoint()).toString()).commit();
        if(renderCompactPacking())return;
        LinearLayout root=new LinearLayout(activity);root.setOrientation(LinearLayout.VERTICAL);root.setPadding(24,20,24,24);int screenColor=AssemblyScreenFeedback.background("logoff".equals(BuildConfig.FLAVOR),retrySending&&busy&&state.pending()!=null,packingErrorSpeech?Color.rgb(254,202,202):feedbackColor);root.setBackgroundColor(screenColor);
        text(root,yandex()?(packing?"Упаковка Яндекс FBY":"Сборка Яндекс FBY"):packing?"Упаковка FBO":lamoda()?"FBO Lamoda":ozon()?"FBO Ozon":"FBO WB");if(!message.isEmpty())card(root,message,feedbackColor);
        if("logoff".equals(BuildConfig.FLAVOR)&&retrySending&&busy&&state.pending()!=null)text(root,"Повторная отправка запроса");
        input=null;
        if(packingChoices()&&packingMode==PackingMode.MENU&&!state.target.isEmpty())packingMode=PackingMode.NEW_BOXES;
        if(plan!=null){text(root,plan.title);
            if ("logoff".equals(BuildConfig.FLAVOR) && !FboStoreContext.label(plan).isEmpty()) text(root,FboStoreContext.label(plan));text(root,"Этап: "+FboFeedback.phase(screenPhase()));
            renderLamodaRelabel(root);
            text(root,"Отобрано "+plan.picked+" из "+plan.needed+" · Упаковано "+plan.packed+" из "+plan.needed);
            text(root,"Проверено коробов "+FboFeedback.confirmed(plan)+" из "+plan.boxes.size());
            if(directed()&&plan.directions!=null){
                if(productAvailable()&&"PACKING".equals(screenPhase())){
                    button(root,"По направлению",ready()&&state.barcode.isEmpty()&&state.productMode,()->chooseProductMode(false));
                    button(root,"По товару",ready()&&state.barcode.isEmpty()&&!state.productMode,()->chooseProductMode(true));
                }
                text(root,"Одна сборка · "+plan.directions.size()+" направлений");
                for(TsdFboPlan.Direction d:plan.directions){
                    if(productActive()&&!d.name.equals(state.direction))continue;
                    String label=d.name+" · упаковано "+d.packed+" из "+d.needed;
                    if("PACKING".equals(screenPhase())&&state.target.isEmpty()&&!productActive())button(root,label,ready(),()->{state.direction=d.name;render();});
                    else text(root,label);
                }
                text(root,"Направление короба: "+state.direction);
                if(packing&&state.productMode&&!productAvailable()&&"logoff".equals(BuildConfig.FLAVOR)){
                    text(root,"Упаковка по товару сейчас недоступна. Сохранённый товар не вложен.");
                    button(root,"Отложить товар и вернуться к направлениям",ready(),()->{state.barcode="";state.productKiz="";state.productReady=false;chooseProductMode(false);});
                }
                // FIX: explicit Ozon top-up keeps ordinary barcode/KIZ packing and destination checks.
                if(packing&&"logoff".equals(BuildConfig.FLAVOR)&&plan.reopenPackingBoxSupported&&"PACKING".equals(screenPhase())&&state.target.isEmpty()&&state.barcode.isEmpty()){
                    for(TsdFboPlan.Box box:plan.boxes)if(box.closed&&!box.wholeBox){
                        button(root,"Добавить в закрытый короб · "+box.code+" · "+box.direction,ready(),()->{
                            new AlertDialog.Builder(activity).setTitle("Открыть короб для догруза?")
                                .setMessage(box.code+" · "+box.direction+"\nПосле добавления товара закройте и проверьте короб снова.")
                                .setNegativeButton("Отмена",null).setPositiveButton("Открыть",(dialog,which)->{
                                    if(!ready())return;
                                    state.productMode=false;state.productReady=false;state.productKiz="";
                                    state.direction=box.direction;state.target=box.code;state.source="";
                                    send("REOPEN_BOX",null);
                                }).show();
                        });
                    }
                }
                if(!productActive())directionContents(root);
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
                if(yandex()){text(root,"Сборка FBY проверена");}else if(directed()){text(root,"Все направления собраны");}else if(packingChoices()){
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
                unboxedPickingContents(root);
                String hint="ШК товара";
                if("CONTROL".equals(screenPhase()))hint=ozonLabelControl()&&!state.target.isEmpty()?"ШК наклеенного стикера Ozon":"ШК короба поставки";
                else if("PICKING".equals(screenPhase())&&state.source.isEmpty()&&!unboxedPicking())hint=state.pallet.isEmpty()?"ШК паллета / короба без паллета":"ШК короба на выбранном паллете";
                else if("PACKING".equals(screenPhase())&&state.target.isEmpty())hint=packingChoices()
                    ?(packingMode==PackingMode.WHOLE_BOXES?"ШК целого короба":packingMode==PackingMode.MANUAL&&plan.reusablePackingEnabled?"ШК нового или закрытого короба для дополнения":"ШК короба для упаковки")
                    :plan.wholeBoxes.isEmpty()?"ШК короба для упаковки / целого короба":"Сначала отсканируйте целые короба.";
                else if(!state.barcode.isEmpty())hint="КИЗ товара";
                if(pickingChoices()&&"PICKING".equals(screenPhase())&&pickingMode==FboPickingRoute.Mode.WHOLE_BOXES&&!state.source.isEmpty())hint="Подтвердите отбор целого короба кнопкой ниже";
                if(productActive())hint=state.barcode.isEmpty()?"ШК товара":!state.productReady?"КИЗ товара":"ШК короба указанного направления";
                text(root,hint);input=new EditText(activity);input.setSingleLine(true);TsdUi.hint(input,hint);input.setEnabled(ready());root.addView(input);
                input.setOnEditorActionListener((v,a,e)->{submit();return true;});
                input.addTextChangedListener(new TextWatcher(){public void beforeTextChanged(CharSequence s,int a,int c,int f){}public void onTextChanged(CharSequence s,int a,int b,int c){}public void afterTextChanged(Editable s){handler.removeCallbacks(automatic);if(ready()&&s.length()>0)handler.postDelayed(automatic,350);}});
                button(root,"Подтвердить скан",ready(),this::submit);
                if(undoAvailable())button(root,"Отменить последнюю единицу",undoReady(),this::undoLastUnit);
                if(productActive()){productInstructions(root);}
                else if(packingScanRecovery()){
                    button(root,"Отменить скан",ready(),this::cancelPackingScan);
                    if(plan.manualPackingEnabled)button(root,"Добавить КИЗ вручную",ready(),this::manualPackingKiz);
                }
                if("PICKING".equals(screenPhase())){
                    if(unboxedPicking())text(root,"Хранение без коробов. Сканируйте ШК товара. Осталось отобрать: "+(plan.needed-plan.picked));
                    if(pickingChoices()){
                        text(root,pickingMode==FboPickingRoute.Mode.WHOLE_BOXES?"Сборка целых коробов":"Частичный отбор");
                        text(root,"В этом маршруте: "+pickingRoute().size()+" коробов · "+FboPickingRoute.quantity(pickingRoute())+" ед.");
                        if(pickingRoute().isEmpty())text(root,plan.picked==plan.needed?"Весь товар отобран. Можно завершить отбор.":"Нет коробов для выбранного отбора. Проверьте второй маршрут.");
                        button(root,"К выбору отбора",ready()&&state.barcode.isEmpty(),()->choosePickingMode(FboPickingRoute.Mode.MENU));
                    }
                    text(root,"Осталось отобрать "+(plan.needed-plan.picked));TsdFboPlan.Route r=source();
                    if(r!=null){card(root,r.boxCode+" · "+r.pallet+" · "+r.zone,Color.rgb(187,247,208));for(TsdFboPlan.Task t:r.tasks)text(root,"Отберите "+t.quantity+" ед. · "+t.displayLabel(t.name+" · "+t.barcode));
                        if(r.wholeBox&&showWholePicking(r)&&"logoff".equals(BuildConfig.FLAVOR))card(root,(FboScanState.reusableBin(plan,r.boxCode)?"Отобрать весь товар, бокс остаётся на стеллаже · ":"Короб уезжает целиком · ")+r.wholeBoxQuantity+" ед.",Color.rgb(187,247,208));
                        if(r.recount)text(root,"Для целого короба требуется актуализация: количество и КИЗ расходятся.");
                        // FIX: picking and transferring the surplus are explicit choices, never automatic writes.
                        if(!pickingChoices()||pickingMode==FboPickingRoute.Mode.PARTIAL)button(root,"Отобрать товар по ШК + КИЗ",ready(),()->{state.barcode="";message="Сканируйте ШК нужного товара, затем КИЗ.";render();});
                        if(r.remainderQuantity>0&&moveRemainder!=null)button(root,"Переместить ненужный остаток ("+r.remainderQuantity+" ед.)",ready()&&state.barcode.isEmpty(),()->{if(!canLeave())return;close();moveRemainder.run();});
                        if(r.wholeBox&&showWholePicking(r)&&(!pickingChoices()||!r.recount))button(root,wholePickingTitle(),ready()&&state.barcode.isEmpty(),this::confirmWholeBoxDialog);
                        if (plan.missingStockReportingSupported && "logoff".equals(BuildConfig.FLAVOR) && "PICKING".equals(screenPhase())) {
                            button(root,"Товар в коробе не найден",ready(),this::reportMissing);
                        }
                        button(root,"Другой исходный короб",ready(),()->{state.source="";state.barcode="";render();});
                    }else {
                        if(plan.missingStockReportingSupported && !state.pallet.isEmpty() && "logoff".equals(BuildConfig.FLAVOR)){
                            button(root,"Нет короба на палет-сорте",ready(),this::reportMissingBox);
                        }
                        if(state.pallet.isEmpty()){
                            Map<String,Integer> pallets=new LinkedHashMap<>();for(TsdFboPlan.Route row:pickingRoute())if(!row.pallet.isEmpty())pallets.put(row.pallet,pallets.getOrDefault(row.pallet,0)+1);
                            for(Map.Entry<String,Integer> p:pallets.entrySet())text(root,p.getKey()+" · Нужных коробов: "+p.getValue());
                        }
                        for(TsdFboPlan.Route row:pickingRoute())if(row.pallet.equals(state.pallet)){card(root,(row.pallet.isEmpty()?"Без паллета":row.pallet)+" · "+row.zone+" → "+row.boxCode,Color.rgb(254,240,138));for(TsdFboPlan.Task t:row.tasks)text(root,t.displayLabel(t.name)+": "+t.quantity+" ед.");}
                    }
                    if(!state.pallet.isEmpty()){text(root,"Паллет "+state.pallet);button(root,"Другой паллет",ready(),()->{state.pallet="";state.source="";state.barcode="";render();});}
                    button(root,"Завершить отбор",ready()&&plan.picked==plan.needed,()->send("FINISH_PICK",null));
                }else if("PACKING".equals(screenPhase())&&!productActive()){
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
                    if(ozonLabelControl()){text(root,"После упаковки передайте грузоместа в Ozon и распечатайте стикеры. Проверка: наш короб → наклеенный стикер Ozon.");if(!state.target.isEmpty()){text(root,"Проверяем короб "+state.target);button(root,"Сканировать другой короб",ready(),()->{state.target="";state.barcode="";render();});}}
                    text(root,"Подтверждено коробов "+count+" из "+plan.boxes.size());
                    if(packingChoices())text(root,"Осталось отсканировать: "+String.join(", ",unconfirmedBoxes()));
                    button(root,yandex()?"Завершить проверку FBY":directed()?"Завершить проверку направлений":packingChoices()?"Завершить проверку и сформировать файлы WB":"Завершить проверку и сформировать файл WB",ready()&&count==plan.boxes.size(),()->send("FINISH",null));
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
    private boolean ozonLabelControl(){return "logoff".equals(BuildConfig.FLAVOR)&&plan!=null&&plan.ozonLabelControlRequired;}
    void submit(){if(quantityDialog!=null){confirmWholeBoxQuantity();return;}handler.removeCallbacks(automatic);if(!ready()||input==null||plan==null)return;String value=input.getText().toString().trim();if(value.isEmpty())return;input.setText("");message="";
        if("CONTROL".equals(screenPhase())){
            if(ozonLabelControl()){
                if(state.target.isEmpty()){
                    for(TsdFboPlan.Box b:plan.boxes)if(value.equals(b.code)&&b.closed&&!b.confirmed){state.target=value;state.barcode="";message="Наклейте стикер Ozon на короб и сканируйте его штрихкод.";render();return;}
                    message="Сканируйте наш неподтверждённый короб этой заявки.";render();return;
                }
                state.barcode=value;send("CONFIRM_BOX",null);return;
            }
            state.target=value;send("CONFIRM_BOX",null);return;
        }
        feedbackColor=Color.rgb(254,202,202);
        if(!FboScanState.phaseAllowed(packing,screenPhase()))return;
        if("PICKING".equals(screenPhase())&&state.source.isEmpty()&&!unboxedPicking()){
            boolean accepted=state.scanLocation(pickingRoute(),value);
            // FIX: like FBS, validate a different physical source instead of treating the route as an allow-list.
            if(!accepted&&checkAlternativeLocation(value))return;
            feedbackColor=accepted?Color.rgb(187,247,208):Color.rgb(254,202,202);
            message=accepted?(state.source.isEmpty()?"Паллет найден":"Нужный короб"):"Короб или паллет не требуется для этой сборки.";
            if(!AssemblyScanVoice.isKiz(value))speakScan(accepted);if(accepted&&plan.localRouteEnabled){refresh();}else render();return;
        }
        if(pickingChoices()&&"PICKING".equals(screenPhase())&&pickingMode==FboPickingRoute.Mode.WHOLE_BOXES){
            message="Подтвердите отбор целого короба кнопкой ниже.";render();return;
        }
        if(packing&&state.productMode&&ozon()&&"logoff".equals(BuildConfig.FLAVOR)&&!productAvailable()){
            message="Упаковка по товару недоступна. Отложите товар или обновите заявку.";render();return;
        }
        if(productActive()){scanProduct(value);return;}
        if("PACKING".equals(screenPhase())&&state.target.isEmpty()){
            if(directed()&&state.direction.isEmpty()){message="Выберите направление короба";render();return;}
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
            else{feedbackColor=Color.rgb(187,247,208);state.barcode=value;if(scanFeedback!=null)scanFeedback.success();if(unmarkedLine(value,true)){send("PACK_UNIT",null);}else{message="Отсканируйте КИЗ товара.";render();}}
            return;
        }
        if(manualPackingScan&&packingScanRecovery()){send("MANUAL_PACK_UNIT",value);return;}
        // FIX: reject a wrong/completed destination at barcode scan, before KIZ or mutation.
        if(packing&&directed()&&"logoff".equals(BuildConfig.FLAVOR)&&"PACKING".equals(screenPhase())){
            String rejected=FboScanState.packingDirectionError(plan,state.target,state.barcode.isEmpty()?value:state.barcode);
            if(rejected!=null){state.barcode="";message=rejected;packingErrorSpeech=true;speakScan(false);render();return;}
        }
        if(!state.barcode.isEmpty()){send("PICKING".equals(screenPhase())?"PICK_UNIT":"PACK_UNIT",value);return;}
        TsdFboPlan.Line line=null;for(TsdFboPlan.Line l:plan.lines)if(FboScanState.matches(plan,l,value)&&("PICKING".equals(screenPhase())?l.remaining>0:l.picked>l.packed)){line=l;break;}
        if(line==null){if(!AssemblyScanVoice.isKiz(value))speakScan(false);message="Этот ШК не требуется на текущем этапе.";packingErrorSpeech=true;render();return;}
        // FIX: show the accepted product while waiting for its KIZ; a barcode alone is not a completed pick.
        feedbackColor=Color.rgb(187,247,208);message="Нужный товар";speakScan(true);
        state.barcode=value;if(scanFeedback!=null)scanFeedback.success();if(line.requiresKiz)render();else send("PICKING".equals(screenPhase())?"PICK_UNIT":"PACK_UNIT",null);
    }
    // FIX: only a unique known unmarked SKU can skip KIZ; server validates the picked unit.
    private boolean unmarkedLine(String barcode,boolean needsPacking){
        if(!"logoff".equals(BuildConfig.FLAVOR)||plan==null||plan.lines==null)return false;
        TsdFboPlan.Line match=null;
        for(TsdFboPlan.Line line:plan.lines)if(FboScanState.matches(plan,line,barcode)){
            if(match!=null||line.requiresKiz)return false;
            match=line;
        }
        return match!=null&&(!needsPacking||match.picked>match.packed);
    }
    // FIX: clear only definitively rejected unmarked picks, never uncertain durable commands.
    private void rejectConfirmedScan(Map<String,String> payload){
        state.rejected();
        if("PICK_UNIT".equals(payload.get("action"))&&unmarkedLine(payload.get("barcode"),false)){
            state.barcode="";state.productKiz="";state.productReady=false;
        }
    }
    // FIX: keep scanner state unchanged until the scoped server route confirms the alternative.
    private boolean checkAlternativeLocation(String value){
        String kind=FboScanState.alternativeLocationKind(plan,value);
        if(kind.isEmpty()||packing||!ready()||!state.source.isEmpty())return false;
        final String code=value.toUpperCase(java.util.Locale.ROOT);
        final String pallet=kind.equals("pallet")?code:state.pallet;
        final String box=kind.equals("box")?code:"";
        busy=true;message="Проверяю доступность…";render();
        executor.execute(()->{try{
            Response<TsdFboPlan> response=api.getFboPlanAtLocation(session.authorizationHeader(),id,pallet,box).execute();
            if(!response.isSuccessful()||response.body()==null)throw new Exception(error(response));
            TsdFboPlan next=response.body();
            handler.post(()->{
                if(closed)return;busy=false;
                if(!next.alternativePickingSupported||!"PICKING".equals(next.phase)||next.compositionChanged){
                    message="Заявка изменилась. Обновите задание.";routeStale=true;render();return;
                }
                plan=next;
                // A new pallet is a navigation choice. A box still requires its physical pallet scan.
                FboScanState checked=new FboScanState();checked.pallet=kind.equals("pallet")?"":state.pallet;
                boolean accepted=checked.scanLocation(pickingRoute(),code);
                state.reconcile(plan,packing);
                if(accepted){state.pallet=checked.pallet;state.source=checked.source;message=kind.equals("pallet")?"Паллет найден":"Нужный короб";}
                else {
                    message="Нет доступного товара для оставшегося отбора. Проверьте паллет, остаток и ограничения.";
                    if(kind.equals("box"))for(TsdFboPlan.Route row:plan.route)if(code.equalsIgnoreCase(row.boxCode)){
                        if(!row.pallet.equals(checked.pallet))message="Сначала отсканируйте паллет "+row.pallet+", затем этот короб.";
                        else message="Короб доступен в другом режиме отбора. Выберите "+(FboPickingRoute.whole(plan,row)?"«Сборка целых коробов».":"«Частичный отбор».");
                    }
                }
                feedbackColor=accepted?Color.rgb(187,247,208):Color.rgb(254,202,202);speakScan(accepted);render();
            });
        }catch(Exception e){handler.post(()->{if(closed)return;busy=false;message="Не удалось проверить короб или паллет: "+e.getMessage();feedbackColor=Color.rgb(254,202,202);render();});}});
        return true;
    }
    private void refresh(){if(busy||closed)return;busy=true;render();executor.execute(()->{try{Response<TsdFboPlan> res=api.getFboPlanAtLocation(session.authorizationHeader(),id,state.pallet,state.source).execute();if(!res.isSuccessful()||res.body()==null)throw new Exception(error(res));TsdFboPlan next=res.body();handler.post(()->{if(closed)return;plan=next;routeStale=false;if(state.pending()==null){String scanned=state.barcode,target=state.target;state.reconcile(plan,packing);
                // FIX: migrate stale unmarked picking checkpoints left by older APKs; pending commands are excluded above.
                if("PICKING".equals(screenPhase())&&!state.barcode.isEmpty()&&unmarkedLine(state.barcode,false)){state.barcode="";state.productKiz="";state.productReady=false;}
                reconcilePickingMode();if(packingMode==PackingMode.MANUAL&&!target.isEmpty()&&target.equals(state.target))state.barcode=scanned;}busy=false;lamodaPrintRefresh.observe(plan,BuildConfig.FLAVOR);render();});}catch(Exception e){handler.post(()->{if(closed)return;busy=false;if(!routeStale)message="Не удалось обновить: "+e.getMessage();lamodaPrintRefresh.failed();render();});}});}
    private boolean fastConfirmation(){return "logoff".equals(BuildConfig.FLAVOR)&&((plan!=null&&plan.fastAcknowledgementSupported)||prefs.getBoolean(pendingKey+":fast",false));}
    // FIX: the compact receipt clears the durable request before any route recalculation.
    private boolean validReceipt(TsdFboAcknowledgement ack,Map<String,String> payload){return ack!=null&&ack.accepted&&id.equals(ack.requestId)
        &&payload.get("operationId").equals(ack.operationId)&&payload.get("action").equals(ack.action);}
    private boolean openReportedBoxAfterConfirmation(Map<String,String> payload){
        if("REPORT_MISSING_BOX".equals(payload.get("action")))state.source="";
        if(!"REPORT_MISSING".equals(payload.get("action"))||!(activity instanceof MainActivity))return false;
        ((MainActivity)activity).openReportedFboBox(id+":"+payload.get("operationId"),payload.get("sourceBoxCode"));
        return true;
    }
    private void acceptReceipt(TsdFboAcknowledgement ack,Map<String,String> payload){
        if(closed||!validReceipt(ack,payload))return;
        Map<String,String> position=state.confirmedPosition(payload);
        if("REOPEN_BOX".equals(payload.get("action"))||"OPEN_BOX".equals(payload.get("action"))||"MANUAL_OPEN_BOX".equals(payload.get("action")))position.put("targetBoxCode",payload.get("targetBoxCode"));
        if(!prefs.edit().remove(pendingKey).remove(pendingKey+":fast").putString(pendingKey+":position",new JSONObject(position).toString()).commit()){
            busy=false;message="Операция принята, но подтверждение не сохранилось на ТСД. Повторите отправку.";render();return;
        }
        state.accepted();if(scanFeedback!=null)scanFeedback.success();manualPackingScan=false;state.restoreCheckpoint(position);busy=false;routeStale=true;feedbackColor=Color.rgb(187,247,208);
        if(openReportedBoxAfterConfirmation(payload))return;
        // FIX: compact absolute state enables the next scan without fetching the full route.
        boolean compact=FboPackingReceipt.apply(plan,ack.packing,packing,BuildConfig.FLAVOR);
        if(compact){routeStale=false;state.reconcile(plan,true);}
        message="UNDO_PACK_UNIT".equals(payload.get("action"))?"Последняя единица отменена. Возвращена в отобранные.":FboFeedback.accepted(payload,plan);
                if("PACK_PRODUCT".equals(payload.get("action")))message="Упаковано: 1 шт. · "+payload.get("direction")+" · "+payload.get("targetBoxCode");packingAccepted(payload);render();
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
                    if(prefs.edit().remove(pendingKey).remove(pendingKey+":fast").commit()){rejectConfirmedScan(payload);if("REOPEN_BOX".equals(payload.get("action"))||"OPEN_BOX".equals(payload.get("action"))||"MANUAL_OPEN_BOX".equals(payload.get("action")))state.target="";}
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
    // FIX: choose a product from the scanned box and explicitly confirm the missing quantity.
    private void reportMissingBox(){
        java.util.ArrayList<String> codes=new java.util.ArrayList<>();
        for(TsdFboPlan.Route row:pickingRoute())if(state.pallet.equals(row.pallet))codes.add(row.boxCode);
        new AlertDialog.Builder(activity).setTitle("Какого короба нет на "+state.pallet+"?").setItems(codes.toArray(new String[0]),(dialog,index)->{
            String box=codes.get(index);
            new AlertDialog.Builder(activity).setTitle("Нет короба "+box+" на "+state.pallet+"?")
                .setNegativeButton("Отмена",null).setPositiveButton("Сообщить администраторам",(d,w)->{
                    state.source=box;send("REPORT_MISSING_BOX",null);
                }).show();
        }).show();
    }

    private void reportMissing(){
        for(TsdFboPlan.Route box:plan.route){
            if(!state.source.equals(box.boxCode)||box.tasks==null)continue;
            String[] labels=new String[box.tasks.size()];
            for(int i=0;i<labels.length;i++)labels[i]=box.tasks.get(i).name+" · "+box.tasks.get(i).barcode;
            new AlertDialog.Builder(activity).setTitle("Какой товар не найден?").setItems(labels,(dialog,index)->{
                TsdFboPlan.Task task=box.tasks.get(index);
                android.widget.EditText count=new android.widget.EditText(activity);
                count.setInputType(android.text.InputType.TYPE_CLASS_NUMBER);count.setText("1");count.selectAll();
                new AlertDialog.Builder(activity).setTitle("Не найдено в "+box.boxCode+" (до "+task.quantity+")").setView(count)
                    .setNegativeButton("Отмена",null).setPositiveButton("Отправить на пересчёт",(d,w)->{
                        int n;try{n=Integer.parseInt(count.getText().toString());}catch(NumberFormatException e){n=0;}
                        if(n<1||n>task.quantity){message="Проверьте количество";render();return;}
                        state.barcode=task.barcode;send("REPORT_MISSING",null,n);
                    }).show();
            }).show();return;
        }
    }

    private void send(String action,String kiz){send(action,kiz,null);}
    private String relabelUnitId="";
    // FIX: only LOGOFF and an explicit server capability expose the replacement-label step.
    private void renderLamodaRelabel(LinearLayout root){
        if(!"logoff".equals(BuildConfig.FLAVOR)||!plan.relabelRequired||plan.relabelUnits==null)return;
        text(root,"Переклейка Lamoda: ожидает проверки "+plan.relabelUnits.size()+" шт.");
        button(root,"Сканировать товар для переклейки",ready()&&!plan.relabelUnits.isEmpty(),()->scanLamodaSource());
        for(TsdFboPlan.RelabelUnit unit:plan.relabelUnits){
            if(!unit.id.equals(relabelUnitId)||unit.label==null)continue;
            text(root,unit.label.name+" · размер "+unit.label.size+" · ШК Lamoda "+unit.label.barcode);
            if("PRINTED".equals(unit.printStatus))button(root,"Сканировать новую этикетку",ready(),()->confirmLamodaRelabel(unit));
            else if(unit.printStatus==null||"FAILED".equals(unit.printStatus))button(root,"Печать 2 этикеток 58 × 40",ready(),()->chooseLamodaPrinter(unit));
            else text(root,"Этикетка в очереди. Проверяем завершение печати автоматически…");
        }
    }
    // FIX: warehouse barcode and physical KIZ resolve the unit on the scoped server.
    private void scanLamodaSource(){
        LinearLayout form=new LinearLayout(activity);form.setOrientation(LinearLayout.VERTICAL);
        EditText source=new EditText(activity);source.setSingleLine(true);source.setHint("Сканируйте складской ШК");form.addView(source);
        EditText mark=new EditText(activity);mark.setSingleLine(true);mark.setHint("КИЗ, если товар маркирован");form.addView(mark);
        AlertDialog dialog=new AlertDialog.Builder(activity).setTitle("Товар для переклейки Lamoda").setView(form).setNegativeButton("Назад",null).setPositiveButton("Найти соответствие",null).create();
        quantityDialog=dialog;dialog.setOnDismissListener(d->{quantityDialog=null;});
        dialog.setOnShowListener(d->{source.requestFocus();dialog.getButton(AlertDialog.BUTTON_POSITIVE).setOnClickListener(v->{
            if(source.getText().toString().trim().isEmpty()){source.setError("Сканируйте ШК");return;}
            Map<String,String> body=new LinkedHashMap<>();body.put("barcode",source.getText().toString().trim());
            if(!mark.getText().toString().trim().isEmpty())body.put("kiz",mark.getText().toString().trim());
            dialog.dismiss();busy=true;relabelUnitId="";render();
            executor.execute(()->{try{Response<TsdFboPlan.RelabelUnit> response=api.lamodaFboRelabelResolve(session.authorizationHeader(),id,body).execute();
                if(!response.isSuccessful()||response.body()==null)throw new Exception(error(response));
                handler.post(()->{if(closed)return;busy=false;relabelUnitId=response.body().id;message="Соответствие Lamoda найдено. Проверьте товар и размер.";refresh();});
            }catch(Exception e){handler.post(()->{if(closed)return;busy=false;message=e.getMessage();render();});}});
        });});dialog.show();
    }
    private void chooseLamodaPrinter(TsdFboPlan.RelabelUnit unit){
        if(!ready())return;busy=true;render();executor.execute(()->{try{
            Response<List<TsdPrintStation>> response=api.lamodaFboRelabelStations(session.authorizationHeader(),id).execute();
            if(!response.isSuccessful()||response.body()==null)throw new Exception(error(response));
            List<TsdPrintStation> stations=response.body();handler.post(()->{if(closed)return;busy=false;render();
                if(stations.isEmpty()){message="Нет станций печати на связи. Запустите агент печати.";render();return;}
                String[] names=new String[stations.size()];for(int i=0;i<names.length;i++)names[i]=stations.get(i).name;
                AlertDialog chooser=new AlertDialog.Builder(activity).setTitle("Станция переклейки Lamoda").setItems(names,(d,n)->printLamodaUnit(unit,stations.get(n).id)).setNegativeButton("Назад",null).create();
                quantityDialog=chooser;chooser.setOnDismissListener(d->{quantityDialog=null;});chooser.show();
            });
        }catch(Exception e){handler.post(()->{if(closed)return;busy=false;message=e.getMessage();render();});}});
    }
    private void printLamodaUnit(TsdFboPlan.RelabelUnit unit,String station){
        if(!ready())return;busy=true;render();Map<String,String> body=new LinkedHashMap<>();body.put("unitId",unit.id);body.put("stationId",station);body.put("printId",UUID.randomUUID().toString());
        executor.execute(()->{try{Response<TsdRelabelPrintJob> response=api.lamodaFboRelabelPrint(session.authorizationHeader(),id,body).execute();
            if(!response.isSuccessful()||response.body()==null)throw new Exception(error(response));
            handler.post(()->{if(closed)return;busy=false;message="Печать отправлена. Ожидаем этикетки; следующий шаг появится автоматически.";refresh();});
        }catch(Exception e){handler.post(()->{if(closed)return;busy=false;message="Проверяем состояние отправленной печати: "+e.getMessage();refresh();});}});
    }
    private void confirmLamodaRelabel(TsdFboPlan.RelabelUnit unit){
        if(!ready())return;
        LinearLayout form=new LinearLayout(activity);form.setOrientation(LinearLayout.VERTICAL);
        EditText barcode=new EditText(activity);barcode.setSingleLine(true);barcode.setHint("Сканируйте новую этикетку Lamoda");form.addView(barcode);
        EditText mark=new EditText(activity);mark.setSingleLine(true);mark.setHint("Сканируйте КИЗ этой единицы");
        boolean marked=unit.kiz!=null&&!unit.kiz.isEmpty();if(marked)form.addView(mark);
        AlertDialog dialog=new AlertDialog.Builder(activity).setTitle(unit.label.name+" · размер "+unit.label.size).setView(form).setNegativeButton("Назад",null).setPositiveButton("Подтвердить",null).create();
        quantityDialog=dialog;
        dialog.setOnDismissListener(d->{quantityDialog=null;});
        dialog.setOnShowListener(d->{barcode.requestFocus();dialog.getButton(AlertDialog.BUTTON_POSITIVE).setOnClickListener(v->{
            if(!unit.label.barcode.equals(barcode.getText().toString().trim())){barcode.setError("Неверный ШК Lamoda");return;}
            if(marked&&mark.getText().toString().trim().isEmpty()){mark.setError("Сканируйте КИЗ");return;}
            if(!ready())return;relabelUnitId=unit.id;state.barcode=barcode.getText().toString().trim();dialog.dismiss();send("RELABEL_UNIT",marked?mark.getText().toString():null);
        });});dialog.show();
    }
    private void send(String action,String kiz,Integer quantity){if(busy||closed)return;retrySending=state.pending()!=null;feedbackColor=Color.TRANSPARENT;Map<String,String> payload=state.prepare(action,kiz,quantity);
        if("REPORT_MISSING".equals(action)&&!retrySending){payload.put("missingQuantity",String.valueOf(quantity));payload.remove("confirmedQuantity");state.restore(payload);}
        if("RELABEL_UNIT".equals(payload.get("action"))&&!retrySending){payload.put("relabelUnitId",relabelUnitId);state.restore(payload);}
        // FIX: persist before sending, so a restart can retry the identical operation.
        boolean fast=!"RELABEL_UNIT".equals(payload.get("action"))&&!"PACK_PRODUCT".equals(payload.get("action"))&&!"UNDO_PACK_UNIT".equals(payload.get("action"))&&fastConfirmation();
        if(!prefs.edit().putString(pendingKey,new JSONObject(payload).toString()).putBoolean(pendingKey+":fast",fast).commit()){message="Не удалось сохранить операцию. Проверьте память ТСД.";packingErrorSpeech=true;render();return;}
        if(fast){sendAcknowledged(payload);return;}
        busy=true;message="";render();executor.execute(()->{try{
            Response<TsdFboPlan> res=api.actFbo(session.authorizationHeader(),id,payload).execute();
            if(!res.isSuccessful()||res.body()==null){boolean rejected=FboFeedback.definitiveRejection(res.code());String detail=error(res);handler.post(()->{if(closed)return;if(rejected&&prefs.edit().remove(pendingKey).commit()){rejectConfirmedScan(payload);if("REOPEN_BOX".equals(payload.get("action"))||"OPEN_BOX".equals(payload.get("action"))||"MANUAL_OPEN_BOX".equals(payload.get("action")))state.target="";}busy=false;feedbackColor=Color.rgb(254,202,202);message=detail;packingErrorSpeech=true;
                // FIX: a definitive stock/route conflict must not leave the picker on a stale box.
                if(res.code()==409&&rejected&&!packingScanRecovery())refresh();else render();});return;}
            TsdFboPlan next=res.body();handler.post(()->{if(closed)return;plan=next;busy=false;lamodaPrintRefresh.observe(plan,BuildConfig.FLAVOR);
                // FIX: clear the held product and durable command in one preferences commit.
                SharedPreferences.Editor confirmation=prefs.edit().remove(pendingKey);
                Map<String,String> position=state.confirmedPosition(payload);
                confirmation.putString(pendingKey+":position",new JSONObject(position).toString());
                if(!confirmation.commit()){message="Сервер принял операцию, но ТСД не сохранил подтверждение. Повторите отправку.";render();return;}
                state.accepted();state.restoreCheckpoint(position);
                if(openReportedBoxAfterConfirmation(payload))return;
                if(scanFeedback!=null)scanFeedback.success();manualPackingScan=false;feedbackColor=Color.rgb(187,247,208);message="UNDO_PACK_UNIT".equals(payload.get("action"))?"Последняя единица отменена. Возвращена в отобранные.":FboFeedback.accepted(payload,plan);
                if("PACK_PRODUCT".equals(payload.get("action")))message="Упаковано: 1 шт. · "+payload.get("direction")+" · "+payload.get("targetBoxCode");
                if("REOPEN_BOX".equals(payload.get("action"))||"OPEN_BOX".equals(payload.get("action"))||"MANUAL_OPEN_BOX".equals(payload.get("action")))state.target=payload.get("targetBoxCode");state.reconcile(plan,packing);reconcilePickingMode();packingAccepted(payload);
                // FIX: preserve confirmed state persistence before announcing closure.
                if(packingVoiceActive()&&"CLOSE_BOX".equals(payload.get("action")))packingPrompt(packingVoice.closed(payload.get("operationId")));
                if("FINISH".equals(payload.get("action"))&&!packingChoices())download();render();});
        }catch(Exception e){handler.post(()->{if(closed)return;busy=false;feedbackColor=Color.rgb(254,202,202);message="Подтверждение не получено. Нажмите «Повторить отправку».";packingErrorSpeech=true;render();});}});
    }
    // FIX: do not prefill a physical count or submit stock movements before confirmation.
    private void confirmWholeBoxDialog(){
        if(!ready()||source()==null)return;
        // FIX: never turn an unfinished unit scan or a reclassified source into a whole-box write.
        if(pickingChoices()&&(!state.barcode.isEmpty()||!source().wholeBox||source().recount))return;
        handler.removeCallbacks(automatic);
        quantityInput=new EditText(activity);quantityInput.setInputType(InputType.TYPE_CLASS_NUMBER);
        quantityInput.setSingleLine(true);quantityInput.setHint("Фактическое количество единиц");
        quantityDialog=new AlertDialog.Builder(activity).setTitle(wholePickingTitle())
            .setMessage(partialWholePicking()?"Введите количество, оставшееся физически в коробе. По учёту: "+source().wholeBoxQuantity+". Уже отобранные поштучно единицы сюда не включайте — они упаковываются отдельно.":"Введите количество единиц товара в коробе. По учёту: "+source().wholeBoxQuantity)
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
        if(pickingChoices()&&(route==null||!route.wholeBox||route.recount||!state.barcode.isEmpty())){quantityInput.setError("Обновите задание и завершите сканирование товара.");return;}
        if(count<1||route==null||count!=route.wholeBoxQuantity){quantityInput.setError("Количество не совпадает с учётом. Проверьте короб и обновите задание.");return;}
        quantityDialog.dismiss();send("PICK_BOX",null,count);
    }
    private String error(Response<?> response){try{if(response.errorBody()!=null){Object m=new JSONObject(response.errorBody().string()).opt("message");if(m!=null)return m.toString();}}catch(Exception ignored){}return "Ошибка ВМС "+response.code();}
    // FIX: an explicit list makes omitted boxes visible without changing confirmation counts.
    private List<String> unconfirmedBoxes(){List<String> result=new ArrayList<>();for(TsdFboPlan.Box b:plan.boxes)if(!b.confirmed)result.add(b.code);return result;}
    private void download(){download("packages");}
    private void download(String kind){if(directed())return;try{DownloadManager manager=(DownloadManager)activity.getSystemService(Context.DOWNLOAD_SERVICE);String url=baseUrl.replaceAll("/+$","")+"/api/v1/tsd/requests/"+id+"/fbo/wb-"+kind+".xlsx";
        DownloadManager.Request req=new DownloadManager.Request(Uri.parse(url));req.addRequestHeader("Authorization",session.authorizationHeader());req.setTitle("products".equals(kind)?"Состав ФБО для WB":"Короба ФБО для WB");req.setNotificationVisibility(DownloadManager.Request.VISIBILITY_VISIBLE_NOTIFY_COMPLETED);req.setDestinationInExternalFilesDir(activity,Environment.DIRECTORY_DOWNLOADS,"wb-"+kind+"-"+id+"-"+System.currentTimeMillis()+".xlsx");manager.enqueue(req);message="Файл загружается. Откройте его из уведомления.";render();}catch(Exception e){message="Не удалось скачать файл: "+e.getMessage();render();}}
}
