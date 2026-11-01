package pro.logoff.wms.tsd;
import android.view.*;
import android.widget.*;
import java.lang.reflect.*;
import java.util.*;
import java.util.concurrent.*;
import org.junit.Test;
import org.junit.runner.RunWith;
import org.robolectric.*;
import org.robolectric.annotation.Config;
import pro.logoff.wms.tsd.network.*;
import static org.junit.Assert.*;
@RunWith(RobolectricTestRunner.class) @Config(sdk=28)
public class ReceiptPlacementActivityTest {
    // TEST: receipt completion and switching pallets are separate actions, guarded by server capability.
    @Test public void placementControlsRespectCapabilityAndKeepProgress() throws Exception {
        try(var controller=Robolectric.buildActivity(MainActivity.class)) {
            MainActivity a=controller.get();
            set(a,"executor",new QuietExecutor());set(a,"monitorExecutor",new QuietExecutor());controller.setup();
            TsdStoragePalletResponse state=new TsdStoragePalletResponse();
            set(a,"storagePalletAssembly",state);render(a);
            assertFalse(text(a).contains("Разместить приёмку на палетах"));
            state.receiptPlacementEnabled=true;render(a);
            assertTrue(text(a).contains("Разместить приёмку на палетах"));
            TsdReceiptPlacementTask task=new TsdReceiptPlacementTask();task.id="receipt";task.clientId="c";task.client="Клиент";task.document="SERIES:2026:TEST";task.total=2;task.placed=1;task.remaining=Arrays.asList("BOX-2");
            state.pallet=new TsdStoragePalletResponse.Pallet();state.pallet.id="p";state.pallet.code="PALLET";state.pallet.client=new TsdStoragePalletResponse.Client();state.pallet.client.name="Клиент";state.pallet.client.id="c";state.pallet.boxes=Collections.emptyList();
            set(a,"placementTask",task);render(a);
            assertTrue(text(a).contains("Размещено 1 из 2"));
            assertTrue(text(a).contains("Завершить размещение"));
            assertTrue(text(a).contains("Следующая паллета"));
            state.pallet=null;render(a);
            assertTrue(text(a).contains("Размещено 1 из 2"));
        }
    }
    private void render(MainActivity a)throws Exception{Method m=MainActivity.class.getDeclaredMethod("renderStoragePalletAssemblyScreen");m.setAccessible(true);m.invoke(a);}
    private static void set(Object a,String field,Object value)throws Exception{Field f=MainActivity.class.getDeclaredField(field);f.setAccessible(true);f.set(a,value);}
    private String text(MainActivity a){return walk(a.getWindow().getDecorView());}
    private String walk(View v){String out=v instanceof TextView?((TextView)v).getText().toString()+"\n":"";if(v instanceof ViewGroup)for(int i=0;i<((ViewGroup)v).getChildCount();i++)out+=walk(((ViewGroup)v).getChildAt(i));return out;}
    private static class QuietExecutor extends AbstractExecutorService {
        public void shutdown(){} public List<Runnable> shutdownNow(){return Collections.emptyList();}
        public boolean isShutdown(){return false;}public boolean isTerminated(){return false;}
        public boolean awaitTermination(long t,TimeUnit u){return true;}public void execute(Runnable r){}
    }
}
