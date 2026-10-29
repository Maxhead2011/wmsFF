package pro.logoff.wms.tsd;

import org.junit.Test;
import static org.junit.Assert.assertEquals;
import java.util.Arrays;
import pro.logoff.wms.tsd.network.TsdFbsAssemblyResponse;
import pro.logoff.wms.tsd.network.TsdFboPlan;

public class ClientProductDisplayTest {
    // TEST: a server without presentation settings still identifies loose stock, including leading-zero barcodes.
    @Test public void looseFboLineKeepsLegacyIdentityAndConfiguredCaption() {
        TsdFboPlan.Line line=new TsdFboPlan.Line();line.name="Monitor";line.article="Hawkeye";line.size="M";line.barcode="00123";
        assertEquals("Monitor · Hawkeye · M · 00123",line.displayLabel());
        line.productDisplayText="Hawkeye · 00123";
        assertEquals("Hawkeye · 00123",line.displayLabel());
        line.productDisplayText=" ";assertEquals("Monitor · Hawkeye · M · 00123",line.displayLabel());
        assertEquals("00123",line.barcode);
        assertEquals("Товар",new TsdFboPlan.Line().displayLabel());
    }
    @Test public void fbsPresentationKeepsScannerDataAndLegacyDefault() {
        // TEST: hiding a barcode affects its caption only, including a leading zero.
        TsdFbsAssemblyResponse.Product p = new TsdFbsAssemblyResponse.Product();
        p.name = "Название"; p.article = "Артикул"; p.barcodes = Arrays.asList("00123");
        assertEquals("Артикул", p.displayLabel(p.article));
        p.productDisplayText = "Артикул · M";
        assertEquals("Артикул · M", p.displayLabel(p.article));
        assertEquals("00123", p.barcodes.get(0));
        assertEquals("Название", p.name);
    }
    @Test public void fboPresentationKeepsQuantityAndBarcode() {
        TsdFboPlan.Task task = new TsdFboPlan.Task();
        task.name = "Название"; task.barcode = "00123"; task.quantity = 3;
        assertEquals("Название", task.displayLabel(task.name));
        task.productDisplayText = "Красный · L";
        assertEquals("Красный · L", task.displayLabel(task.name));
        assertEquals("00123", task.barcode);
        assertEquals(3, task.quantity);
    }
}
