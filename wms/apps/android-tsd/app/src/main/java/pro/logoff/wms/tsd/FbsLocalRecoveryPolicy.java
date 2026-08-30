package pro.logoff.wms.tsd;

final class FbsLocalRecoveryPolicy {
    private FbsLocalRecoveryPolicy() {
    }

    // FIX: WB no longer returns a sticker after an order reaches complete/shipped.
    // Only the explicit local recovery flow may finish without downloading it.
    static boolean canCompleteWithoutSticker(
        String marketplace,
        boolean emergencyAssembly,
        boolean wbMutationAllowed
    ) {
        return "WILDBERRIES".equalsIgnoreCase(marketplace)
            && emergencyAssembly
            && !wbMutationAllowed;
    }
}
