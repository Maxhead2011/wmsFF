package pro.logoff.wms.tsd;

import java.util.ArrayList;
import java.util.List;
import pro.logoff.wms.tsd.network.TsdFboPlan;

// FIX: partition the server's remaining allocation without reallocating demand or changing progress.
final class FboPickingRoute {
    enum Mode { MENU, WHOLE_BOXES, PARTIAL }
    static boolean whole(TsdFboPlan plan, TsdFboPlan.Route row) {
        return row.wholeBox && !row.recount && !FboScanState.reusableBin(plan, row.boxCode);
    }
    static List<TsdFboPlan.Route> select(TsdFboPlan plan, Mode mode) {
        List<TsdFboPlan.Route> result=new ArrayList<>();
        if(plan==null||plan.route==null||mode==Mode.MENU)return result;
        for(TsdFboPlan.Route row:plan.route)
            if(whole(plan,row)==(mode==Mode.WHOLE_BOXES))result.add(row);
        return result;
    }
    static int quantity(List<TsdFboPlan.Route> route) {
        int quantity=0;for(TsdFboPlan.Route row:route)for(TsdFboPlan.Task task:row.tasks)quantity+=task.quantity;return quantity;
    }
}
