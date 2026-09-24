package pro.logoff.wms.tsd;
import android.app.Activity;
import android.view.*;
import android.widget.TextView;
import java.util.*;
import org.junit.Test;
import org.junit.runner.RunWith;
import org.robolectric.Robolectric;
import org.robolectric.RobolectricTestRunner;
import org.robolectric.annotation.Config;
import pro.logoff.wms.tsd.network.TsdFbsAssemblyResponse;
import static org.junit.Assert.*;
@RunWith(RobolectricTestRunner.class) @Config(sdk=28)
public class FbsPendingActionTest {
    private TsdFbsAssemblyResponse response(){TsdFbsAssemblyResponse r=new TsdFbsAssemblyResponse();r.state="SCAN_KIZ";r.task=new TsdFbsAssemblyResponse.Task();r.task.id="task-1";r.task.orderId="order-1";r.task.requestId="request-1";return r;}
    // TEST: identical Ozon barcodes cannot increment the counter on a restarted retry.
    @Test public void preservesRequestAndPreviousOzonCountAcrossRestart(){
        try(var c=Robolectric.buildActivity(Activity.class).setup()){
            var prefs=c.get().getSharedPreferences("fbs-pending",0);TsdFbsAssemblyResponse response=response();
            var payload=new LinkedHashMap<String,Object>();payload.put("barcode","2051234567890");payload.put("scannedItemCount",1);payload.put("supportsKizRelabel",true);
            var request=FbsPendingAction.create("scan-barcode","barcode","2051234567890",response,payload);assertTrue(request.save(prefs,"worker"));
            response.task.id="other-task";payload.put("scannedItemCount",2);
            var restored=FbsPendingAction.read(prefs,"worker");assertEquals(request.operationId,restored.operationId);assertEquals("task-1",restored.snapshot.task.id);assertEquals(1,((Number)restored.payload.get("scannedItemCount")).intValue());
            assertNull(FbsPendingAction.read(prefs,"another-worker"));assertTrue(FbsPendingAction.clear(prefs,"worker"));assertNull(FbsPendingAction.read(prefs,"worker"));
        }
    }
    // TEST: a pending KIZ must replace scanning controls with an explicit retry button.
    @Test public void showsRetryInsteadOfAnotherScan(){
        if(!"logoff".equals(BuildConfig.FLAVOR))return;
        try(var c=Robolectric.buildActivity(MainActivity.class).setup()){
            MainActivity a=c.get();a.getSharedPreferences("logoff_wms_tsd_session",0).edit().putString("access_token","test").putString("device_code","TEST").putString("user_id","retry-worker").putString("user_name","Test").putString("role_codes","OPERATOR").commit();
            FbsPendingAction.create("scan-kiz","kiz","KIZ",response(),Map.of("kiz","KIZ")).save(a.getSharedPreferences("fbs-pending",0),"retry-worker");
            try{var render=MainActivity.class.getDeclaredMethod("renderFbsAssemblyScreen");render.setAccessible(true);render.invoke(a);
                assertTrue(contains(a.findViewById(android.R.id.content),"Повторить отправку"));
                var active=MainActivity.class.getDeclaredField("fbsAssembly");active.setAccessible(true);
                assertEquals("task-1",((TsdFbsAssemblyResponse)active.get(a)).task.id);
            }catch(Exception e){throw new AssertionError(e);}
            finally{a.getSharedPreferences("fbs-pending",0).edit().clear().commit();a.getSharedPreferences("logoff_wms_tsd_session",0).edit().clear().commit();}
        }
    }
    private boolean contains(View v,String text){if(v instanceof TextView&&((TextView)v).getText().toString().contains(text))return true;if(v instanceof ViewGroup)for(int i=0;i<((ViewGroup)v).getChildCount();i++)if(contains(((ViewGroup)v).getChildAt(i),text))return true;return false;}
    @Test public void transientFailureDoesNotClearTheSavedCommand(){for(int s:new int[]{401,403,408,429,500,503})assertFalse(FbsPendingAction.definitive(s));assertTrue(FbsPendingAction.definitive(400));}
    @Test public void separatesChangedOrderFromReservedStock(){
        assertTrue(FbsNextStep.explain("FBS_TASK_STALE","Заказ изменился",true).contains("отложите отдельно"));
        assertFalse(FbsNextStep.explain("FBS_TASK_STALE","Заказ изменился",false).contains("отложите отдельно"));
        assertTrue(FbsNextStep.explain("","Товар зарезервирован",false).contains("не означает"));
    }
}
