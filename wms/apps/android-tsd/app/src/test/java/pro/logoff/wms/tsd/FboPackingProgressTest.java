package pro.logoff.wms.tsd;
import org.junit.Test;import static org.junit.Assert.*;import java.util.*;import pro.logoff.wms.tsd.network.TsdFboPlan;
public class FboPackingProgressTest {
    private TsdFboPlan.Box box(String code,boolean whole,boolean closed,int quantity){TsdFboPlan.Box b=new TsdFboPlan.Box();b.code=code;b.wholeBox=whole;b.closed=closed;b.quantity=quantity;return b;}
    // TEST: totals use cartons, not pieces, and exclude newly assembled/reopened cartons.
    @Test public void countsDistinctWholeCartonsOnly(){TsdFboPlan p=new TsdFboPlan();p.wholeBoxes=Arrays.asList("A","A","B");p.boxes=Arrays.asList(box("B",true,true,12),box("B",true,true,12),box("NEW",false,true,50),box("OPEN",true,false,5));FboPackingProgress x=new FboPackingProgress(p);assertEquals(Arrays.asList("A"),x.waiting);assertEquals(Arrays.asList("B"),x.scanned);assertEquals(2,x.total());p.wholeBoxes=Collections.emptyList();assertEquals(1,new FboPackingProgress(p).total());assertEquals(0,new FboPackingProgress(null).total());}
    // TEST: retry overrides stale success; sold flavor stays white; final result restores feedback.
    @Test public void retryAndResultColors(){assertEquals(0xffffffcc,AssemblyScreenFeedback.background(true,true,0xffbbf7d0));assertEquals(0xffccffcc,AssemblyScreenFeedback.background(true,false,0xffbbf7d0));assertEquals(0xffff9494,AssemblyScreenFeedback.background(true,false,0xfffecaca));assertEquals(0xffffffff,AssemblyScreenFeedback.background(false,true,0xfffecaca));assertEquals(0xffffffff,AssemblyScreenFeedback.background(true,false,0));}
}
