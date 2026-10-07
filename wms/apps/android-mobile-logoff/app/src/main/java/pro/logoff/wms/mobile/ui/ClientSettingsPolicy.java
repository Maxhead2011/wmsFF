package pro.logoff.wms.mobile.ui;
import java.util.*;
// FIX: typed, allowlisted client settings. Unknown server fields remain untouched.
public final class ClientSettingsPolicy {
 public static final String[][] FLAGS={
  {"storageAccountingEnabled","Вести учёт хранения"},
  {"storesWithoutBoxes","Принимать без коробов"},
  {"onlineReceiptVisibleToClient","Показывать клиенту онлайн-приёмку"},
  {"fbsCalculatorEnabled","Показывать калькулятор FBS"},
  {"relabelingEnabled","Разрешить переклейку товаров"}
 };
 // key, title, then alternating server value and human-readable label.
 public static final String[][] CHOICES={
  {"clientKind","Тип клиента","LEGAL_ENTITY","Юридическое лицо","INDIVIDUAL_ENTREPRENEUR","Индивидуальный предприниматель","SELF_EMPLOYED","Самозанятый","INDIVIDUAL","Физическое лицо"},
  {"stockBalanceMode","Какие остатки учитывать","PALLET_SORT","Только на паллет-сортах","BOXES","Во всех активных коробах"},
  {"logisticsInvoiceMode","Выставление логистики","SEPARATE","Отдельным счётом","SAME_INVOICE","В общем счёте","DISABLED","Не выставлять автоматически"},
  {"storageBillingMode","Выставление хранения","MONTHLY","Раз в месяц","ON_SHIPMENT","По отгрузке"}
 };
 private ClientSettingsPolicy(){}
 public static boolean supported(String key,Object value){
  for(String[] f:FLAGS)if(f[0].equals(key))return value instanceof Boolean;
  for(String[] f:CHOICES)if(f[0].equals(key)){for(int i=2;i<f.length;i+=2)if(f[i].equals(value))return true;}
  return false;
 }
 public static Map<String,Object> delta(Map<String,Object> before,Map<String,?> entered){
  Map<String,Object> out=new LinkedHashMap<>();
  List<String[]> fields=new ArrayList<>();Collections.addAll(fields,FLAGS);Collections.addAll(fields,CHOICES);
  for(String[] f:fields){String key=f[0];if(!entered.containsKey(key))continue;Object value=entered.get(key);
   if(!supported(key,before.get(key))||!supported(key,value))throw new IllegalArgumentException("Перечитайте настройку «"+f[1]+"»: значение не поддерживается");
   if(!Objects.equals(value,before.get(key)))out.put(key,value);
  }return out;
 }
 public static String title(String key){for(String[] f:FLAGS)if(f[0].equals(key))return f[1];for(String[] f:CHOICES)if(f[0].equals(key))return f[1];return key;}
 public static String display(String key,Object value){
  if(value instanceof Boolean)return Boolean.TRUE.equals(value)?"Да":"Нет";
  for(String[] f:CHOICES)if(f[0].equals(key))for(int i=2;i<f.length;i+=2)if(f[i].equals(value))return f[i+1];
  return "Неизвестное значение";
 }
}
