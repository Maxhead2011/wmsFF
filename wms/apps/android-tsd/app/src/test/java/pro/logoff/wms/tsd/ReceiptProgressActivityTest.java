package pro.logoff.wms.tsd;
import android.os.Looper;
import android.widget.*;
import java.lang.reflect.*;
import java.util.*;
import java.util.concurrent.*;
import org.junit.Test;
import org.junit.runner.RunWith;
import org.robolectric.*;
import org.robolectric.annotation.Config;
import pro.logoff.wms.tsd.data.*;
import pro.logoff.wms.tsd.network.TsdOperationResponse;
import static org.junit.Assert.*;

@RunWith(RobolectricTestRunner.class) @Config(sdk=28)
public class ReceiptProgressActivityTest {
    // TEST: a real queue refresh replaces the stale 3 with 9 without rebuilding the scan field.
    @Test public void queueRefreshUpdatesCounterAndPreservesFocus() throws Exception {
        try(var controller=Robolectric.buildActivity(MainActivity.class)) {
            MainActivity a=controller.get();set(a,"executor",new Executor(false));set(a,"monitorExecutor",new Executor(false));controller.setup();
            a.getSharedPreferences("logoff_wms_tsd_session",0).edit().putString("access_token","test").putString("device_code","TEST").putString("user_id","progress-test").putString("user_name","Test").putString("role_codes","ADMIN").commit();
            set(a,"executor",new Executor(true));set(a,"receiptClientId","client");set(a,"receiptSourceDocument","doc");set(a,"receiptMode","BOXES");set(a,"receiptClosedBoxes",3);
            Field screen=MainActivity.class.getDeclaredField("screen");screen.setAccessible(true);screen.set(a,Enum.valueOf((Class)screen.getType(),"RECEIPT"));
            LinearLayout layout=new LinearLayout(a);layout.setOrientation(1);TextView count=new TextView(a);EditText scan=new EditText(a);layout.addView(count);layout.addView(scan);a.setContentView(layout);scan.requestFocus();set(a,"receiptProgressText",count);
            set(a,"outbox",new OperationOutbox(null){@Override public OperationOutboxCounts counts(){return new OperationOutboxCounts(0,0);}
                @Override public ReceiptProgress receiptProgress(String client,String doc){ReceiptProgress p=new ReceiptProgress();for(int i=0;i<9;i++)p.closed.add("BOX"+i);p.acceptedItems=13;return p;}});
            var method=MainActivity.class.getDeclaredMethod("refreshQueue",String.class);method.setAccessible(true);method.invoke(a,(String)null);Shadows.shadowOf(Looper.getMainLooper()).idle();
            assertEquals("logoff".equals(BuildConfig.FLAVOR)?9:3,get(a,"receiptClosedBoxes"));assertTrue(scan.hasFocus());
            if("logoff".equals(BuildConfig.FLAVOR))assertTrue(count.getText().toString().contains("товаров: 13"));
            a.getSharedPreferences("logoff_wms_tsd_session",0).edit().clear().commit();
        }
    }
    // TEST: a recreated activity resumes the durable receipt document for the same operator/client.
    @Test public void unfinishedReceiptSurvivesActivityRecreation() throws Exception {
        if (!"logoff".equals(BuildConfig.FLAVOR)) return;
        String document=null;
        for(int attempt=0;attempt<2;attempt++) {
            try(var controller=Robolectric.buildActivity(MainActivity.class)) {
                MainActivity a=controller.get();set(a,"executor",new Executor(false));set(a,"monitorExecutor",new Executor(false));controller.setup();
                a.getSharedPreferences("logoff_wms_tsd_session",0).edit().putString("access_token","test").putString("device_code","TEST").putString("user_id","resume-test").putString("user_name","Test").putString("role_codes","ADMIN").commit();
                pro.logoff.wms.tsd.network.TsdClientSummary client=new pro.logoff.wms.tsd.network.TsdClientSummary();client.id="resume-client";client.name="Client";
                ((List<pro.logoff.wms.tsd.network.TsdClientSummary>)get(a,"clients")).add(client);
                Spinner spinner=new Spinner(a);spinner.setAdapter(new ArrayAdapter<String>(a,android.R.layout.simple_spinner_item,new String[]{"Select","Client"}));spinner.setSelection(1);set(a,"clientSpinner",spinner);
                var start=MainActivity.class.getDeclaredMethod("startReceiptForSelectedClient");start.setAccessible(true);start.invoke(a);
                String current=(String)get(a,"receiptSourceDocument");assertFalse(current.isEmpty());
                if(document==null)document=current;else assertEquals(document,current);
                if(attempt==1) {
                    ((android.content.SharedPreferences)get(a,"uiStore")).edit().remove((String)get(a,"receiptDocumentPreferenceKey")).commit();
                    a.getSharedPreferences("logoff_wms_tsd_session",0).edit().clear().commit();
                }
            }
        }
    }
    private Object get(Object o,String n)throws Exception{Field f=MainActivity.class.getDeclaredField(n);f.setAccessible(true);return f.get(o);}
    private void set(Object o,String n,Object v)throws Exception{Field f=MainActivity.class.getDeclaredField(n);f.setAccessible(true);f.set(o,v);}
    private static class Executor extends AbstractExecutorService{
        final boolean run;Executor(boolean run){this.run=run;}public void execute(Runnable r){if(run)r.run();}public void shutdown(){}public List<Runnable> shutdownNow(){return new ArrayList<>();}public boolean isShutdown(){return false;}public boolean isTerminated(){return false;}public boolean awaitTermination(long n,TimeUnit u){return false;}
    }
}

