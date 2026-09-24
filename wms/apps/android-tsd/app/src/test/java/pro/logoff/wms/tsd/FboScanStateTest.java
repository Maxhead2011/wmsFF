package pro.logoff.wms.tsd;
import org.junit.Test;
import java.util.Map;
import java.util.Arrays;
import java.util.Collections;
import pro.logoff.wms.tsd.network.TsdFboPlan;
import static org.junit.Assert.*;

public class FboScanStateTest {
    // TEST: packing retains the open box while collection continues; the collector keeps picking.
    @Test public void parallelPackingKeepsTargetAndBarcodeWithoutChangingPhase(){
        TsdFboPlan p=new TsdFboPlan();p.phase="PICKING";p.parallelPackingSupported=true;p.picked=1;
        p.route=Collections.emptyList();TsdFboPlan.Box box=new TsdFboPlan.Box();box.code="target";
        p.boxes=Collections.singletonList(box);TsdFboPlan.Line line=new TsdFboPlan.Line();line.barcode="sku";line.picked=1;
        p.lines=Collections.singletonList(line);FboScanState state=new FboScanState();state.target="target";state.barcode="sku";
        assertEquals("PACKING",FboScanState.screenPhase(p,true));assertEquals("PICKING",FboScanState.screenPhase(p,false));
        state.reconcile(p,true);assertEquals("target",state.target);assertEquals("sku",state.barcode);assertEquals("PICKING",p.phase);
        line.packed=1;state.reconcile(p,true);assertEquals("",state.barcode);
        p.parallelPackingSupported=false;assertEquals("PICKING",FboScanState.screenPhase(p,true));state.reconcile(p,true);assertEquals("",state.target);
    }

    // TEST: restoring navigation does not create a stock command and rejects stale source context.
    @Test public void restoresPositionAndBarcodeOnlyWhileStillNeeded(){
        FboScanState old=new FboScanState();old.pallet="P";old.source="B";old.barcode="sku";
        FboScanState restored=new FboScanState();restored.restoreCheckpoint(old.checkpoint());
        TsdFboPlan p=new TsdFboPlan();p.phase="PICKING";p.boxes=Collections.emptyList();
        TsdFboPlan.Route r=new TsdFboPlan.Route();r.pallet="P";r.boxCode="B";p.route=Collections.singletonList(r);
        TsdFboPlan.Line line=new TsdFboPlan.Line();line.barcode="sku";line.remaining=1;p.lines=Collections.singletonList(line);
        restored.reconcile(p);assertEquals("B",restored.source);assertEquals("sku",restored.barcode);assertNull(restored.pending());
        p.route=Collections.emptyList();restored.reconcile(p);assertEquals("",restored.source);assertEquals("",restored.barcode);
    }
    // TEST: labels distinguish rack bins only when enabled; sold WMS keeps its existing behavior.
    @Test public void reusableBinContentsAreNotCalledAShippingCarton() {
        TsdFboPlan plan=new TsdFboPlan();
        assertEquals("Короб забран целиком",FboScanState.wholePickTitle(plan,"FFL_LKBBOX_042"));
        plan.reusablePackingEnabled=true;
        assertEquals("Весь товар из бокса отобран",FboScanState.wholePickTitle(plan,"ffl_lkbbox_042"));
        assertEquals("Короб забран целиком",FboScanState.wholePickTitle(plan,"FFL_LKB0409_28"));
    }
    // TEST: detect repeats case-insensitively without blocking manual additions or resuming open cartons.
    @Test public void detectsPackedCartonAndPreservesManualMode() {
        TsdFboPlan plan=new TsdFboPlan();plan.reusablePackingEnabled=true;
        TsdFboPlan.Box box=new TsdFboPlan.Box();box.code="FFL_LKB0409_393";box.closed=true;box.quantity=15;
        plan.boxes=Collections.singletonList(box);
        assertTrue(FboScanState.alreadyPackedBox(plan,"ffl_lkb0409_393",false));
        assertFalse(FboScanState.alreadyPackedBox(plan,box.code,true));
        assertFalse(FboScanState.alreadyPackedBox(plan,"FFL_OTHER",false));
        box.closed=false;assertFalse(FboScanState.alreadyPackedBox(plan,box.code,false));
        box.closed=true;plan.reusablePackingEnabled=false;assertFalse(FboScanState.alreadyPackedBox(plan,box.code,false));
    }
    // TEST: a lost response and an app restart retain the same physical count and operation id.
    @Test public void wholeBoxRetryPreservesConfirmedQuantity() {
        FboScanState first=new FboScanState();first.source="BOX";
        Map<String,String> payload=first.prepare("PICK_BOX",null,19);
        FboScanState restarted=new FboScanState();restarted.restore(payload);
        assertEquals("19",payload.get("confirmedQuantity"));
        assertEquals(payload,restarted.prepare("PICK_BOX",null,18));
        restarted.accepted();assertNotEquals(payload.get("operationId"),restarted.prepare("PICK_BOX",null,18).get("operationId"));
    }

    // TEST: opening packing cannot start a pick; picking cannot pack or confirm boxes.
    @Test public void separatesPickingAndPackingWithoutChangingProgress() {
        for(String phase:Arrays.asList("NOT_STARTED","PICKING")) {
            assertTrue(FboScanState.phaseAllowed(false,phase));assertFalse(FboScanState.phaseAllowed(true,phase));
        }
        for(String phase:Arrays.asList("PACKING","CONTROL","COMPLETED")) {
            assertFalse(FboScanState.phaseAllowed(false,phase));assertTrue(FboScanState.phaseAllowed(true,phase));
        }
        assertFalse(FboScanState.phaseAllowed(true,null));assertFalse(FboScanState.phaseAllowed(false,"UNKNOWN"));
    }
    @Test public void retriesTheSameUnitWithoutGeneratingAnotherOperation() {
        // TEST: a lost server response must not turn a retry into a second physical pick.
        FboScanState state=new FboScanState();state.source="FFL_1";state.barcode="2051234567890";
        Map<String,String> first=state.prepare("PICK_UNIT","kiz");
        assertEquals(first,state.prepare("PICK_UNIT","another-kiz"));
        state.accepted();assertEquals("",state.barcode);
        assertNotEquals(first.get("operationId"),state.prepare("PICK_UNIT","kiz2").get("operationId"));
    }
    @Test public void restoresPendingCommandAfterRestartAndKeepsBarcodeOnRejectedKiz() {
        FboScanState old=new FboScanState();old.barcode="barcode";Map<String,String> command=old.prepare("PACK_UNIT","kiz");
        FboScanState restored=new FboScanState();restored.restore(command);assertEquals(command,restored.prepare("FINISH",null));
        old.rejected();assertEquals("barcode",old.barcode);assertNull(old.pending());
    }
    @Test public void requiresPalletBeforeBoxAndRejectsAnotherPalletBox() {
        // TEST: same picking navigation as FBS: pallet -> its required boxes -> unit scans.
        TsdFboPlan plan=new TsdFboPlan();TsdFboPlan.Route a=new TsdFboPlan.Route(),b=new TsdFboPlan.Route();
        a.pallet="PALET_SORT_27";a.boxCode="FFL_1";b.pallet="PALET_SORT_28";b.boxCode="FFL_2";plan.route=Arrays.asList(a,b);
        FboScanState s=new FboScanState();assertFalse(s.scanLocation(plan,"FFL_1"));assertTrue(s.scanLocation(plan,"PALET_SORT_27"));
        assertFalse(s.scanLocation(plan,"FFL_2"));assertTrue(s.scanLocation(plan,"ffl_1"));
        assertEquals("PALET_SORT_27",s.prepare("PICK_BOX",null).get("palletCode"));
    }
    @Test public void clearsClosedTargetAfterAnotherTerminalFinishesTheBox() {
        FboScanState s=new FboScanState();s.target="FFL_1";TsdFboPlan plan=new TsdFboPlan();plan.phase="PACKING";plan.route=Collections.emptyList();
        TsdFboPlan.Box b=new TsdFboPlan.Box();b.code="FFL_1";b.closed=true;plan.boxes=Collections.singletonList(b);
        s.reconcile(plan);assertEquals("",s.target);
    }
}
