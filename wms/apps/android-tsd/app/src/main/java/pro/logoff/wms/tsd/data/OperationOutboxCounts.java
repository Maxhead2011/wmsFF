package pro.logoff.wms.tsd.data;

public class OperationOutboxCounts {
    public final int pending;
    public final int rejected;

    public OperationOutboxCounts(int pending, int rejected) {
        this.pending = pending;
        this.rejected = rejected;
    }
}
