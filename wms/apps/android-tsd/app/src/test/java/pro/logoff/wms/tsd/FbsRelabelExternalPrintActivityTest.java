package pro.logoff.wms.tsd;

import android.widget.EditText;
import java.util.Arrays;
import org.junit.Test;
import org.junit.runner.RunWith;
import org.robolectric.Robolectric;
import org.robolectric.RobolectricTestRunner;
import org.robolectric.annotation.Config;
import pro.logoff.wms.tsd.network.TsdFbsAssemblyResponse;
import static org.junit.Assert.*;

@RunWith(RobolectricTestRunner.class) @Config(sdk=28)
public class FbsRelabelExternalPrintActivityTest {
    private static void set(Object target, String name, Object value) throws Exception {
        var field=MainActivity.class.getDeclaredField(name); field.setAccessible(true); field.set(target,value);
    }
    private static Object get(Object target, String name) throws Exception {
        var field=MainActivity.class.getDeclaredField(name); field.setAccessible(true); return field.get(target);
    }
    // TEST: labels printed in WMS/NiceLabel must remain scannable without an agent ACK.
    @Test public void scannerRemainsEnabledAndFocusedForEveryPrintStatus() throws Exception {
        try(var controller=Robolectric.buildActivity(MainActivity.class).setup()) {
            var activity=controller.get();
            var response=new TsdFbsAssemblyResponse();
            response.state="SCAN_RELABEL_BARCODE";
            response.task=new TsdFbsAssemblyResponse.Task();
            response.task.id="task-1317"; response.task.marketplace="WILDBERRIES";
            response.task.product=new TsdFbsAssemblyResponse.Product();
            response.task.product.barcodes=Arrays.asList("2048339302189");
            response.task.relabeling=new TsdFbsAssemblyResponse.Relabeling();
            response.task.relabeling.required=true;
            response.task.relabeling.sourceBarcode="2044824215095";
            set(activity,"fbsAssembly",response);
            set(activity,"fbsRelabelPrintTaskId",response.task.id);
            var render=MainActivity.class.getDeclaredMethod("renderFbsAssemblyScreen"); render.setAccessible(true);
            var submit=MainActivity.class.getDeclaredMethod("submitFbsScan"); submit.setAccessible(true);
            for(String status:Arrays.asList("","QUEUED","CLAIMED","FAILED","PRINTED")) {
                set(activity,"fbsRelabelPrintStatus",status);
                render.invoke(activity);
                EditText input=(EditText)get(activity,"fbsScanInput");
                assertTrue(status,input.isEnabled());
                assertTrue(status,input.hasFocus());
                submit.invoke(activity);
                assertEquals("Сначала отсканируйте код.",get(activity,"statusMessage"));
            }
        }
    }
}
