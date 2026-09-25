package pro.logoff.wms.tsd;

import java.util.Arrays;
import org.junit.Test;
import org.junit.runner.RunWith;
import org.robolectric.Robolectric;
import org.robolectric.RobolectricTestRunner;
import org.robolectric.annotation.Config;
import pro.logoff.wms.tsd.network.TsdFbsAssemblyResponse;
import static org.junit.Assert.*;

@RunWith(RobolectricTestRunner.class)
@Config(sdk = 28)
public class OzonPickLinesDisplayTest {
    // TEST: real quantity renderer shows the missing article, not only a misleading grand total.
    @Test public void showsEachArticleAndOwnProgress() throws Exception {
        try (var controller = Robolectric.buildActivity(MainActivity.class).setup()) {
            var task = new TsdFbsAssemblyResponse.Task();
            task.itemCount = 2; task.scannedItemCount = 1; task.perUnitScanning = true;
            var first = new TsdFbsAssemblyResponse.OzonLine();
            first.article = "Freestyle"; first.quantity = 1; first.scanned = 1;
            var second = new TsdFbsAssemblyResponse.OzonLine();
            second.article = "Champion"; second.quantity = 1; second.scanned = 0;
            task.ozonLines = Arrays.asList(first, second);
            var method = MainActivity.class.getDeclaredMethod("ozonQuantityInstruction", TsdFbsAssemblyResponse.Task.class);
            method.setAccessible(true);
            String text = (String) method.invoke(controller.get(), task);
            if ("logoff".equals(BuildConfig.FLAVOR)) {
                assertTrue(text.contains("Freestyle: 1 / 1"));
                assertTrue(text.contains("Champion: 0 / 1"));
            } else {
                assertFalse(text.contains("Freestyle"));
            }
            task.ozonLines = null;
            assertFalse(((String) method.invoke(controller.get(), task)).contains("Champion"));
        }
    }
}
