package pro.logoff.wms.mobile.ui;
import org.junit.Test;
import static org.junit.Assert.*;
import java.util.*;
// TEST: numerical conversion cannot zero omitted fields or modify stock/identity.
public class SkuEditPolicyTest {
 @Test public void commaDimensionsAreNumbers(){assertEquals(12.5,SkuEditPolicy.delta(Collections.emptyMap(),Collections.singletonMap("lengthCm","12,5")).get("lengthCm"));}
 @Test public void sameNumberDoesNotWrite(){assertTrue(SkuEditPolicy.delta(Collections.singletonMap("weightGrams",120.0),Collections.singletonMap("weightGrams","120")).isEmpty());}
 @Test public void absentDimensionIsNotZero(){assertTrue(SkuEditPolicy.delta(Collections.emptyMap(),Collections.singletonMap("widthCm","")).isEmpty());}
 @Test public void cannotModifyStockOrOwnership(){Map<String,String> in=new HashMap<>();in.put("clientId","other");in.put("quantity","100");in.put("barcode","new");assertTrue(SkuEditPolicy.delta(Collections.emptyMap(),in).isEmpty());}
 @Test public void invalidNumbersRejected(){for(String key:Arrays.asList("weightGrams","lengthCm"))for(String value:Arrays.asList("-1","NaN","Infinity","2147483648")){try{SkuEditPolicy.delta(Collections.emptyMap(),Collections.singletonMap(key,value));fail();}catch(IllegalArgumentException expected){}}}
 @Test public void fractionalWeightRejected(){try{SkuEditPolicy.delta(Collections.emptyMap(),Collections.singletonMap("weightGrams","1.2"));fail();}catch(IllegalArgumentException expected){}}
 @Test public void missingResponseFieldsAreNotConfirmed(){assertFalse(SkuEditPolicy.matches(Collections.singletonMap("article",""),Collections.emptyMap()));}
 @Test public void decimalServerStringsCompareNumerically(){assertTrue(SkuEditPolicy.matches(Collections.singletonMap("lengthCm",12.5),Collections.singletonMap("lengthCm","12.50")));}
 @Test public void zeroWeightIsClearedByServer(){assertTrue(SkuEditPolicy.matches(Collections.singletonMap("weightGrams",0),Collections.singletonMap("weightGrams",null)));}
}
