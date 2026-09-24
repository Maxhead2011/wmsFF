package pro.logoff.wms.tsd;
import android.app.Activity;
import android.os.Looper;
import android.widget.EditText;
import android.widget.LinearLayout;
import org.junit.Test;
import org.junit.runner.RunWith;
import org.robolectric.Robolectric;
import org.robolectric.RobolectricTestRunner;
import org.robolectric.Shadows;
import org.robolectric.annotation.Config;
import java.time.Duration;
import java.util.concurrent.atomic.AtomicBoolean;
import static org.junit.Assert.*;

@RunWith(RobolectricTestRunner.class) @Config(sdk=28)
public class AssemblyAutoFocusTest {
    // TEST: focus returns after scanner Enter, but never to an obsolete screen, busy field or background window.
    @Test public void restoresOnlyTheCurrentEnabledForegroundInput() {
        try(var c=Robolectric.buildActivity(Activity.class).setup().visible()) {
            Activity a=c.get();LinearLayout layout=new LinearLayout(a);
            EditText scan=new EditText(a),other=new EditText(a);layout.addView(scan);layout.addView(other);a.setContentView(layout);
            c.visible().windowFocusChanged(true);
            AtomicBoolean current=new AtomicBoolean(true);
            other.requestFocus();AssemblyAutoFocus.request(scan,current::get);
            Shadows.shadowOf(Looper.getMainLooper()).idleFor(Duration.ofMillis(100));
            assertEquals("logoff".equals(BuildConfig.FLAVOR),scan.hasFocus());
            other.requestFocus();AssemblyAutoFocus.request(scan,current::get);current.set(false);
            Shadows.shadowOf(Looper.getMainLooper()).idleFor(Duration.ofMillis(100));assertTrue(other.hasFocus());
            current.set(true);scan.setEnabled(false);AssemblyAutoFocus.request(scan);
            Shadows.shadowOf(Looper.getMainLooper()).idleFor(Duration.ofMillis(100));assertTrue(other.hasFocus());
            scan.setEnabled(true);c.windowFocusChanged(false);AssemblyAutoFocus.request(scan);
            Shadows.shadowOf(Looper.getMainLooper()).idleFor(Duration.ofMillis(100));assertTrue(other.hasFocus());
        }
    }
}
