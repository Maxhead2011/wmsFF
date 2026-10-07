package pro.logoff.wms.tsd;

import java.util.*;
import org.junit.Test;
import pro.logoff.wms.tsd.network.TsdFboPlan;
import static org.junit.Assert.*;

public class FboPickingRouteTest {
    // TEST: every allocated row appears exactly once; quantities and the original route order are retained.
    @Test public void partitionPreservesAllocationIncludingMixedTasksAndBins(){
        TsdFboPlan p=new TsdFboPlan();p.reusablePackingEnabled=true;
        TsdFboPlan.Route partial=row("PARTIAL",false,false,3),whole=row("WHOLE",true,false,16),bin=row("FFL_LKBBOX_15",true,false,4),recount=row("COUNT",true,true,2);
        p.route=Arrays.asList(partial,whole,bin,recount);
        assertEquals(Collections.singletonList(whole),FboPickingRoute.select(p,FboPickingRoute.Mode.WHOLE_BOXES));
        assertEquals(Arrays.asList(partial,bin,recount),FboPickingRoute.select(p,FboPickingRoute.Mode.PARTIAL));
        assertEquals(9,FboPickingRoute.quantity(FboPickingRoute.select(p,FboPickingRoute.Mode.PARTIAL)));
        assertEquals(25,FboPickingRoute.quantity(p.route));assertEquals(4,p.route.size());
    }
    // TEST: pallet-less boxes and pallets shared by both routes cannot admit the other mode's box.
    @Test public void locationValidationUsesThePartition(){
        TsdFboPlan p=new TsdFboPlan();TsdFboPlan.Route a=row("A",true,false,2),b=row("B",false,false,1);
        p.route=Arrays.asList(a,b);FboScanState s=new FboScanState();
        assertFalse(s.scanLocation(FboPickingRoute.select(p,FboPickingRoute.Mode.WHOLE_BOXES),"B"));
        assertTrue(s.scanLocation(FboPickingRoute.select(p,FboPickingRoute.Mode.WHOLE_BOXES)," a "));
        s.source="";a.pallet="P";b.pallet="P";
        assertTrue(s.scanLocation(FboPickingRoute.select(p,FboPickingRoute.Mode.PARTIAL),"P"));
        assertFalse(s.scanLocation(FboPickingRoute.select(p,FboPickingRoute.Mode.PARTIAL),"A"));
        assertTrue(s.scanLocation(FboPickingRoute.select(p,FboPickingRoute.Mode.PARTIAL),"B"));
    }
    private TsdFboPlan.Route row(String code,boolean whole,boolean recount,int quantity){
        TsdFboPlan.Route r=new TsdFboPlan.Route();r.boxCode=code;r.pallet="";r.wholeBox=whole;r.recount=recount;
        TsdFboPlan.Task t=new TsdFboPlan.Task();t.quantity=quantity;r.tasks=Collections.singletonList(t);return r;
    }
}
