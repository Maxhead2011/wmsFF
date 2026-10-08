package pro.logoff.wms.tsd;

import java.util.*;
import pro.logoff.wms.tsd.network.*;

// FIX: replace counters with authoritative state; retries never increment twice.
public final class FboPackingReceipt {
    public static class State {
        public int version,needed,picked,packed,looseRemaining;
        public String requestId,phase;
        public List<TsdFboPlan.Line> lines;
        public List<TsdFboPlan.Box> boxes;
        public List<String> wholeBoxes;
    }
    static boolean apply(TsdFboPlan plan, State next, boolean packing, String brand) {
        if(!packing||!"logoff".equals(brand)||plan==null||next==null||next.version!=1||
            !Objects.equals(plan.requestId,next.requestId)||!Objects.equals(plan.phase,next.phase)||
            !("PACKING".equals(next.phase)||"PICKING".equals(next.phase))||next.lines==null||next.boxes==null||next.wholeBoxes==null||
            next.picked<0||next.packed<0||next.needed<0||next.looseRemaining<0||next.packed>next.picked)return false;
        plan.lines=next.lines;plan.boxes=next.boxes;plan.wholeBoxes=next.wholeBoxes;
        plan.needed=next.needed;plan.picked=next.picked;plan.packed=next.packed;plan.looseRemaining=next.looseRemaining;
        return true;
    }
}
