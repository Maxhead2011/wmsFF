package pro.logoff.wms.mobile.ui;
import java.math.BigDecimal;
// FIX: validation only; balances and permissions remain authoritative on the server.
public final class FinancialActionPolicy {
 private FinancialActionPolicy() {}
 public static String amount(String raw){
  String value=raw.trim().replace(',','.');
  if(!value.matches("-?\\d+(?:\\.\\d{1,2})?"))throw new IllegalArgumentException("Укажите сумму с точностью до копейки");
  BigDecimal n=new BigDecimal(value);
  if(n.signum()==0||n.abs().compareTo(new BigDecimal("999999999999.99"))>0)throw new IllegalArgumentException("Сумма должна быть ненулевой и в пределах документа");
  return n.toPlainString();
 }
 public static boolean sameScope(String expected,String actual){return expected!=null&&!expected.isEmpty()&&expected.equals(actual);}
 public static boolean rejected(int code){return code==400||code==401||code==403||code==404||code==409||code==422;}
}
