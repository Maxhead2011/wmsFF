package pro.logoff.wms.mobile.ui;
import org.junit.Test;
import static org.junit.Assert.*;
// TEST: financial form validation must reject ambiguous amounts and changed scope.
public class FinancialActionPolicyTest {
 @Test public void amountIsExact(){assertEquals("-12.50",FinancialActionPolicy.amount("-12,50"));assertEquals("0.01",FinancialActionPolicy.amount("0.01"));for(String s:new String[]{"0","1.001","1e3","NaN","1000000000000",""}){try{FinancialActionPolicy.amount(s);fail(s);}catch(IllegalArgumentException expected){}}}
 @Test public void rejectsMissingOrChangedScope(){assertFalse(FinancialActionPolicy.sameScope("","a"));assertFalse(FinancialActionPolicy.sameScope("user:client:branch1","user:client:branch2"));assertTrue(FinancialActionPolicy.sameScope("u:c:b","u:c:b"));}
 @Test public void uncertaintyIsNotSuccess(){for(int code:new int[]{0,408,429,500,502,503})assertFalse(FinancialActionPolicy.rejected(code));for(int code:new int[]{400,401,403,404,409,422})assertTrue(FinancialActionPolicy.rejected(code));}
}
