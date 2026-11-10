package pro.logoff.wms.tsd.data;

import android.content.SharedPreferences;
import java.util.*;
import org.json.*;

// FIX: unsent box scans survive reopening and process death, before outbox handoff.
public final class ReceiptBoxDraft {
    private final SharedPreferences preferences;
    private final String key;
    private final String clientId, document, box;

    public ReceiptBoxDraft(SharedPreferences preferences, String operatorScope, String clientId, String document, String box) {
        if (preferences == null || blank(operatorScope) || blank(clientId) || blank(document) || blank(box))
            throw new IllegalStateException("Не удалось определить область черновика приёмки.");
        this.preferences=preferences; this.clientId=clientId; this.document=document; this.box=normalizeBox(box);
        this.key="receipt-box-draft:v1:"+new JSONArray(Arrays.asList(operatorScope,clientId,document,this.box)).toString();
    }
    public static final class Snapshot {
        public final List<Map<String,String>> items;
        public final ReceiptCloseBatch batch;
        Snapshot(List<Map<String,String>> items, ReceiptCloseBatch batch) {this.items=items;this.batch=batch;}
    }
    public Snapshot load() {
        String text=preferences.getString(key,null);
        if(text==null)return new Snapshot(new ArrayList<>(),null);
        try {
            JSONObject root=new JSONObject(text);
            if(root.getInt("version")!=1)throw new JSONException("Unknown draft version");
            List<Map<String,String>> items=new ArrayList<>();
            JSONArray rows=root.getJSONArray("items");
            for(int i=0;i<rows.length();i++)items.add(map(rows.getJSONObject(i)));
            ReceiptCloseBatch batch=null;
            if(root.has("batch")) {
                JSONArray saved=root.getJSONArray("batch");List<PendingOperation> operations=new ArrayList<>();
                for(int i=0;i<saved.length();i++) {
                    JSONObject row=saved.getJSONObject(i);Map<String,String> payload=map(row.getJSONObject("payload"));
                    if(!clientId.equals(payload.get("clientId"))||!document.equals(payload.get("sourceDocument"))||!box.equals(normalizeBox(payload.get("boxCode"))))throw new JSONException("Draft batch scope mismatch");
                    operations.add(new PendingOperation(row.getString("key"),row.getString("type"),payload,row.getLong("createdAt"),OperationStatus.PENDING,0,null));
                }
                batch=ReceiptCloseBatch.restore(operations);
            }
            return new Snapshot(items,batch);
        } catch(Exception error) {throw new IllegalStateException("Черновик короба повреждён. Не очищайте данные ТСД; обратитесь к администратору.",error);}
    }
    public void save(List<Map<String,String>> items, ReceiptCloseBatch batch) {
        try {
            JSONObject root=new JSONObject();root.put("version",1);JSONArray rows=new JSONArray();
            for(Map<String,String> item:items)rows.put(new JSONObject(item));root.put("items",rows);
            if(batch!=null) {
                JSONArray operations=new JSONArray();
                for(PendingOperation operation:batch.operations) {
                    JSONObject row=new JSONObject();row.put("key",operation.operationKey);row.put("type",operation.operationType);row.put("createdAt",operation.createdAt);row.put("payload",new JSONObject(operation.payload));operations.put(row);
                }
                root.put("batch",operations);
            }
            if(!preferences.edit().putString(key,root.toString()).commit())throw new IllegalStateException("Не удалось сохранить скан на ТСД. Не продолжайте приёмку до восстановления памяти устройства.");
        } catch(JSONException error) {throw new IllegalStateException("Не удалось сохранить черновик короба.",error);}
    }
    // Remove only after the whole batch is durably present in the Room outbox.
    public void clear() {if(!preferences.edit().remove(key).commit())throw new IllegalStateException("Не удалось завершить сохранение короба на ТСД. Повторите закрытие.");}
    private static Map<String,String> map(JSONObject row)throws JSONException {
        Map<String,String> result=new LinkedHashMap<>();Iterator<String> names=row.keys();while(names.hasNext()){String name=names.next();result.put(name,row.getString(name));}return result;
    }
    private static String normalizeBox(String value) {
        if(value==null)return "";
        StringBuilder result=new StringBuilder();
        for(int i=0;i<value.length();i++)if(Character.isLetterOrDigit(value.charAt(i)))result.append(Character.toString(value.charAt(i)).toUpperCase(Locale.ROOT));
        return result.toString();
    }
    private static boolean blank(String value){return value==null||value.trim().isEmpty();}
}
