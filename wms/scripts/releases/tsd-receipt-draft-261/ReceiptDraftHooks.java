package pro.logoff.wms.tsd;

import android.content.SharedPreferences;
import android.widget.EditText;
import java.lang.reflect.*;
import org.json.*;
import java.util.*;
import java.util.concurrent.ConcurrentHashMap;
import pro.logoff.wms.tsd.data.ReceiptBoxDraft;
import pro.logoff.wms.tsd.data.ReceiptCloseBatch;

// FIX: verified APK260 adapter. Original methods, voice and server selection stay intact.
public final class ReceiptDraftHooks {
    private static final Map<Object,Open> openings=Collections.synchronizedMap(new WeakHashMap<Object,Open>());
    private static final Map<String,ReceiptBoxDraft> handoffs=new ConcurrentHashMap<>();
    private static final ThreadLocal<Object> closing=new ThreadLocal<>();
    private static final class Open {
        final String client,document,box;
        final ReceiptBoxDraft.Snapshot snapshot;
        Open(Object a,String box,ReceiptBoxDraft.Snapshot snapshot)throws Exception{client=text(get(a,"receiptClientId"));document=text(get(a,"receiptSourceDocument"));this.box=normal(box);this.snapshot=snapshot;}
    }
    public static boolean beforeOpen(Object a) {
        try {
            openings.remove(a);
            if(Boolean.TRUE.equals(get(a,"receiptClosingBox")))return fail(a,"Дождитесь сохранения текущего короба.");
            String requested=((EditText)get(a,"boxCodeInput")).getText().toString();
            String current=text(get(a,"receiptBoxCode"));
            if(requested.trim().isEmpty()||!(normal(requested).startsWith("FFL")||normal(requested).startsWith("FFU")))return true;
            if(call(a,"safeSession")==null||text(get(a,"receiptClientId")).isEmpty())return true;
            List<?> items=(List<?>)get(a,"receiptCurrentItems");
            if(!items.isEmpty()||get(a,"receiptCloseBatch")!=null){
                if(!normal(current).equals(normal(requested)))return fail(a,"Сначала закройте текущий короб. Его сканы сохранены.");
                save(a,current,(ReceiptCloseBatch)get(a,"receiptCloseBatch"));
            }
            ReceiptBoxDraft.Snapshot snapshot=store(a,requested).load();
            openings.put(a,new Open(a,requested,snapshot));
            return true;
        }catch(Exception e){return fail(a,message(e));}
    }
    public static void afterOpen(Object a) {
        Open pending=openings.remove(a);if(pending==null)return;
        try {
            if(!pending.client.equals(text(get(a,"receiptClientId")))||!pending.document.equals(text(get(a,"receiptSourceDocument")))||!pending.box.equals(normal(text(get(a,"receiptBoxCode")))))return;
            List<Object> items=(List<Object>)get(a,"receiptCurrentItems");items.clear();
            for(Map<String,String> row:pending.snapshot.items){Object item=item(a,row.get("barcode"),row.get("kiz"),row.get("name"));
                for(Field field:item.getClass().getDeclaredFields())if(!Modifier.isStatic(field.getModifiers())&&row.containsKey(field.getName())){field.setAccessible(true);String v=row.get(field.getName());Class<?> t=field.getType();if(t==String.class)field.set(item,v);else if(t==long.class)field.setLong(item,Long.parseLong(v));else if(t==int.class)field.setInt(item,Integer.parseInt(v));else if(t==boolean.class)field.setBoolean(item,Boolean.parseBoolean(v));else if(t==Map.class)field.set(item,"null".equals(v)?null:json(new JSONObject(v)));else throw new IllegalStateException("Неизвестное поле черновика");}
                items.add(item);String kiz=text(get(item,"kiz"));if(!kiz.isEmpty()){
                    String key=(String)call(a,"receiptKizKey",new Class<?>[]{String.class},kiz);
                    ((Set<String>)get(a,"receiptKizValues")).add(key);((Map<String,String>)get(a,"receiptKizBoxes")).put(key,text(get(a,"receiptBoxCode")));
                }
            }
            set(a,"receiptCloseBatch",pending.snapshot.batch);
            if(pending.snapshot.batch!=null)handoffs.put(pending.snapshot.batch.closeKey,store(a,text(get(a,"receiptBoxCode"))));
            call(a,"renderReceiptScreen");
        }catch(Exception e){fail(a,message(e));}
    }
    public static boolean beforeAdd(Object a,String barcode,String kiz,Object sku,String ignoredMessage) {
        try {
            if(!Boolean.TRUE.equals(call(a,"receiptUsesBoxes")))return true;
            if(!((Collection<?>)get(a,"receiptKizConflicts")).isEmpty()||get(a,"receiptCloseBatch")!=null)return true;
            Object candidate=item(a,barcode,kiz,sku==null?null:text(get(sku,"name")));
            set(candidate,"secondBarcodeScan",call(get(a,"receiptBarcodeRescan"),"evidence"));
            List<Map<String,String>> rows=rows(a);rows.add(row(candidate));
            store(a,text(get(a,"receiptBoxCode"))).save(rows,null);
            return true;
        }catch(Exception e){return fail(a,message(e));}
    }
    public static void afterAdd(Object a) {
        try{if(Boolean.TRUE.equals(call(a,"receiptUsesBoxes")))save(a,text(get(a,"receiptBoxCode")),(ReceiptCloseBatch)get(a,"receiptCloseBatch"));}
        catch(Exception e){fail(a,message(e));}
    }
    private static Object json(Object value)throws Exception {
        if(value==JSONObject.NULL)return null;
        if(value instanceof JSONObject){Map<String,Object> out=new LinkedHashMap<>();Iterator<String> keys=((JSONObject)value).keys();while(keys.hasNext()){String k=keys.next();out.put(k,json(((JSONObject)value).get(k)));}return out;}
        if(value instanceof JSONArray){List<Object> out=new ArrayList<>();for(int i=0;i<((JSONArray)value).length();i++)out.add(json(((JSONArray)value).get(i)));return out;}
        return value;
    }
    public static boolean enterClose(Object a) {
        try{ReceiptCloseBatch batch=(ReceiptCloseBatch)get(a,"receiptCloseBatch");save(a,text(get(a,"receiptBoxCode")),batch);closing.set(a);if(batch!=null)handoffs.put(batch.closeKey,store(a,text(get(a,"receiptBoxCode"))));return true;}
        catch(Exception e){closing.remove();return fail(a,message(e));}
    }
    public static void exitClose(){closing.remove();}
    public static void afterBatchCreated(Object value) {
        Object a=closing.get();if(a==null)return;
        try{ReceiptCloseBatch batch=(ReceiptCloseBatch)value;save(a,text(get(a,"receiptBoxCode")),batch);handoffs.put(batch.closeKey,store(a,text(get(a,"receiptBoxCode"))));}
        catch(Exception e){throw new IllegalArgumentException(message(e),e);}
    }
    public static void onBatchEnqueued(Object value) {
        ReceiptCloseBatch batch=(ReceiptCloseBatch)value;ReceiptBoxDraft draft=handoffs.get(batch.closeKey);
        if(draft!=null){draft.clear();handoffs.remove(batch.closeKey);}
    }
    private static ReceiptBoxDraft store(Object a,String box)throws Exception {
        return new ReceiptBoxDraft((SharedPreferences)get(a,"uiStore"),text(get(a,"receiptDocumentPreferenceKey")),text(get(a,"receiptClientId")),text(get(a,"receiptSourceDocument")),normal(box));
    }
    private static void save(Object a,String box,ReceiptCloseBatch batch)throws Exception{store(a,box).save(rows(a),batch);}
    private static List<Map<String,String>> rows(Object a)throws Exception{List<Map<String,String>> rows=new ArrayList<>();for(Object item:(List<?>)get(a,"receiptCurrentItems"))rows.add(row(item));return rows;}
    private static Map<String,String> row(Object item)throws Exception{
        Map<String,String> row=new LinkedHashMap<>();for(Field f:item.getClass().getDeclaredFields())if(!Modifier.isStatic(f.getModifiers())){f.setAccessible(true);Class<?> t=f.getType();if(!(t==String.class||t==long.class||t==int.class||t==boolean.class||t==Map.class))throw new IllegalStateException("Неизвестное поле товара");Object value=f.get(item);row.put(f.getName(),t==Map.class?(value==null?"null":new JSONObject((Map)value).toString()):text(value));}return row;
    }
    private static Object item(Object a,String barcode,String kiz,String name)throws Exception{Class<?> type=Class.forName(a.getClass().getName()+"$ReceiptItem");Constructor<?> ctor=type.getDeclaredConstructor(String.class,String.class,String.class);ctor.setAccessible(true);return ctor.newInstance(barcode,kiz,name);}
    private static Object get(Object a,String n)throws Exception{Field f=a.getClass().getDeclaredField(n);f.setAccessible(true);return f.get(a);}
    private static void set(Object a,String n,Object v)throws Exception{Field f=a.getClass().getDeclaredField(n);f.setAccessible(true);f.set(a,v);}
    private static Object call(Object a,String n)throws Exception{return call(a,n,new Class<?>[0]);}
    private static Object call(Object a,String n,Class<?>[] types,Object... values)throws Exception{Method m=a.getClass().getDeclaredMethod(n,types);m.setAccessible(true);return m.invoke(a,values);}
    private static boolean fail(Object a,String text){try{set(a,"statusMessage",text);set(a,"receiptFeedbackColor",0xffffcccc);call(a,"renderReceiptScreen");}catch(Exception ignored){}return false;}
    private static String message(Exception e){Throwable t=e;while(t.getCause()!=null)t=t.getCause();return t.getMessage()==null?"Не удалось сохранить черновик. Не очищайте данные ТСД.":t.getMessage();}
    private static String text(Object v){return v==null?"":String.valueOf(v);}
    private static String normal(String s){StringBuilder b=new StringBuilder();for(int i=0;i<s.length();i++)if(Character.isLetterOrDigit(s.charAt(i)))b.append(Character.toString(s.charAt(i)).toUpperCase(Locale.ROOT));return b.toString();}
}
