package pro.logoff.wms.tsd;

// FIX: speak confirmed FBS stages once, sharing WB/Ozon and preserving sold flavors.
final class FbsStepVoice {
    private String last;

    FboPackingVoice.Cue step(String flavor, boolean ready, String owner, String task, String state) {
        if (!"logoff".equals(flavor) || !ready || task == null) return null;
        String key = owner + ":" + task + ":" + state;
        if (key.equals(last)) return null;
        last = key;
        if ("SCAN_BARCODE".equals(state) || "SCAN_SOURCE_BARCODE".equals(state))
            return FboPackingVoice.Cue.BARCODE;
        if ("SCAN_RELABEL_BARCODE".equals(state)) return FboPackingVoice.Cue.NEW_BARCODE;
        if ("SCAN_KIZ".equals(state) || "SCAN_NEW_KIZ".equals(state)) return FboPackingVoice.Cue.KIZ;
        if ("READY_TO_COMPLETE".equals(state) || "READY_TO_SUBMIT".equals(state)) return FboPackingVoice.Cue.PUT;
        return null;
    }
}
