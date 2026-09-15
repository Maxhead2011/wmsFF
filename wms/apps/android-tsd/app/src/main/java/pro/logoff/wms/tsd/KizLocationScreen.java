package pro.logoff.wms.tsd;

import android.app.Activity;
import android.graphics.Color;
import android.os.Handler;
import android.os.Looper;
import android.text.Editable;
import android.text.InputType;
import android.text.TextWatcher;
import android.view.KeyEvent;
import android.view.inputmethod.EditorInfo;
import android.widget.Button;
import android.widget.EditText;
import android.widget.LinearLayout;
import android.widget.ScrollView;
import android.widget.TextView;
import org.json.JSONObject;
import java.util.Collections;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import pro.logoff.wms.tsd.auth.TsdSession;
import pro.logoff.wms.tsd.network.TsdKizLocationResponse;
import pro.logoff.wms.tsd.network.WmsApi;
import retrofit2.Response;

// FIX: a separate read-only scanner screen; it never enters picking or inventory workflows.
final class KizLocationScreen {
    private final Activity activity;
    private final TsdSession session;
    private final WmsApi api;
    private final Handler handler = new Handler(Looper.getMainLooper());
    private final ExecutorService executor = Executors.newSingleThreadExecutor();
    private final EditText input;
    private final TextView result;
    private final Button check;
    private boolean closed, busy;
    private final Runnable autoSubmit = this::submit;

    KizLocationScreen(Activity activity, TsdSession session, WmsApi api, Runnable back) {
        this.activity = activity; this.session = session; this.api = api;
        LinearLayout root = new LinearLayout(activity); root.setOrientation(LinearLayout.VERTICAL);
        root.setPadding(24, 20, 24, 24); root.setBackgroundColor(Color.WHITE);
        TextView title = new TextView(activity); title.setText("Проверка КИЗ"); title.setTextSize(26); title.setTextColor(Color.BLACK); root.addView(title);
        TextView hint = new TextView(activity); hint.setText("Отсканируйте Честный знак. Размещение по данным выбранного филиала."); hint.setTextSize(17); root.addView(hint);
        input = new EditText(activity); input.setSingleLine(true); input.setHint("КИЗ Data Matrix");
        input.setInputType(InputType.TYPE_CLASS_TEXT | InputType.TYPE_TEXT_FLAG_NO_SUGGESTIONS);
        input.setImeOptions(EditorInfo.IME_ACTION_DONE); root.addView(input);
        check = new Button(activity); check.setText("Проверить"); check.setOnClickListener(v -> submit()); root.addView(check);
        result = new TextView(activity); result.setTextSize(20); result.setTextColor(Color.BLACK); result.setPadding(0, 20, 0, 20); root.addView(result);
        Button exit = new Button(activity); exit.setText("Назад"); exit.setOnClickListener(v -> { close(); back.run(); }); root.addView(exit);
        input.setOnEditorActionListener((v, action, event) -> {
            if (action == EditorInfo.IME_ACTION_DONE || action == EditorInfo.IME_ACTION_GO ||
                (event != null && event.getAction() == KeyEvent.ACTION_DOWN && event.getKeyCode() == KeyEvent.KEYCODE_ENTER)) { submit(); return true; }
            return false;
        });
        input.addTextChangedListener(new TextWatcher() {
            public void beforeTextChanged(CharSequence s, int start, int count, int after) {}
            public void onTextChanged(CharSequence s, int start, int before, int count) {}
            public void afterTextChanged(Editable value) {
                handler.removeCallbacks(autoSubmit);
                if (!busy && !closed && KizLocationPolicy.readyToSubmit(value.toString())) handler.postDelayed(autoSubmit, 400);
            }
        });
        ScrollView scroll = new ScrollView(activity); scroll.addView(root); activity.setContentView(scroll); input.requestFocus();
    }
    EditText scannerField() { return input; }
    boolean belongsTo(TsdSession current) { return session.hasSameAccessToken(current) && KizLocationPolicy.canOpen("logoff", current); }
    void close() { closed = true; handler.removeCallbacks(autoSubmit); executor.shutdownNow(); }
    void submit() {
        handler.removeCallbacks(autoSubmit);
        if (closed || busy) return;
        String scan = input.getText().toString().trim();
        if (scan.isEmpty()) { result.setText("Отсканируйте КИЗ."); return; }
        busy = true; check.setEnabled(false); input.setEnabled(false); result.setText("Проверяю КИЗ…");
        executor.execute(() -> {
            String message;
            try {
                Response<TsdKizLocationResponse> response = api.checkKizLocation(session.authorizationHeader(), Collections.singletonMap("kiz", scan)).execute();
                if (response.isSuccessful()) message = KizLocationPolicy.describe(response.body());
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
            handler.post(() -> {
                if (closed || activity.isDestroyed()) return;
                busy = false; check.setEnabled(true); input.setEnabled(true);
                result.setText(displayed); input.setText(""); input.requestFocus();
            });
        });
    }
}
