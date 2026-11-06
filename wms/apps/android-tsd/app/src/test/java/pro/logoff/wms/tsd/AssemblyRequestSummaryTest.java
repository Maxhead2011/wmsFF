package pro.logoff.wms.tsd;
import org.junit.Test;
import static org.junit.Assert.*;
import pro.logoff.wms.tsd.network.TsdAssemblyRequestSummary;
public class AssemblyRequestSummaryTest {
 // TEST: show physical units rather than the item row count.
 @Test public void numberAndUnits() { TsdAssemblyRequestSummary r=new TsdAssemblyRequestSummary();r.number=2656;r.rowsCount=53;r.totalQuantity=636;assertEquals("Заявка WMS №002656 · 636 ед.",r.wmsSummary()); }
 // TEST: older servers must not fabricate a zero quantity or request number.
 @Test public void legacyServer() { assertEquals("Заявка WMS",new TsdAssemblyRequestSummary().wmsSummary()); }
 @Test public void emptyRequest() { TsdAssemblyRequestSummary r=new TsdAssemblyRequestSummary();r.number=1;r.totalQuantity=0;assertEquals("Заявка WMS №000001 · 0 ед.",r.wmsSummary()); }
}
