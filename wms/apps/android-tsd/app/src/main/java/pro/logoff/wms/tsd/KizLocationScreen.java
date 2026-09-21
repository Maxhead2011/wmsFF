package pro.logoff.wms.tsd;

import android.app.Activity;
import android.app.AlertDialog;
import android.graphics.Color;
import android.os.Handler;
import android.os.Looper;
import android.text.Editable;
import android.text.InputType;
import android.text.TextWatcher;
import android.view.KeyEvent;
import android.view.inputmethod.EditorInfo;
import android.widget.Button;
import android.widget.CheckBox;
import android.widget.EditText;
import android.widget.LinearLayout;
import android.widget.ScrollView;
import android.widget.TextView;
import org.json.JSONObject;
import java.util.Collections;
import java.util.HashMap;
import java.util.Map;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import pro.logoff.wms.tsd.auth.TsdSession;
import pro.logoff.wms.tsd.network.TsdKizLocationResponse;
import pro.logoff.wms.tsd.network.WmsApi;
import retrofit2.Response;

// FIX: administrator decisions use the same case and audit workflow as desktop WMS.
final class KizLocationScreen {
    private final Activity activity;
    private final TsdSession session;
    private final WmsApi api;
    private final Handler handler = new Handler(Looper.getMainLooper());
    private final ExecutorService executor = Executors.newSingleThreadExecutor();
    private final EditText input;
    private final TextView result;
    private final Button check;
    private final LinearLayout decisions;
    private TsdKizLocationResponse lastResponse;
    private AlertDialog decisionDialog;
    private boolean closed, busy;
    private final Runnable autoSubmit = this::submit;

    KizLocationScreen(Activity activity, TsdSession session, WmsApi api, Runnable back) {
        this.activity = activity; this.session = session; this.api = api;
        LinearLayout root = new LinearLayout(activity); root.setOrientation(LinearLayout.VERTICAL);
        root.setPadding(24, 20, 24, 24); root.setBackgroundColor(Color.WHITE);
        TextView title = new TsdUi.Label(activity); title.setText("Проверка КИЗ"); title.setTextSize(26); title.setTextColor(Color.BLACK); root.addView(title);
        TextView hint = new TsdUi.Label(activity); hint.setText("Отсканируйте Честный знак. Размещение по данным выбранного филиала."); hint.setTextSize(17); root.addView(hint);
        input = new EditText(activity); input.setSingleLine(true); TsdUi.hint(input,"КИЗ Data Matrix");
        input.setInputType(InputType.TYPE_CLASS_TEXT | InputType.TYPE_TEXT_FLAG_NO_SUGGESTIONS);
        input.setImeOptions(EditorInfo.IME_ACTION_DONE); root.addView(input);
        check = new TsdUi.Button(activity); check.setText("Проверить"); check.setOnClickListener(v -> submit()); root.addView(check);
        result = new TsdUi.Label(activity); result.setTextSize(20); result.setTextColor(Color.BLACK); result.setPadding(0, 20, 0, 20); root.addView(result);
        decisions = new LinearLayout(activity); decisions.setOrientation(LinearLayout.VERTICAL); root.addView(decisions);
        Button exit = new TsdUi.Button(activity); exit.setText("Назад"); exit.setOnClickListener(v -> { close(); back.run(); }); root.addView(exit);
        input.setOnEditorActionListener((v, action, event) -> {
            if (action == EditorInfo.IME_ACTION_DONE || action == EditorInfo.IME_ACTION_GO ||
                (event != null && event.getAction() == KeyEvent.ACTION_DOWN && event.getKeyCode() == KeyEvent.KEYCODE_ENTER)) { submit(); return true; }
            return false;
        });
        input.addTextChangedListener(new TextWatcher() {
            public void beforeTextChanged(CharSequence s, int start, int count, int after) {}
            public void onTextChanged(CharSequence s, int start, int before, int count) {}
            public void afterTextChanged(Editable value) {
                if (!busy && value.length()>0) { lastResponse=null; decisions.removeAllViews(); }
                handler.removeCallbacks(autoSubmit);
                if (!busy && !closed && KizLocationPolicy.readyToSubmit(value.toString())) handler.postDelayed(autoSubmit, 400);
            }
        });
        ScrollView scroll = new ScrollView(activity); scroll.addView(root); activity.setContentView(scroll); input.requestFocus();
    }
    EditText scannerField() { return input; }
    boolean belongsTo(TsdSession current) { return session.hasSameAccessToken(current) && KizLocationPolicy.canOpen("logoff", current); }
    void close() { closed = true; handler.removeCallbacks(autoSubmit); if(decisionDialog!=null)decisionDialog.dismiss(); executor.shutdownNow(); }
    void submit() {
        handler.removeCallbacks(autoSubmit);
        if (closed || busy) return;
        String scan = input.getText().toString().trim();
        if (scan.isEmpty()) { result.setText("Отсканируйте КИЗ."); return; }
        busy = true; check.setEnabled(false); input.setEnabled(false); result.setText("Проверяю КИЗ…");
        lastResponse=null; decisions.removeAllViews();
        executor.execute(() -> {
            String message;
            TsdKizLocationResponse body=null;
            try {
                Response<TsdKizLocationResponse> response = api.checkKizLocation(session.authorizationHeader(), Collections.singletonMap("kiz", scan)).execute();
                if (response.isSuccessful()) { body=response.body(); message = KizLocationPolicy.describe(body); }
                else {
                    message = "Не удалось проверить КИЗ. Повторите попытку.";
                    if (response.errorBody() != null) {
                        JSONObject error = new JSONObject(response.errorBody().string());
                        Object detail = error.opt("message");
                        if (detail instanceof String) message = (String) detail;
                    }
                }
            } catch (Exception error) { message = "Нет ответа от ВМС. Проверьте соединение и повторите сканирование."; }
            String displayed = message;
            TsdKizLocationResponse received=body;
            handler.post(() -> {
                if (closed || activity.isDestroyed()) return;
                busy = false; check.setEnabled(true); input.setEnabled(true);
                result.setText(displayed); input.setText(""); input.requestFocus();
                lastResponse=received; renderDecisions();
            });
        });
    }
    private void renderDecisions() {
        decisions.removeAllViews();
        if(lastResponse==null||lastResponse.reviews==null)return;
        if(lastResponse.reviews.isEmpty()&&lastResponse.found){
            TextView hint=new TsdUi.Label(activity);hint.setText("Для решения нужна одна однозначно найденная единица в выбранном филиале. Проверьте размещение и дубли КИЗа.");decisions.addView(hint);
            for(String caption:new String[]{"Разрешить использовать","Разрешить переклейку"}){
                Button button=new TsdUi.Button(activity);button.setText(caption);button.setEnabled(false);decisions.addView(button);
            }
        }
        for(TsdKizLocationResponse.Review row:lastResponse.reviews){
            TextView title=new TsdUi.Label(activity);
            title.setText("UNIT".equals(row.scope)?"Разрешение по КИЗу для следующего отбора\n"+(row.snapshot==null?"":row.snapshot.productName+" · "+row.snapshot.boxCode):row.snapshot==null?"Обращение сборщика":"Заявка №"+row.snapshot.requestNumber+" · WB "+row.snapshot.orderId+"\n"+row.snapshot.workerName+" · "+row.snapshot.boxCode);
            decisions.addView(title);
            if("APPROVED".equals(row.status)||"CLAIMED".equals(row.status)){TextView approved=new TsdUi.Label(activity);approved.setText("Разрешено: "+("RELABEL".equals(row.resolution)?"КИЗ НЕОБХОДИМО ЗАМЕНИТЬ":"использование")+" · "+row.decidedByName);decisions.addView(approved);}
            for(String mode:new String[]{"REUSE","RELABEL"}){
                Button button=new TsdUi.Button(activity);button.setText("REUSE".equals(mode)?"Разрешить использовать":"Разрешить переклейку");
                button.setEnabled(!busy&&KizReviewPolicy.canDecide(BuildConfig.FLAVOR,session,row,mode));
                button.setOnClickListener(v->confirmDecision(row,mode));decisions.addView(button);
            }
        }
    }
    private void confirmDecision(TsdKizLocationResponse.Review row,String mode) {
        if(closed||busy||!KizReviewPolicy.canDecide(BuildConfig.FLAVOR,session,row,mode))return;
        handler.removeCallbacks(autoSubmit);input.setEnabled(false);check.setEnabled(false);
        LinearLayout form=new LinearLayout(activity);form.setOrientation(LinearLayout.VERTICAL);form.setPadding(24,12,24,12);
        TextView code=new TsdUi.Label(activity);code.setText(row.kizIdentity);form.addView(code);
        EditText reason=new EditText(activity);TsdUi.hint(reason,"Основание решения (не менее 5 символов)");form.addView(reason);
        CheckBox confirmed=new CheckBox(activity);confirmed.setText("REUSE".equals(mode)?
            "Проверено: единица на складе, КИЗ не погашен и допускает повторное использование.":
            "Единица физически на складе. Разрешаю заменить её КИЗ без пересчёта всего короба.");form.addView(confirmed);
        TextView error=new TsdUi.Label(activity);form.addView(error);
        AlertDialog dialog=new AlertDialog.Builder(activity).setTitle("REUSE".equals(mode)?"Разрешить использовать":"Разрешить переклейку")
            .setView(form).setPositiveButton("Подтвердить",null).setNegativeButton("Отмена",null).create();
        decisionDialog=dialog;
        dialog.setOnDismissListener(d->{decisionDialog=null;if(!closed&&!busy){input.setEnabled(true);check.setEnabled(true);}});
        dialog.setOnShowListener(d->dialog.getButton(AlertDialog.BUTTON_POSITIVE).setOnClickListener(v->{
            String why=reason.getText().toString().trim();
            if(busy)return;
            if(!confirmed.isChecked()||why.length()<5||why.length()>1000){error.setText("Подтвердите проверку и укажите основание (5–1000 символов).");return;}
            busy=true;renderDecisions();dialog.setCancelable(false);dialog.getButton(AlertDialog.BUTTON_POSITIVE).setEnabled(false);dialog.getButton(AlertDialog.BUTTON_NEGATIVE).setEnabled(false);
            Map<String,Object> payload=new HashMap<>();payload.put("resolution",mode);payload.put("reason",why);payload.put("confirmed",true);
            executor.execute(()->{
                String problem=null;
                try{Response<Map<String,Object>> response=api.decideKizReview(session.authorizationHeader(),row.id,payload).execute();
                    if(!response.isSuccessful()){problem="Решение не сохранено. Повторите отправку.";if(response.errorBody()!=null){Object detail=new JSONObject(response.errorBody().string()).opt("message");if(detail instanceof String)problem=(String)detail;}}
                }catch(Exception e){problem="Подтверждение не получено. Повторите отправку этой кнопкой.";}
                String failure=problem;
                handler.post(()->{if(closed||activity.isDestroyed())return;busy=false;dialog.setCancelable(true);
                    dialog.getButton(AlertDialog.BUTTON_POSITIVE).setEnabled(true);dialog.getButton(AlertDialog.BUTTON_NEGATIVE).setEnabled(true);
                    if(failure==null){row.status="APPROVED";row.resolution=mode;row.decidedByName="администратор";dialog.dismiss();result.setText("Решение сохранено для следующего отбора этой единицы. "+("RELABEL".equals(mode)?"КИЗ НЕОБХОДИМО ЗАМЕНИТЬ":"Сборщик может повторить сканирование исходного КИЗа."));}
                    else error.setText(failure);
                    renderDecisions();
                });
            });
        }));
        dialog.show();
    }
}
