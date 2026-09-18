package pro.logoff.wms.tsd;

// FIX: announce transitions, not redraws; acceptance must come from the server.
final class FboPackingVoice {
    enum Cue { BOX, BARCODE, KIZ, PUT }
    private Cue last;
    private String acceptedId;
    Cue step(boolean active, boolean ready, String target, String barcode) {
        if (!active) { last = null; return null; }
        if (!ready) return null;
        Cue next = target.isEmpty() ? Cue.BOX : barcode.isEmpty() ? Cue.BARCODE : Cue.KIZ;
        if (next == last) return null;
        last = next;
        return next;
    }
    Cue accepted(String operationId) {
        if (operationId == null || operationId.equals(acceptedId)) return null;
        acceptedId = operationId;
        last = Cue.BARCODE; // Do not interrupt "put in box" with the next barcode prompt.
        return Cue.PUT;
    }
}
