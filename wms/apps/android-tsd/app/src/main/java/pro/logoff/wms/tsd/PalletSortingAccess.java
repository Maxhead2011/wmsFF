package pro.logoff.wms.tsd;

import pro.logoff.wms.tsd.auth.TsdSession;

final class PalletSortingAccess {
    private PalletSortingAccess() {}

    static boolean canOpen(String flavor, TsdSession session) {
        // FIX: OWNER is above ADMIN; keep this workflow exclusive to our LOGOFF installation.
        return "logoff".equals(flavor) && session != null
            && (session.hasRole("OWNER") || session.hasRole("ADMIN"));
    }
}
