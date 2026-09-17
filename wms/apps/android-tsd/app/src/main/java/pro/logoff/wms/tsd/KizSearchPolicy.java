package pro.logoff.wms.tsd;
import pro.logoff.wms.tsd.auth.TsdSession;
import pro.logoff.wms.tsd.network.TsdKizSearch;

// FIX: only our installation exposes this separate physical-search workflow.
final class KizSearchPolicy {
    static boolean canOpen(String flavor, TsdSession session) {
        return "logoff".equals(flavor) && session != null &&
            (!session.hasRole("WAREHOUSE_KEEPER") || session.hasRole("ADMIN") || session.hasRole("OWNER") ||
             session.hasRole("MANAGER") || session.hasRole("OPERATOR") || session.hasRole("BRANCH_MANAGER"));
    }
    static boolean containsBox(TsdKizSearch task, String scan) {
        if (task == null || task.items == null) return false;
        for (TsdKizSearch.Item item : task.items) if (scan.equals(item.boxCode)) return true;
        return false;
    }
    static boolean ready(String scan) { return scan != null && scan.trim().length() >= 10; }
}
