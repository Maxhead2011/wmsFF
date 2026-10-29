package pro.logoff.wms.tsd.sync;

public class TsdSyncSummary {
    public final int sent;
    public final int applied;
    public final int rejected;
    public final int retried;
    public final String message;
    public final java.util.List<pro.logoff.wms.tsd.network.TsdOperationResponse> kizConflicts;

    public TsdSyncSummary(int sent, int applied, int rejected, int retried, String message) {
        this(sent, applied, rejected, retried, message, java.util.Collections.emptyList());
    }

    public TsdSyncSummary(int sent, int applied, int rejected, int retried, String message,
        java.util.List<pro.logoff.wms.tsd.network.TsdOperationResponse> kizConflicts) {
        this.sent = sent;
        this.applied = applied;
        this.rejected = rejected;
        this.retried = retried;
        this.message = message;
        this.kizConflicts = java.util.Collections.unmodifiableList(new java.util.ArrayList<>(kizConflicts));
    }
}
