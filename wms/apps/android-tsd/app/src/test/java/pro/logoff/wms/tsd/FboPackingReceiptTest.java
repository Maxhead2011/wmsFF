package pro.logoff.wms.tsd;
import java.util.*;
import org.junit.Test;
import pro.logoff.wms.tsd.network.*;
import static org.junit.Assert.*;

public class FboPackingReceiptTest {
 private TsdFboPlan plan(){TsdFboPlan p=new TsdFboPlan();p.requestId="r";p.phase="PACKING";return p;}
 private FboPackingReceipt.State state(){FboPackingReceipt.State s=new FboPackingReceipt.State();s.version=1;s.requestId="r";s.phase="PACKING";s.needed=10;s.picked=10;s.packed=4;s.lines=new ArrayList<>();s.boxes=new ArrayList<>();s.wholeBoxes=new ArrayList<>();return s;}
 // TEST: lost response and duplicate acknowledgement cannot add a unit twice.
 @Test public void duplicateUsesAbsoluteCounters(){TsdFboPlan p=plan();FboPackingReceipt.State s=state();assertTrue(FboPackingReceipt.apply(p,s,true,"logoff"));assertTrue(FboPackingReceipt.apply(p,s,true,"logoff"));assertEquals(4,p.packed);s.packed=6;assertTrue(FboPackingReceipt.apply(p,s,true,"logoff"));assertEquals(6,p.packed);}
 @Test public void requiresMatchingPhaseAndRequest(){TsdFboPlan p=plan();FboPackingReceipt.State s=state();s.phase="CONTROL";assertFalse(FboPackingReceipt.apply(p,s,true,"logoff"));s.phase="PACKING";s.requestId="other";assertFalse(FboPackingReceipt.apply(p,s,true,"logoff"));assertEquals(0,p.packed);}
 @Test public void missingPayloadAndSoldUseFullRefresh(){assertFalse(FboPackingReceipt.apply(plan(),null,true,"logoff"));assertFalse(FboPackingReceipt.apply(plan(),state(),true,"ffullhab"));assertFalse(FboPackingReceipt.apply(plan(),state(),false,"logoff"));}
}
