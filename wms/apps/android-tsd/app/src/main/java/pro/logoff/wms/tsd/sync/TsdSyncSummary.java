package pro.logoff.wms.tsd.sync;

public class TsdSyncSummary {
    public final int sent;
    public final int applied;
    public final int rejected;
    public final int retried;
    public final String message;

    public TsdSyncSummary(int sent, int applied, int rejected, int retried, String message) {
        this.sent = sent;
        this.applied = applied;
        this.rejected = rejected;
        this.retried = retried;
        this.message = message;
    }
}
