package pro.logoff.wms.tsd;

// FIX: announce transitions, not redraws; acceptance must come from the server.
final class FboPackingVoice {
    enum Cue { BOX, BARCODE, KIZ, PUT, ERROR, CLOSED, NEW_BARCODE, PACKED_BOX } // FIX: confirmed carton success.
    private Cue last;
    private String acceptedId;
    // FIX: announce confirmed whole-carton packing once per accepted operation.
    Cue boxAccepted(String operationId) {
        if (operationId == null || operationId.equals(acceptedId)) return null;
        acceptedId = operationId;
        return Cue.PACKED_BOX;
    }
    Cue step(boolean active, boolean ready, String target, String barcode) {
        if (!active) { last = null; return null; }
        if (!ready) return null;
        Cue next = target.isEmpty() ? Cue.BOX : barcode.isEmpty() ? Cue.BARCODE : Cue.KIZ;
        return transition(next);
    }
    // FIX: Ozon product mode scans the destination after barcode and optional KIZ.
    Cue productStep(boolean ready, String barcode, boolean productReady) {
        if (!ready) return null;
        return transition(barcode.isEmpty() ? Cue.BARCODE : productReady ? Cue.BOX : Cue.KIZ);
    }
    private Cue transition(Cue next) {
        if (next == last) return null;
        last = next;
        return next;
    }
    // FIX: acknowledge a confirmed close once and avoid interrupting it on redraw.
    Cue closed(String operationId) { return closed(operationId,false); }
    Cue closed(String operationId, boolean productMode) {
        if (operationId == null || operationId.equals(acceptedId)) return null;
        acceptedId = operationId;
        last = productMode ? Cue.BARCODE : Cue.BOX;
        return Cue.CLOSED;
    }
    Cue accepted(String operationId) {
        if (operationId == null || operationId.equals(acceptedId)) return null;
        acceptedId = operationId;
        last = Cue.BARCODE; // FIX: PUT recording includes the next barcode prompt; do not interrupt it.
        return Cue.PUT;
    }
}
