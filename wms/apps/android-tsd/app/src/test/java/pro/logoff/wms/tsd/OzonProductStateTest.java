package pro.logoff.wms.tsd;
import org.junit.Test;
import static org.junit.Assert.*;
import java.util.*;
import pro.logoff.wms.tsd.network.TsdFboPlan;
public class OzonProductStateTest {
 // TEST: product scan survives restarting before destination box; replay retains operation and KIZ.
 @Test public void restartAndRetryKeepProductIdentity(){
  FboScanState a=new FboScanState();a.productMode=true;a.productReady=true;a.productKiz="KIZ";a.barcode="123";a.direction="Краснодар";
  FboScanState b=new FboScanState();b.restoreCheckpoint(a.checkpoint());
  TsdFboPlan p=new TsdFboPlan();p.phase="PACKING";p.route=new ArrayList<>();p.boxes=new ArrayList<>();p.lines=new ArrayList<>();
  TsdFboPlan.Line l=new TsdFboPlan.Line();l.barcode="123";l.picked=1;p.lines.add(l);b.reconcile(p,true);
  assertEquals("123",b.barcode);assertEquals("KIZ",b.productKiz);assertTrue(b.productReady);
  b.target="FFL_BOX";Map<String,String> sent=b.prepare("PACK_PRODUCT",b.productKiz);
  FboScanState c=new FboScanState();c.restore(sent);assertTrue(c.productMode);assertEquals(sent,c.prepare("PACK_PRODUCT","OTHER"));
  assertEquals("KIZ",c.productKiz);c.accepted();assertNull(c.pending());assertEquals("",c.barcode);assertFalse(c.productReady);
 }
}
