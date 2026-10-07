package pro.logoff.wms.mobile.ui;
import java.util.*;
// FIX: allowlisted minimal PATCH; unrelated client settings remain untouched.
public final class ClientEditPolicy {
 public static final String[][] FIELDS={{"name","Название"},{"legalName","Юридическое название"},{"inn","ИНН"},{"kpp","КПП"},{"ogrn","ОГРН"},{"legalAddress","Юридический адрес"},{"actualAddress","Фактический адрес"},{"phone","Телефон"},{"email","Почта"},{"telegramChatId","Telegram chat ID"},{"bankName","Банк"},{"bankBik","БИК"},{"bankAccount","Расчётный счёт"},{"correspondentAccount","Корреспондентский счёт"}};
 private ClientEditPolicy(){}
 public static String value(Object o){return o==null?"":o.toString();}
 public static Map<String,Object> delta(Map<String,Object> before,Map<String,String> input){
  Map<String,Object> out=new LinkedHashMap<>();
  for(String[] field:FIELDS){String key=field[0];if(!input.containsKey(key))continue;String v=input.get(key).trim();if(v.equals(value(before.get(key))))continue;
   if("name".equals(key)&&(v.length()<2||v.length()>200))throw new IllegalArgumentException("Название: от 2 до 200 символов");
   if("legalName".equals(key)&&!v.isEmpty()&&(v.length()<2||v.length()>200))throw new IllegalArgumentException("Юридическое название: от 2 до 200 символов");
   if("inn".equals(key)&&!v.isEmpty()&&!v.matches("\\d{10}|\\d{12}"))throw new IllegalArgumentException("ИНН: 10 или 12 цифр");
   if("email".equals(key)&&!v.isEmpty()&&!v.matches("[^\\s@]+@[^\\s@]+\\.[^\\s@]+"))throw new IllegalArgumentException("Проверьте адрес почты");
   out.put(key,v);
  }return out;
 }
 public static boolean matches(Map<String,Object> expected,Map<String,Object> actual){for(Map.Entry<String,Object> e:expected.entrySet())if(!value(e.getValue()).equals(value(actual.get(e.getKey()))))return false;return true;}
}
