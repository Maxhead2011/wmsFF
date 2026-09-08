package pro.logoff.wms.tsd;

import org.junit.Test;
import java.util.ArrayList;
import java.util.List;
import static org.junit.Assert.*;

public class PalletSortingAutoSubmitTest {
    // TEST: fake clock exercises the actual debounce controller used by the Android field.
    private static class Clock implements PalletSortingAutoSubmit.Scheduler {
        List<Runnable> jobs = new ArrayList<>();
        public void post(Runnable job, long delay) { assertEquals(350L, delay); jobs.add(job); }
        public void remove(Runnable job) { jobs.remove(job); }
        void flush() { List<Runnable> copy = new ArrayList<>(jobs); jobs.clear(); for (Runnable job : copy) job.run(); }
    }
    @Test public void barcodeWithoutEnterIsSubmittedOnceAfterTheLastCharacter() {
        Clock clock = new Clock(); int[] sent = {0};
        PalletSortingAutoSubmit scan = new PalletSortingAutoSubmit(clock, () -> sent[0]++);
        scan.changed("205175437963", true, true);
        scan.changed("2051754379636", true, true);
        assertEquals(0, sent[0]); assertEquals(1, clock.jobs.size());
        clock.flush(); clock.flush(); assertEquals(1, sent[0]);
    }
    @Test public void enterOrRerenderCancelsTheOldBarcodeCallback() {
        Clock clock = new Clock(); int[] sent = {0};
        PalletSortingAutoSubmit scan = new PalletSortingAutoSubmit(clock, () -> sent[0]++);
        scan.changed("2051754379636", true, true); Runnable stale = clock.jobs.get(0);
        scan.cancel(); stale.run(); clock.flush(); assertEquals(0, sent[0]);
    }
    @Test public void noAutomaticSubmissionForKizSourceBoxBusyOrIncompleteInput() {
        Clock clock = new Clock(); int[] sent = {0};
        PalletSortingAutoSubmit scan = new PalletSortingAutoSubmit(clock, () -> sent[0]++);
        scan.changed("2051754379636", false, true); // KIZ step or box selection
        scan.changed("2051754379636", true, false); // busy, confirmation, uncertain request
        scan.changed("123", true, true);
        scan.changed("FFL_LKB0207_49", true, true);
        scan.changed("", true, true);
        clock.flush(); assertEquals(0, sent[0]);
    }
    @Test public void cancelAndAnotherUnitNeverReuseThePreviousScan() {
        Clock clock = new Clock(); int[] sent = {0};
        PalletSortingAutoSubmit scan = new PalletSortingAutoSubmit(clock, () -> sent[0]++);
        scan.changed("2051754379636", true, true); Runnable stale = clock.jobs.get(0);
        scan.changed("2051754379637", true, true); stale.run();
        assertEquals(0, sent[0]); clock.flush(); assertEquals(1, sent[0]);
    }
}
