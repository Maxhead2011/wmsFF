package pro.logoff.wms.mobile.ui;
import org.junit.Test;
import static org.junit.Assert.*;
import java.util.*;
// TEST: edits must never erase fields outside the form or submit unchanged data.
public class ClientEditPolicyTest {
 @Test public void onlyChangedAllowedFieldsAreSent(){Map<String,Object> old=new HashMap<>();old.put("name","Клиент");old.put("phone","123");old.put("ownCompanyId","keep");Map<String,String> input=new HashMap<>();input.put("name","Клиент");input.put("phone","456");input.put("ownCompanyId","bad");Map<String,Object> delta=ClientEditPolicy.delta(old,input);assertEquals(1,delta.size());assertEquals("456",delta.get("phone"));}
 @Test public void clearingOptionalValueIsExplicit(){Map<String,Object> old=new HashMap<>();old.put("email","a@b.ru");Map<String,String> input=new HashMap<>();input.put("email","");assertEquals("",ClientEditPolicy.delta(old,input).get("email"));}
 @Test public void unchangedNullDoesNotBecomeEmptyPatch(){assertTrue(ClientEditPolicy.delta(Collections.emptyMap(),Collections.singletonMap("phone","")).isEmpty());}
 @Test public void invalidNameIsRejected(){try{ClientEditPolicy.delta(Collections.emptyMap(),Collections.singletonMap("name","x"));fail();}catch(IllegalArgumentException expected){}}
 @Test public void rereadDetectsConflict(){assertFalse(ClientEditPolicy.matches(Collections.singletonMap("phone","123"),Collections.singletonMap("phone","456")));assertTrue(ClientEditPolicy.matches(Collections.singletonMap("phone","456"),Collections.singletonMap("phone","456")));}
}
