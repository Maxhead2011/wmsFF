package pro.logoff.wms.tsd;
import android.content.pm.Signature;
import org.junit.Test;
import org.junit.runner.RunWith;
import org.robolectric.RobolectricTestRunner;
import org.robolectric.annotation.Config;
import static org.junit.Assert.*;
@RunWith(RobolectricTestRunner.class) @Config(sdk=28)
@org.robolectric.annotation.LooperMode(org.robolectric.annotation.LooperMode.Mode.PAUSED)
public class ManagedApkInstallerTest {
    // TEST: the worker may finish before Android gives the newly shown barrier focus.
    @Test public void finalCheckWaitsForBarrierFocusDispatch(){
        java.util.concurrent.atomic.AtomicBoolean called=new java.util.concurrent.atomic.AtomicBoolean();
        android.os.Handler handler=new android.os.Handler(android.os.Looper.getMainLooper());
        ManagedApkInstaller.afterBarrierFocus(handler,()->called.set(true));
        org.robolectric.Shadows.shadowOf(android.os.Looper.getMainLooper()).idle();assertFalse(called.get());
        org.robolectric.Shadows.shadowOf(android.os.Looper.getMainLooper()).idleFor(java.time.Duration.ofMillis(150));assertTrue(called.get());
    }

    // TEST: the OEM path must not accidentally apply to unrelated devices.
    @Test public void selectsOnlySupportedManufacturers(){assertEquals("urovo",ManagedApkInstaller.route("Urovo"));assertEquals("unitech",ManagedApkInstaller.route("Unitech"));assertEquals("standard",ManagedApkInstaller.route("Google"));assertEquals("standard",ManagedApkInstaller.route(null));}
    // TEST: HT330 firmware identifies itself with the full vendor string.
    @Test public void recognizesHt330Firmware(){assertEquals("unitech",ManagedApkInstaller.route("Unitech_Electronics"));assertEquals("standard",ManagedApkInstaller.route("Unitech_Unknown"));}
    // TEST: Unitech returns SDK success0, not Android INSTALL_SUCCEEDED1.
    @Test public void unitechCallbackUsesSdkResult(){assertTrue(ManagedApkInstaller.unitechSucceeded(0));assertFalse(ManagedApkInstaller.unitechSucceeded(1));assertFalse(ManagedApkInstaller.unitechSucceeded(-1));}
    // TEST: an unsigned or differently signed APK cannot enter the privileged installer.
    @Test public void rejectsMissingAndForeignSigners(){Signature a=new Signature("aabb"),b=new Signature("ccdd");assertFalse(ManagedApkInstaller.sameSigners(null,new Signature[]{a}));assertFalse(ManagedApkInstaller.sameSigners(new Signature[]{a},new Signature[]{}));assertFalse(ManagedApkInstaller.sameSigners(new Signature[]{a},new Signature[]{b}));assertFalse(ManagedApkInstaller.sameSigners(new Signature[]{a,b},new Signature[]{a}));}
    @Test public void acceptsExactSignerSetRegardlessOfOrder(){Signature a=new Signature("aabb"),b=new Signature("ccdd");assertTrue(ManagedApkInstaller.sameSigners(new Signature[]{a},new Signature[]{a}));assertTrue(ManagedApkInstaller.sameSigners(new Signature[]{a,b},new Signature[]{b,a}));}
}
