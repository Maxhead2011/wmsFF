package pro.logoff.wms.tsd;

// FIX: announce transitions, not redraws; acceptance must come from the server.
final class FboPackingVoice {
    enum Cue { BOX, BARCODE, KIZ, PUT, ERROR, CLOSED }
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
    // FIX: acknowledge a confirmed close once and avoid interrupting it on redraw.
    Cue closed(String operationId) {
        if (operationId == null || operationId.equals(acceptedId)) return null;
        acceptedId = operationId;
        last = Cue.BOX;
        return Cue.CLOSED;
    }
    Cue accepted(String operationId) {
        if (operationId == null || operationId.equals(acceptedId)) return null;
        acceptedId = operationId;
        last = Cue.BARCODE; // FIX: PUT recording includes the next barcode prompt; do not interrupt it.
        return Cue.PUT;
    }
}
