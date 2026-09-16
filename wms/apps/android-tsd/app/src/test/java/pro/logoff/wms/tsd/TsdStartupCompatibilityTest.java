package pro.logoff.wms.tsd;

import android.widget.EditText;
import org.junit.Test;
import org.junit.runner.RunWith;
import org.robolectric.Robolectric;
import org.robolectric.RobolectricTestRunner;
import org.robolectric.android.controller.ActivityController;
import org.robolectric.annotation.Config;
import org.robolectric.annotation.GraphicsMode;
import static org.junit.Assert.*;

@RunWith(RobolectricTestRunner.class)
@Config(sdk={24,26,28,30})
@GraphicsMode(GraphicsMode.Mode.LEGACY)
public class TsdStartupCompatibilityTest {
    @Test public void coldStartReachesUsableLoginOnSupportedAndroidVersions() throws Exception {
        // TEST: exercise actual startup; a caught exception and fatal screen is also a failure.
        try(ActivityController<MainActivity> controller=Robolectric.buildActivity(MainActivity.class)) {
            MainActivity activity=controller.setup().get();
            for(String name:new String[]{"deviceCodeInput","deviceSecretInput"}) {
                java.lang.reflect.Field field=MainActivity.class.getDeclaredField(name);
                field.setAccessible(true);
                assertNotNull("Startup failed before login field: "+name,(EditText)field.get(activity));
            }
            assertFalse(activity.isFinishing());
        }
    }
}
