package pro.logoff.wms.tsd;

import java.util.function.BooleanSupplier;
import pro.logoff.wms.tsd.network.TsdFboPlan;

// FIX: watch asynchronous printing with read-only plan requests, without replaying actions.
final class LamodaPrintRefresh {
    interface Scheduler {
        void post(Runnable action, long delayMs);
        void cancel(Runnable action);
    }
    private final Scheduler scheduler;
    private final BooleanSupplier canRead;
    private final Runnable read;
    private boolean watching, scheduled, closed;
    private int failures;
    private final Runnable tick = this::tick;

    LamodaPrintRefresh(Scheduler scheduler, BooleanSupplier canRead, Runnable read) {
        this.scheduler = scheduler; this.canRead = canRead; this.read = read;
    }

    void observe(TsdFboPlan plan, String brand) {
        watching = false;
        if (!closed && "logoff".equals(brand) && plan != null &&
                "LAMODA".equals(plan.marketplace) && plan.relabelRequired && plan.relabelUnits != null) {
            for (TsdFboPlan.RelabelUnit unit : plan.relabelUnits) {
                if ("QUEUED".equals(unit.printStatus) || "CLAIMED".equals(unit.printStatus)) {
                    watching = true; break;
                }
            }
        }
        failures = 0;
        if (watching) schedule(2000); else cancel();
    }

    // A transient GET failure keeps watching; it never queues another print.
    void failed() { if (watching) schedule(Math.min(15000, 2000L << Math.min(++failures, 3))); }

    private void tick() {
        scheduled = false;
        if (closed || !watching) return;
        if (!canRead.getAsBoolean()) { schedule(2000); return; }
        read.run(); // Completion must call observe or failed; no overlapping requests.
    }
    private void schedule(long delay) {
        if (!closed && !scheduled) { scheduled = true; scheduler.post(tick, delay); }
    }
    private void cancel() { scheduler.cancel(tick); scheduled = false; }
    void close() { closed = true; watching = false; cancel(); }
}
