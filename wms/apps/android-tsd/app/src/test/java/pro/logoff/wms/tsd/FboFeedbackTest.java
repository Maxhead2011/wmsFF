package pro.logoff.wms.tsd;
import java.util.*;
import org.junit.Test;
import pro.logoff.wms.tsd.network.TsdFboPlan;
import static org.junit.Assert.*;
public class FboFeedbackTest {
    // TEST: uncertain responses must retain the same operation ID for safe retries.
    @Test public void transientAndAuthenticationFailuresAreNotAcknowledgements(){
        for(int code:new int[]{401,403,408,429,500,502,503})assertFalse(FboFeedback.definitiveRejection(code));
        for(int code:new int[]{400,404,409,422})assertTrue(FboFeedback.definitiveRejection(code));
    }
    // TEST: box counts come from the persisted request/result, never another worker's progress delta.
    @Test public void acknowledgementUsesTheQuantityOfThisOperation(){
        TsdFboPlan plan=new TsdFboPlan();plan.picked=500;plan.boxes=new ArrayList<>();
        assertEquals("Принято: 1 шт. Товар отобран.",FboFeedback.accepted(Map.of("action","PICK_UNIT"),plan));
        assertEquals("Короб принят: 19 шт.",FboFeedback.accepted(Map.of("action","PICK_BOX","confirmedQuantity","19"),plan));
        TsdFboPlan.Box box=new TsdFboPlan.Box();box.code="B";box.quantity=19;box.confirmed=true;plan.boxes.add(box);
        assertEquals("Короб упакован: 19 шт.",FboFeedback.accepted(Map.of("action","PACK_BOX","sourceBoxCode","B"),plan));
        assertEquals(1,FboFeedback.confirmed(plan));
    }
}
