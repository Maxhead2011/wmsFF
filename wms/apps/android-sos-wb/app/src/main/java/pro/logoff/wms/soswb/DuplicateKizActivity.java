package pro.logoff.wms.soswb;

import android.app.Activity;
import android.app.AlertDialog;
import android.os.Bundle;
import android.provider.Settings;
import android.view.KeyEvent;
import android.view.View;
import android.view.WindowManager;
import android.widget.*;
import org.json.JSONArray;
import org.json.JSONObject;
import java.io.InputStream;
import java.io.ByteArrayOutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.UUID;

/** Separate from FBS: a duplicate never claims an order or changes a mark binding. */
public class DuplicateKizActivity extends Activity {
    private static final String API = "https://wms.logoff.pro/api/v1/print/kiz-duplicates";
    private final ArrayList<String> clientIds = new ArrayList<>(), stationIds = new ArrayList<>();
    private Spinner clients, stations;
    private EditText scan;
    private TextView message, prompt;
    private Button print, refresh, next, history;
    private String token, kiz = "", barcode = "", skuId = "", jobId = "", stage = "KIZ";
    private JSONObject pending;
    private boolean busy;
    private android.content.SharedPreferences prefs;

    @Override public void onCreate(Bundle state) {
        super.onCreate(state);
        token = getIntent().getStringExtra("token");
        if (token == null || token.isEmpty()) { finish(); return; }
        // FIX: keep recovery separate for every signed-in account.
        prefs = getSharedPreferences("kiz-duplicate-" + getIntent().getStringExtra("login"), MODE_PRIVATE);
        LinearLayout layout = new LinearLayout(this); layout.setOrientation(LinearLayout.VERTICAL); layout.setPadding(20,20,20,20);
        ScrollView root = new ScrollView(this); root.addView(layout); setContentView(root);
        label(layout, "ДУБЛЬ КИЗ", 28);
        label(layout, "Копия того же кода. Этикетка 58 × 40 мм.", 16);
        label(layout, "Клиент", 16); clients = new Spinner(this); layout.addView(clients);
        label(layout, "Печатная станция", 16); stations = new Spinner(this); layout.addView(stations);
        prompt = label(layout, "ОТСКАНИРУЙТЕ ПОЛНЫЙ КИЗ", 23);
        scan = new EditText(this); scan.setSingleLine(true); scan.setTextSize(20); scan.setHint("Поле сканера"); layout.addView(scan);
        message = label(layout, "", 18);
        print = button(layout, "ПОДТВЕРДИТЬ ТОВАР И ПЕЧАТАТЬ", this::print);
        refresh = button(layout, "ОБНОВИТЬ / ПРОВЕРИТЬ ПЕЧАТЬ", () -> { if (jobId.isEmpty()) loadLists(); else checkJob(); });
        next = button(layout, "НОВЫЙ КОД", this::newCode);
        history = button(layout, "МОЯ ИСТОРИЯ ПЕЧАТИ", this::history);
        button(layout, "НАЗАД В SOS WB2", this::finish);
        scan.setOnKeyListener((v, key, event) -> {
            if (key != KeyEvent.KEYCODE_ENTER) return false;
            if (event.getAction() == KeyEvent.ACTION_UP) acceptScan();
            return true;
        });
        scan.setOnEditorActionListener((v, action, event) -> { if (event == null) acceptScan(); return true; });
        getWindow().setSoftInputMode(WindowManager.LayoutParams.SOFT_INPUT_STATE_ALWAYS_HIDDEN);
        try { String saved = prefs.getString("pending", ""); if (!saved.isEmpty()) { pending = new JSONObject(saved); jobId = pending.getString("id"); stage = "WAIT"; } } catch(Exception ignored) {}
        render(); if (!jobId.isEmpty()) checkJob(); else loadLists();
    }
    private TextView label(LinearLayout layout, String text, int size) { TextView v = new TextView(this); v.setText(text); v.setTextSize(size); v.setPadding(0,10,0,10); layout.addView(v); return v; }
    private Button button(LinearLayout layout, String title, Runnable action) { Button b = new Button(this); b.setText(title); layout.addView(b); b.setOnClickListener(v -> { if (!busy) action.run(); }); return b; }
    private void render() {
        clients.setEnabled(!busy && kiz.isEmpty() && jobId.isEmpty()); stations.setEnabled(!busy && jobId.isEmpty());
        print.setEnabled(!busy && DuplicatePrintState.canSubmit(stage, pending != null && pending.has("kiz")));
        print.setText(jobId.isEmpty() ? "ПОДТВЕРДИТЬ ТОВАР И ПЕЧАТАТЬ" : "ПОВТОРИТЬ ТОТ ЖЕ ЗАПРОС");
        refresh.setEnabled(!busy); next.setEnabled(!busy); history.setEnabled(!busy);
        scan.setEnabled(!busy && DuplicatePrintState.canScan(stage));
        prompt.setText(stage.equals("KIZ") ? "ОТСКАНИРУЙТЕ ПОЛНЫЙ КИЗ" : stage.equals("BARCODE") ? "КИЗ НЕ ОПРЕДЕЛЁН — СКАНИРУЙТЕ ШК" : stage.equals("READY") ? "ПРОВЕРЬТЕ ТОВАР, РАЗМЕР И ЦВЕТ" : stage.equals("VERIFY") ? "ОТСКАНИРУЙТЕ НАПЕЧАТАННЫЙ ДУБЛЬ" : stage.equals("DONE") ? "ДУБЛЬ ПРОВЕРЕН" : "ПРОВЕРЬТЕ СОСТОЯНИЕ ПЕЧАТИ");
        if (scan.isEnabled()) scan.requestFocus();
    }
    private void loadLists() {
        request("/clients", "GET", null, response -> {
            populate(response, clients, clientIds);
            request("/stations", "GET", null, stationsResponse -> {
                populate(stationsResponse, stations, stationIds);
                message.setText(stationIds.isEmpty() ? "Нет готовой станции. Нужен обновлённый Windows-агент и этикетки 58 × 40 мм." : "Выберите клиента и отсканируйте код.");
            });
        });
    }
    private void populate(JSONObject response, Spinner spinner, ArrayList<String> ids) throws Exception {
        JSONArray rows = response.getJSONArray("items"); ArrayList<String> names = new ArrayList<>();
        String previous = selected(spinner, ids); ids.clear();
        for(int i=0;i<rows.length();i++){JSONObject row=rows.getJSONObject(i);ids.add(row.getString("id"));names.add(row.getString("name"));}
        spinner.setAdapter(new ArrayAdapter<>(this, android.R.layout.simple_spinner_dropdown_item, names));
        if(ids.contains(previous)) spinner.setSelection(ids.indexOf(previous));
    }
    private String selected(Spinner spinner, ArrayList<String> ids) { int i=spinner.getSelectedItemPosition();return i>=0&&i<ids.size()?ids.get(i):""; }
    private void acceptScan() {
        if(busy || !scan.isEnabled()) return;
        String value=scan.getText().toString(); scan.setText("");
        if(value.isEmpty()) return;
        if(stage.equals("VERIFY")) {
            request("/jobs/"+jobId+"/verify", "POST", data("kiz",value), response -> { stage="DONE";prefs.edit().remove("pending").apply();pending=null;message.setText("Код совпадает с оригиналом. Проверка сохранена."); });return;
        }
        if(stage.equals("KIZ")) { kiz=value;barcode=""; } else { barcode=value; }
        String clientId=selected(clients,clientIds);
        if(clientId.isEmpty()){kiz="";message.setText("Выберите клиента.");render();return;}
        JSONObject body=data("clientId",clientId,"kiz",kiz);if(!barcode.isEmpty())put(body,"barcode",barcode);
        request("/lookup","POST",body,response->{
            kiz=response.getString("kiz");
            if(!"READY".equals(response.optString("state"))) {stage="BARCODE";message.setText(response.optString("message"));return;}
            JSONObject product=response.getJSONObject("product");skuId=product.getString("id");stage="READY";
            message.setText(productText(product)+"\n\n"+response.optString("message"));
        });
    }
    private void print() {
        if(pending==null) {
            String stationId=selected(stations,stationIds),clientId=selected(clients,clientIds);
            if(stationId.isEmpty()){message.setText("Выберите готовую станцию печати.");return;}
            jobId=UUID.randomUUID().toString();
            pending=data("id",jobId,"stationId",stationId,"clientId",clientId,"skuId",skuId,"kiz",kiz,"deviceCode","SOS-WB:"+Settings.Secure.getString(getContentResolver(),Settings.Secure.ANDROID_ID));
            if(!barcode.isEmpty())put(pending,"barcode",barcode);
            // FIX: save the same id before sending; a timeout/restart must not create another copy.
            prefs.edit().putString("pending",pending.toString()).commit();
        }
        stage="WAIT";
        request("/jobs","POST",pending,this::showStatus);
    }
    private void checkJob() { request("/jobs/"+jobId,"GET",null,this::showStatus); }
    private void showStatus(JSONObject response) throws Exception {
        String status=response.optString("status");
        String product=response.optJSONObject("product")==null?"":productText(response.getJSONObject("product"))+"\n\n";
        if(status.equals("VERIFIED")){stage="DONE";pending=null;prefs.edit().remove("pending").apply();message.setText(product+"Дубль проверен повторным сканированием.");}
        else if(status.equals("PRINTED")){stage="VERIFY";message.setText(product+"Станция передала этикетку в печать. Отсканируйте напечатанный код для проверки.");}
        else if(status.equals("FAILED")){stage="FAILED";message.setText(product+"Ошибка: "+response.optString("error")+"\nПроверьте принтер перед созданием нового задания.");}
        else {stage="WAIT";message.setText(product+(response.optBoolean("checkPrinter")?"Нет окончательного ответа станции. Проверьте принтер: автоматической повторной печати не будет.":status.equals("CLAIMED")?"Станция приняла задание. Нажмите «Проверить печать».":"Задание в очереди. Нажмите «Проверить печать»."));}
    }
    private String productText(JSONObject product) {return value(product,"name")+"\nАрт.: "+value(product,"article")+"\nРазмер: "+value(product,"size")+"\nЦвет: "+value(product,"color");}
    private String value(JSONObject o,String k){return o.isNull(k)?"—":o.optString(k,"—");}
    private void newCode() {
        Runnable reset=()->{pending=null;jobId="";kiz="";barcode="";skuId="";stage="KIZ";prefs.edit().remove("pending").apply();scan.setText("");message.setText("Отсканируйте следующий КИЗ.");render();loadLists();};
        if(!jobId.isEmpty()&&!stage.equals("DONE"))new AlertDialog.Builder(this).setTitle("Проверка принтера").setMessage("Задание могло уже напечататься или остаться в очереди. Новый код не отменяет предыдущую печать. Продолжить?").setNegativeButton("Назад",null).setPositiveButton("Продолжить",(d,w)->reset.run()).show();else reset.run();
    }
    private void history() {
        request("/jobs","GET",null,response->{
            JSONArray rows=response.getJSONArray("items");String[] titles=new String[rows.length()];
            for(int i=0;i<rows.length();i++){JSONObject row=rows.getJSONObject(i);titles[i]=row.optString("createdAt")+" · "+DuplicatePrintState.label(row.optString("status"))+"\n"+value(row.getJSONObject("product"),"article");}
            new AlertDialog.Builder(this).setTitle("Мои последние дубли КИЗ").setItems(titles,(d,index)->{
                JSONObject row=rows.optJSONObject(index);jobId=row.optString("id");pending=data("id",jobId);prefs.edit().putString("pending",pending.toString()).apply();stage="WAIT";checkJob();
            }).setNegativeButton("Закрыть",null).show();
        });
    }
    private JSONObject data(Object... pairs){JSONObject body=new JSONObject();for(int i=0;i<pairs.length;i+=2)put(body,String.valueOf(pairs[i]),pairs[i+1]);return body;}
    private void put(JSONObject body,String key,Object value){try{body.put(key,value);}catch(Exception e){throw new IllegalArgumentException(e);}}
    private interface Done{void run(JSONObject response)throws Exception;}
    private void request(String path,String method,JSONObject body,Done done){
        busy=true;render();
        new Thread(()->{
            HttpURLConnection conn=null;
            try{
                conn=(HttpURLConnection)new URL(API+path).openConnection();conn.setRequestMethod(method);conn.setConnectTimeout(10000);conn.setReadTimeout(45000);
                conn.setRequestProperty("Authorization","Bearer "+token);conn.setRequestProperty("Content-Type","application/json; charset=utf-8");
                if(body!=null){byte[] bytes=body.toString().getBytes(StandardCharsets.UTF_8);conn.setDoOutput(true);conn.setFixedLengthStreamingMode(bytes.length);try(java.io.OutputStream out=conn.getOutputStream()){out.write(bytes);}}
                int status=conn.getResponseCode();String result="{}";
                try(InputStream in=status<400?conn.getInputStream():conn.getErrorStream();ByteArrayOutputStream out=new ByteArrayOutputStream()){if(in!=null){byte[] bytes=new byte[4096];int n;while((n=in.read(bytes))!=-1)out.write(bytes,0,n);}result=out.toString("UTF-8");}
                JSONObject response=result.trim().startsWith("[")?new JSONObject().put("items",new JSONArray(result)):new JSONObject(result);
                if(status>=400)throw new IllegalStateException(status==401?"Сеанс завершён. Вернитесь и войдите в SOS WB2 заново.":response.optString("message","Ошибка ВМС "+status));
                runOnUiThread(()->{if(isFinishing()||isDestroyed())return;busy=false;try{done.run(response);}catch(Exception e){message.setText(e.getMessage());}render();});
            }catch(Exception e){runOnUiThread(()->{if(isFinishing()||isDestroyed())return;busy=false;message.setText(e.getMessage());render();});}finally{if(conn!=null)conn.disconnect();}
        },"kiz-duplicate").start();
    }
}
