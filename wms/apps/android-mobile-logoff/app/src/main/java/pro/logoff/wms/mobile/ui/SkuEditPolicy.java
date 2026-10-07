package pro.logoff.wms.mobile.ui;
import java.math.BigDecimal;
import java.util.*;

// FIX: product metadata only, never client ownership, stock, barcodes or marking identity.
public final class SkuEditPolicy {
 public static final String[][] FIELDS={
  {"name","Название","text"},{"article","Артикул","text"},{"clientSku","Артикул клиента","text"},
  {"brand","Бренд","text"},{"category","Категория","text"},{"color","Цвет","text"},{"size","Размер","text"},
  {"weightGrams","Вес, г","integer"},{"lengthCm","Длина, см","decimal"},
  {"widthCm","Ширина, см","decimal"},{"heightCm","Высота, см","decimal"}
 };
 private SkuEditPolicy(){}
 public static String text(Object v){return v==null?"":v.toString();}
 public static boolean equal(Object a,Object b){
  if(a instanceof Number||b instanceof Number){try{return new BigDecimal(text(a)).compareTo(new BigDecimal(text(b)))==0;}catch(NumberFormatException e){return false;}}
  return text(a).equals(text(b));
 }
 public static Map<String,Object> delta(Map<String,Object> before,Map<String,String> entered){
  Map<String,Object> out=new LinkedHashMap<>();
  for(String[] f:FIELDS){String key=f[0];if(!entered.containsKey(key))continue;String value=entered.get(key).trim();Object next=value;
   if(!f[2].equals("text")){
    if(value.isEmpty()&&before.get(key)==null)continue;
    try{BigDecimal n=new BigDecimal(value.replace(',','.'));boolean integer=f[2].equals("integer");
     if(n.compareTo(integer?BigDecimal.ZERO:new BigDecimal("0.01"))<0||n.compareTo(new BigDecimal("2147483647"))>0)throw new NumberFormatException();
     if(integer){next=n.intValueExact();}else{next=n.doubleValue();}
    }catch(ArithmeticException|NumberFormatException e){throw new IllegalArgumentException(f[1]+": введите "+(f[2].equals("integer")?"целое число от 0":"число от 0,01"));}
   }else if(key.equals("name")&&(value.isEmpty()||value.length()>300))throw new IllegalArgumentException("Название: от 1 до 300 символов");
   if(!equal(before.get(key),next))out.put(key,next);
  }return out;
 }
 public static boolean matches(Map<String,Object> expected,Map<String,Object> actual){for(Map.Entry<String,Object> e:expected.entrySet()){
  if(!actual.containsKey(e.getKey()))return false;
  // Existing API normalizes zero grams to null; this is an acknowledged clear, not a timeout.
  if(e.getKey().equals("weightGrams")&&equal(e.getValue(),0)&&actual.get(e.getKey())==null)continue;
  if(!equal(e.getValue(),actual.get(e.getKey())))return false;
 }return true;}
}
