package pro.logoff.wms.tsd.data;
import java.text.SimpleDateFormat;
import java.util.*;
// FIX: Reconstructed from the user-supplied released APK255; not published.
public final class ReceiptScanSnapshot {
 private ReceiptScanSnapshot() {}
 public static Map<String,String> capture(String name,String article,String actor,long time) {
  if(time<=0) throw new IllegalArgumentException("Invalid scan time");
  SimpleDateFormat format=new SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'",Locale.US);
  format.setTimeZone(TimeZone.getTimeZone("UTC"));
  Map<String,String> result=new LinkedHashMap<>();
  result.put("scanOccurredAt",format.format(new Date(time)));
  put(result,"scanProductName",name,500);
  put(result,"scanProductArticle",article,200);
  put(result,"scanActorName",actor,200);
  return Collections.unmodifiableMap(result);
 }
 private static void put(Map<String,String> result,String key,String value,int limit) {
  if(value==null||value.trim().isEmpty()) return;
  value=value.trim();result.put(key,value.substring(0,Math.min(limit,value.length())));
 }
}
