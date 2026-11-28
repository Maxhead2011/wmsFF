package pro.logoff.wms.tsd;
import org.junit.Test;
import org.junit.runner.RunWith;
import org.robolectric.*;
import org.robolectric.annotation.*;
import android.os.Looper;
import java.time.Duration;
import static org.junit.Assert.*;
@RunWith(RobolectricTestRunner.class) @Config(sdk=28)
@LooperMode(LooperMode.Mode.PAUSED)
public class UpdateInstallFeedbackTest {
    public static class Probe extends MainActivity {
        int failures;
        @Override void managedUpdateStatus(String message, boolean failed) { if(failed) failures++; }
    }
    // TEST: a missing Android callback cannot leave the scanner barrier indefinitely.
    @Test public void missingCallbackTimesOutOnce() {
        Probe a=Robolectric.buildActivity(Probe.class).get();
        UpdateInstallFeedback.arm(a);
        Shadows.shadowOf(Looper.getMainLooper()).idleFor(Duration.ofSeconds(89));assertEquals(0,a.failures);
        Shadows.shadowOf(Looper.getMainLooper()).idleFor(Duration.ofSeconds(1));assertEquals(1,a.failures);
        Shadows.shadowOf(Looper.getMainLooper()).idleFor(Duration.ofSeconds(90));assertEquals(1,a.failures);
    }
    // TEST: confirmation/cancellation/result removes the pending timeout.
    @Test public void callbackCancelsTimeout() {
        Probe a=Robolectric.buildActivity(Probe.class).get();UpdateInstallFeedback.arm(a);UpdateInstallFeedback.clear(a);
        Shadows.shadowOf(Looper.getMainLooper()).idleFor(Duration.ofSeconds(91));assertEquals(0,a.failures);
    }
    // TEST: variant identity is taken from the installed context, not the compiler's build ID.
    @Test public void actionUsesInstalledPackage() throws Exception {
        MainActivity a=new MainActivity(){@Override public String getPackageName(){return "pro.logoff.wms.tsd.servers";}};
        var method=MainActivity.class.getDeclaredMethod("updateInstallAction");method.setAccessible(true);
        assertEquals("pro.logoff.wms.tsd.servers.UPDATE_INSTALL_STATUS",method.invoke(a));
    }
    // TEST: Android's confirmation/cancel path must release our UI and allow another menu attempt.
    @Test public void pendingConfirmationReleasesBarrier() throws Exception {
        try(var c=Robolectric.buildActivity(MainActivity.class).setup()) {
            MainActivity a=c.get();
            var busy=MainActivity.class.getDeclaredField("appUpdateBusy");busy.setAccessible(true);busy.set(a,true);
            var barrier=MainActivity.class.getDeclaredField("updateBarrier");barrier.setAccessible(true);
            barrier.set(a,new android.app.AlertDialog.Builder(a).setMessage("Updating").show());
            var receiver=MainActivity.class.getDeclaredField("updateInstallReceiver");receiver.setAccessible(true);
            android.content.Intent event=new android.content.Intent().putExtra(android.content.pm.PackageInstaller.EXTRA_STATUS,android.content.pm.PackageInstaller.STATUS_PENDING_USER_ACTION)
                .putExtra(android.content.Intent.EXTRA_INTENT,new android.content.Intent("test.CONFIRM"));
            ((android.content.BroadcastReceiver)receiver.get(a)).onReceive(a,event);
            assertNull(barrier.get(a));assertFalse((Boolean)busy.get(a));
            assertEquals("test.CONFIRM",Shadows.shadowOf(a).getNextStartedActivity().getAction());
        }
    }
}
