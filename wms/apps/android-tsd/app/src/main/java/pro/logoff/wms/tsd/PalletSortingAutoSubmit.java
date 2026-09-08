package pro.logoff.wms.tsd;

// FIX: keyboard-wedge scanners without Enter must advance a complete barcode to the KIZ step.
// Explicit Enter/button still handles nonstandard barcodes. KIZs are never inferred from length.
final class PalletSortingAutoSubmit {
    interface Scheduler {
        void post(Runnable job, long delay);
        void remove(Runnable job);
    }
    private final Scheduler scheduler;
    private final Runnable submit;
    private Runnable pending;
    private long generation;

    PalletSortingAutoSubmit(Scheduler scheduler, Runnable submit) {
        this.scheduler = scheduler; this.submit = submit;
    }
    void changed(String value, boolean barcodeStep, boolean enabled) {
        cancel();
        if (!enabled || !barcodeStep || value == null || !value.trim().matches("[0-9]{8,14}")) return;
        long expected = generation;
        pending = () -> {
            if (expected != generation || pending == null) return;
            pending = null;
            generation++;
            submit.run();
        };
        scheduler.post(pending, 350L);
    }
    void cancel() {
        generation++;
        if (pending != null) scheduler.remove(pending);
        pending = null;
    }
}
