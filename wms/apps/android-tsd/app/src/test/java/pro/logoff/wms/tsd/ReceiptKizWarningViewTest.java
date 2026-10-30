package pro.logoff.wms.tsd;
import android.app.Activity;
import android.graphics.drawable.ColorDrawable;
import android.widget.LinearLayout;
import android.widget.TextView;
import org.junit.Test;
import org.junit.runner.RunWith;
import org.robolectric.Robolectric;
import org.robolectric.RobolectricTestRunner;
import org.robolectric.annotation.Config;
import pro.logoff.wms.tsd.network.*;
import static org.junit.Assert.*;

@RunWith(RobolectricTestRunner.class) @Config(sdk=28)
public class ReceiptKizWarningViewTest {
    // TEST: actual red widgets retain original receipt evidence, not current-box substitution.
    @Test public void duplicateIsVisibleAndDoesNotInventReceiptDate() {
        try(var controller=Robolectric.buildActivity(Activity.class).setup()) {
            LinearLayout root=new LinearLayout(controller.get());
            TsdOperationResponse conflict=new TsdOperationResponse(); conflict.duplicateInfo=new TsdKizDuplicateInfo();
            conflict.duplicateInfo.firstBoxCode="ORIGINAL";conflict.duplicateInfo.currentBoxCode="CURRENT";
            conflict.duplicateInfo.productName="Костюм XS";conflict.duplicateInfo.currentStatus="SHIPPING";
            ReceiptKizWarningView.render(root,conflict);
            assertEquals(ReceiptKizWarningView.BACKGROUND,((ColorDrawable)root.getBackground()).getColor());
            assertEquals("ОТЛОЖИТЕ ТОВАР",((TextView)root.getChildAt(0)).getText().toString());
            StringBuilder all=new StringBuilder();for(int i=0;i<root.getChildCount();i++)all.append(((TextView)root.getChildAt(i)).getText()).append('\n');
            assertTrue(all.toString().contains("первоначальная приёмка не установлена"));
            assertTrue(all.toString().contains("Короб при приёмке: ORIGINAL"));
            assertTrue(all.toString().contains("Текущий короб: CURRENT"));
            assertTrue(all.toString().contains("подготовлен к отгрузке"));
            assertTrue(all.toString().contains("Количество не увеличено"));
        }
    }
    @Test public void receiptTimeIsMoscowAndInvalidTimeIsNotFabricated() {
        assertEquals("29.10.2026 15:01:02 МСК",ReceiptKizWarningView.date("2026-10-29T12:01:02Z"));
        assertTrue(ReceiptKizWarningView.date("bad").contains("не установлена"));
    }

    // TEST: the actual receipt handler cannot dismiss the stop or add stock on rapid scanner input.
    @Test public void mainReceiptKeepsStopUntilExplicitAction() throws Exception {
        if (!"logoff".equals(BuildConfig.FLAVOR)) return;
        try(var controller=Robolectric.buildActivity(MainActivity.class).create()) {
            MainActivity activity=controller.get();
            java.lang.reflect.Method show=MainActivity.class.getDeclaredMethod("showReceiptKizConflict",String.class,TsdKizDuplicateInfo.class,String.class,String.class,boolean.class);
            show.setAccessible(true);show.invoke(activity,"010464068426237821AbCdEf1234567",new TsdKizDuplicateInfo(),"duplicate","op",true);
            for(String method:new String[]{"handleReceiptBarcodeScan","handleReceiptKizScan","submitReceiptInput"}) {
                java.lang.reflect.Method action=MainActivity.class.getDeclaredMethod(method);action.setAccessible(true);action.invoke(activity);
            }
            java.lang.reflect.Field conflicts=MainActivity.class.getDeclaredField("receiptKizConflicts");conflicts.setAccessible(true);
            java.lang.reflect.Field count=MainActivity.class.getDeclaredField("receiptAcceptedItems");count.setAccessible(true);
            assertEquals(1,((java.util.List<?>)conflicts.get(activity)).size());assertEquals(0,count.getInt(activity));
        }
    }

    // TEST: a delayed sync cannot display another client's duplicate or lose same-client evidence.
    @Test public void lateSyncConflictsAreScopedAndIdempotent() throws Exception {
        try(var controller=Robolectric.buildActivity(MainActivity.class).create()) {
            MainActivity activity=controller.get();
            java.lang.reflect.Field client=MainActivity.class.getDeclaredField("receiptClientId");client.setAccessible(true);client.set(activity,"client-A");
            TsdOperationResponse own=new TsdOperationResponse();own.clientId="client-A";own.operationKey="own";
            TsdOperationResponse other=new TsdOperationResponse();other.clientId="client-B";other.operationKey="other";
            var summary=new pro.logoff.wms.tsd.sync.TsdSyncSummary(2,0,2,0,"duplicate",java.util.Arrays.asList(own,other));
            java.lang.reflect.Method capture=MainActivity.class.getDeclaredMethod("captureReceiptKizConflicts",pro.logoff.wms.tsd.sync.TsdSyncSummary.class);capture.setAccessible(true);
            capture.invoke(activity,summary);capture.invoke(activity,summary);
            java.lang.reflect.Field conflicts=MainActivity.class.getDeclaredField("receiptKizConflicts");conflicts.setAccessible(true);
            java.util.List<?> result=(java.util.List<?>)conflicts.get(activity);
            assertEquals("logoff".equals(BuildConfig.FLAVOR)?1:0,result.size());
            if(!result.isEmpty())assertSame(own,result.get(0));
        }
    }
}
