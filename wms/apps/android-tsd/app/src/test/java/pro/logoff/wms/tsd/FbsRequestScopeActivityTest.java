package pro.logoff.wms.tsd;

import java.lang.reflect.Field;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.concurrent.AbstractExecutorService;
import java.util.concurrent.TimeUnit;
import org.junit.Test;
import org.junit.runner.RunWith;
import org.robolectric.Robolectric;
import org.robolectric.RobolectricTestRunner;
import org.robolectric.android.controller.ActivityController;
import org.robolectric.annotation.Config;
import pro.logoff.wms.tsd.network.TsdFbsAssemblyResponse;
import static org.junit.Assert.*;

@RunWith(RobolectricTestRunner.class) @Config(sdk=28)
public class FbsRequestScopeActivityTest {
    // TEST: reopening FBS after a restart must restore the selected request with the pending scan.
    @Test public void pendingRenderRestoresKorolevRequestInsteadOfGlobalQueue() throws Exception {
        try (var controller = activity()) {
            MainActivity activity = controller.get();
            savePending(activity);
            call(activity, "renderFbsAssemblyScreen");
            if ("logoff".equals(BuildConfig.FLAVOR)) {
                assertEquals("request-korolev", get(activity, "selectedFbsRequestId"));
                assertEquals("WILDBERRIES", get(activity, "fbsMarketplaceFilter"));
            } else {
                assertEquals("", get(activity, "selectedFbsRequestId"));
            }
            clear(activity);
        }
    }

    // TEST: retry can be invoked without a preceding render; it must retain the same request too.
    @Test public void directRetryRestoresPendingRequestAndMarketplace() throws Exception {
        try (var controller = activity()) {
            MainActivity activity = controller.get();
            savePending(activity);
            call(activity, "retryFbsAction");
            assertEquals("logoff".equals(BuildConfig.FLAVOR) ? "request-korolev" : "",
                get(activity, "selectedFbsRequestId"));
            if ("logoff".equals(BuildConfig.FLAVOR)) {
                assertEquals("WILDBERRIES", get(activity, "fbsMarketplaceFilter"));
                assertEquals("order-korolev", ((TsdFbsAssemblyResponse)get(activity, "fbsAssembly")).task.orderId);
            }
            clear(activity);
        }
    }

    // TEST: the observed empty requestId after completion must open selection, not Balandin/Ozon or Lukin/WB.
    @Test public void completedTaskWithoutSelectionReturnsToChoicesOnlyForLogoff() throws Exception {
        try (var controller = activity()) {
            MainActivity activity = controller.get();
            TsdFbsAssemblyResponse completed = response(); completed.state = "COMPLETED";
            set(activity, "fbsAssembly", completed);
            call(activity, "loadNextFbsAssembly");
            assertEquals("logoff".equals(BuildConfig.FLAVOR) ? "FBS_REQUESTS" : "FBS_ASSEMBLY",
                get(activity, "screen").toString());
            assertEquals("", get(activity, "selectedFbsRequestId"));
            clear(activity);
        }
    }

    // TEST: completion stays on the selected request; its empty result can still show "отбор завершён".
    @Test public void completedSelectedRequestDoesNotAutomaticallyReturnToChoices() throws Exception {
        try (var controller = activity()) {
            MainActivity activity = controller.get();
            TsdFbsAssemblyResponse completed = response(); completed.state = "COMPLETED";
            set(activity, "fbsAssembly", completed);
            set(activity, "selectedFbsRequestId", "request-korolev");
            call(activity, "loadNextFbsAssembly");
            assertEquals("FBS_ASSEMBLY", get(activity, "screen").toString());
            assertEquals("request-korolev", get(activity, "selectedFbsRequestId"));
            clear(activity);
        }
    }

    private ActivityController<MainActivity> activity() throws Exception {
        var controller = Robolectric.buildActivity(MainActivity.class);
        // TEST: capture background work without executing HTTP or opening a warehouse task.
        set(controller.get(), "executor", new QueuedExecutor());
        set(controller.get(), "monitorExecutor", new QueuedExecutor());
        controller.setup();
        MainActivity activity = controller.get(); clear(activity);
        activity.getSharedPreferences("logoff_wms_tsd_session", 0).edit()
            .putString("access_token", "test").putString("device_code", "TEST")
            .putString("user_id", "scope-worker").putString("user_name", "Test")
            .putString("role_codes", "OPERATOR").commit();
        return controller;
    }
    private TsdFbsAssemblyResponse response() {
        TsdFbsAssemblyResponse result = new TsdFbsAssemblyResponse(); result.state = "READY_TO_COMPLETE";
        result.task = new TsdFbsAssemblyResponse.Task(); result.task.id = "task-korolev";
        result.task.requestId = "request-korolev"; result.task.orderId = "order-korolev";
        result.task.marketplace = "WILDBERRIES"; return result;
    }
    private void savePending(MainActivity activity) {
        assertTrue(FbsPendingAction.create("complete", null, null, response(), Map.of())
            .save(activity.getSharedPreferences("fbs-pending", 0), "scope-worker"));
    }
    private void clear(MainActivity activity) {
        activity.getSharedPreferences("fbs-pending", 0).edit().clear().commit();
        activity.getSharedPreferences("logoff_wms_tsd_session", 0).edit().clear().commit();
    }
    private Object get(MainActivity activity, String name) throws Exception {
        Field field = MainActivity.class.getDeclaredField(name); field.setAccessible(true); return field.get(activity);
    }
    private void set(MainActivity activity, String name, Object value) throws Exception {
        Field field = MainActivity.class.getDeclaredField(name); field.setAccessible(true); field.set(activity, value);
    }
    private void call(MainActivity activity, String name) throws Exception {
        var method = MainActivity.class.getDeclaredMethod(name); method.setAccessible(true); method.invoke(activity);
    }
    private static final class QueuedExecutor extends AbstractExecutorService {
        final List<Runnable> work = new ArrayList<>(); boolean stopped;
        public void execute(Runnable command) { work.add(command); }
        public void shutdown() { stopped = true; }
        public List<Runnable> shutdownNow() { stopped = true; return new ArrayList<>(work); }
        public boolean isShutdown() { return stopped; }
        public boolean isTerminated() { return stopped; }
        public boolean awaitTermination(long timeout, TimeUnit unit) { return stopped; }
    }
}
