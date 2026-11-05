package pro.logoff.wms.tsd;
import org.junit.Test;
import java.util.Map;
import pro.logoff.wms.tsd.data.ReceiptScanSnapshot;
import static org.junit.Assert.*;
// TEST: retain the released APK255 scan evidence while adding FBS support.
public class ReceiptScanSnapshotTest {
 @Test public void preservesCapturedTimeAndTrimmedEvidence() {
  Map<String,String> snapshot=ReceiptScanSnapshot.capture(" Dress "," A1 "," Worker ",1L);
  assertEquals("1970-01-01T00:00:00.001Z",snapshot.get("scanOccurredAt"));
  assertEquals("Dress",snapshot.get("scanProductName"));
  assertEquals("A1",snapshot.get("scanProductArticle"));
  assertEquals("Worker",snapshot.get("scanActorName"));
 }
 @Test public void omitsUnknownEvidenceAndBoundsLengths() {
  assertEquals(1,ReceiptScanSnapshot.capture(null," ",null,1L).size());
  assertEquals(500,ReceiptScanSnapshot.capture(new String(new char[600]).replace('\0','x'),null,null,1L).get("scanProductName").length());
 }
 @Test(expected=IllegalArgumentException.class) public void rejectsMissingTime() {ReceiptScanSnapshot.capture(null,null,null,0L);}
 @Test(expected=UnsupportedOperationException.class) public void immutableEvidence() {ReceiptScanSnapshot.capture(null,null,null,1L).put("scanOccurredAt","later");}
}
