package pro.logoff.wms.mobile.ui;
import org.junit.Test;
import static org.junit.Assert.*;
import java.util.*;
// TEST: signed server amounts, missing values and bounded history without lost records.
public class CorrectionHistoryTest {
 @Test public void pagingHasNoMissingOrDuplicateRows(){
  List<Integer> rows=new ArrayList<>();for(int i=0;i<2000;i++)rows.add(i);
  List<Integer> shown=new ArrayList<>();for(int i=0;i<rows.size();i+=25)shown.addAll(CorrectionHistoryPresentation.page(rows,i));
  assertEquals(rows,shown);assertTrue(CorrectionHistoryPresentation.page(rows,2000).isEmpty());
  assertTrue(CorrectionHistoryPresentation.page(rows,-1).isEmpty());
 }
 @Test public void rendersServerCorrectionWithoutChangingSign(){
  Map<String,Object> row=new HashMap<>();row.put("invoiceNumber","СЧ-12");row.put("amountRub","-125.50");row.put("kind","LATE_WORK");row.put("reason","Поздняя операция");row.put("author","Оператор");
  String text=CorrectionHistoryPresentation.describe(row);
  assertTrue(text.contains("СЧ-12"));assertTrue(text.contains("-125"));assertTrue(text.contains("Поздние работы"));assertTrue(text.contains("Оператор"));
 }
 @Test public void missingDataIsNotZeroAndFutureKindsRemainVisible(){
  Map<String,Object> row=new HashMap<>();row.put("kind","NEW_KIND");
  String text=CorrectionHistoryPresentation.describe(row);assertTrue(text.contains("Нет данных"));assertTrue(text.contains("NEW_KIND"));
 }
}
