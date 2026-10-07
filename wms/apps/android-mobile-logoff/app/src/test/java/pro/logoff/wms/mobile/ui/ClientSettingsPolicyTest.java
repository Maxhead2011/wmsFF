package pro.logoff.wms.mobile.ui;
import org.junit.Test;
import static org.junit.Assert.*;
import java.util.*;
// TEST: settings never send defaults for missing/new server fields or unrelated properties.
public class ClientSettingsPolicyTest {
 @Test public void unchangedSettingsProduceNoWrite(){assertTrue(ClientSettingsPolicy.delta(Collections.singletonMap("stockBalanceMode","BOXES"),Collections.singletonMap("stockBalanceMode","BOXES")).isEmpty());}
 @Test public void booleansRemainBooleans(){Map<String,Object> delta=ClientSettingsPolicy.delta(Collections.singletonMap("relabelingEnabled",true),Collections.singletonMap("relabelingEnabled",false));assertEquals(Boolean.FALSE,delta.get("relabelingEnabled"));}
 @Test public void unknownFieldsAreNotSent(){assertTrue(ClientSettingsPolicy.delta(Collections.emptyMap(),Collections.singletonMap("ownCompanyId","other")).isEmpty());}
 @Test public void missingFieldCannotBeInvented(){try{ClientSettingsPolicy.delta(Collections.emptyMap(),Collections.singletonMap("stockBalanceMode","BOXES"));fail();}catch(IllegalArgumentException expected){}}
 @Test public void unsupportedEnumCannotBeWritten(){try{ClientSettingsPolicy.delta(Collections.singletonMap("stockBalanceMode","BOXES"),Collections.singletonMap("stockBalanceMode","ALL"));fail();}catch(IllegalArgumentException expected){}}
 @Test public void stringBooleanIsRejected(){try{ClientSettingsPolicy.delta(Collections.singletonMap("relabelingEnabled",true),Collections.singletonMap("relabelingEnabled","false"));fail();}catch(IllegalArgumentException expected){}}
 @Test public void labelExplainsStorageChange(){assertEquals("Во всех активных коробах",ClientSettingsPolicy.display("stockBalanceMode","BOXES"));}
}
