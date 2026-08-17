package pro.logoff.wms.tsd;

final class FbsPalletRouteUi {
    private FbsPalletRouteUi() {}

    // ADDED: Keep the pallet route open only for a complete PALLET_BOXES response.
    static boolean isPalletRouteOpen(String state, boolean hasPalletScan) {
        return "PALLET_BOXES".equals(state) && hasPalletScan;
    }
}
