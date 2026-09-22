package pro.logoff.wms.tsd;
import java.util.*;
import pro.logoff.wms.tsd.network.TsdFboPlan;
// FIX: count physical whole cartons once, independently of unit totals and new cartons.
final class FboPackingProgress {
    final List<String> waiting, scanned;
    FboPackingProgress(TsdFboPlan plan) {
        Set<String> done=new LinkedHashSet<>(), pending=new LinkedHashSet<>();
        if(plan!=null&&plan.boxes!=null)for(TsdFboPlan.Box b:plan.boxes)
            if(b.wholeBox&&b.closed&&b.quantity>0&&b.code!=null)done.add(b.code);
        if(plan!=null&&plan.wholeBoxes!=null)for(String code:plan.wholeBoxes)
            if(code!=null&&!done.contains(code))pending.add(code);
        waiting=new ArrayList<>(pending);scanned=new ArrayList<>(done);
    }
    int total(){return waiting.size()+scanned.size();}
}
