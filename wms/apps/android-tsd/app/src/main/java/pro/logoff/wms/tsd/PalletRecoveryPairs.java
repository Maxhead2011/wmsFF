package pro.logoff.wms.tsd;
import java.util.*;
// FIX: one counted unit requires a unique physical KIZ after a product barcode.
final class PalletRecoveryPairs {
 private StorageKizRecountState unique=new StorageKizRecountState();
 private final List<Map<String,Object>> rows=new ArrayList<>();
 String skuId="",barcode="",name="";boolean lookingUp,submitted;
 boolean pending(){return !barcode.isEmpty();}
 void product(String id,String code,String title){if(pending()||submitted)throw new IllegalStateException("Сначала завершите текущую пару ШК + КИЗ.");skuId=id;barcode=code;name=title;}
 boolean accept(String kiz){if(!pending())throw new IllegalStateException("Сначала сканируйте ШК товара.");if(submitted)throw new IllegalStateException("Пересчёт уже отправлен. Повторите сохранение.");if(!unique.add(kiz))throw new IllegalArgumentException("Этот КИЗ уже отсканирован. Повтор не увеличивает количество.");Map<String,Object> r=new LinkedHashMap<>();r.put("skuId",skuId);r.put("barcode",barcode);r.put("kiz",kiz.trim());r.put("quantity",1);rows.add(r);skuId="";barcode="";name="";return true;}
 List<Map<String,Object>> payload(){if(pending()||lookingUp||rows.isEmpty())throw new IllegalStateException("Завершите пары ШК + КИЗ перед восстановлением.");submitted=true;return new ArrayList<>(rows);}
 void clear(){unique=new StorageKizRecountState();rows.clear();skuId="";barcode="";name="";lookingUp=false;submitted=false;}
}
