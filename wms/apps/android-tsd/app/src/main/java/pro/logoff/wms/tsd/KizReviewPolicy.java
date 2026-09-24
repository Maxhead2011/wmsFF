package pro.logoff.wms.tsd;
import pro.logoff.wms.tsd.auth.TsdSession;
import pro.logoff.wms.tsd.network.TsdKizLocationResponse.Review;

final class KizReviewPolicy {
    private KizReviewPolicy() {}
    // FIX: identical choices on desktop and TSD; server still rechecks evidence and permissions.
    static boolean canDecide(String flavor, TsdSession session, Review row, String resolution) {
        if (!KizLocationPolicy.canOpen(flavor,session) || row == null || !row.active || !"OPEN".equals(row.status)) return false;
        return "REUSE".equals(resolution) ? !"RELABEL".equals(row.decision) :
            "RELABEL".equals(resolution) && "RELABEL".equals(row.decision);
    }
}
