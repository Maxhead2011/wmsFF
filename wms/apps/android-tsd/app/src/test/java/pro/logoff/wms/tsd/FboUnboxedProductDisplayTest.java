package pro.logoff.wms.tsd;

import android.app.Activity;
import android.os.Looper;
import android.view.View;
import android.view.ViewGroup;
import android.widget.TextView;
import com.squareup.moshi.Moshi;
import java.lang.reflect.Proxy;
import java.util.*;
import org.junit.Test;
import org.junit.runner.RunWith;
import org.robolectric.Robolectric;
import org.robolectric.RobolectricTestRunner;
import org.robolectric.Shadows;
import org.robolectric.annotation.Config;
import pro.logoff.wms.tsd.auth.TsdSession;
import pro.logoff.wms.tsd.network.*;
import retrofit2.Call;
import retrofit2.Response;
import static org.junit.Assert.*;

@RunWith(RobolectricTestRunner.class) @Config(sdk=28)
public class FboUnboxedProductDisplayTest {
    // TEST: request2542 has lines but no box route; show its product before scanning and refresh after each accepted unit.
    @Test public void looseProductsShowIdentityAndServerRemainingWithoutBoxScan() throws Exception {
        try(var controller=Robolectric.buildActivity(Activity.class).setup()) {
            Activity a=controller.get();TsdFboPlan p=new TsdFboPlan();p.phase="PICKING";p.marketplace="OZON";p.title="2542";
            p.unboxedPickingSupported=true;p.needed=2;p.route=new ArrayList<>();p.boxes=new ArrayList<>();p.wholeBoxes=new ArrayList<>();p.directions=new ArrayList<>();
            TsdFboPlan.Line line=new Moshi.Builder().build().adapter(TsdFboPlan.Line.class).fromJson("{\"barcode\":\"2052713928520\",\"name\":\"Raw monitor\",\"article\":\"Hawkeye\",\"productDisplayText\":\"Monitor Hawkeye 2052713928520\",\"needed\":2,\"remaining\":2}");
            TsdFboPlan.Line done=new TsdFboPlan.Line();done.name="Completed product";done.barcode="999";done.needed=1;done.picked=1;
            p.lines=Arrays.asList(line,done);List<Map<String,String>> writes=new ArrayList<>();
            WmsApi api=(WmsApi)Proxy.newProxyInstance(WmsApi.class.getClassLoader(),new Class[]{WmsApi.class},(o,m,args)->Proxy.newProxyInstance(Call.class.getClassLoader(),new Class[]{Call.class},(c,method,v)->{
                if(!method.getName().equals("execute"))return null;
                if(m.getName().equals("actFbo")){writes.add(new LinkedHashMap<>((Map<String,String>)args[2]));line.picked++;line.remaining--;p.picked++;}
                return Response.success(p);
            }));
            FboTwoStageScreen s=new FboTwoStageScreen(a,new TsdSession("token","Bearer","T","T",UUID.randomUUID().toString(),"Test",Collections.emptyList()),api,"https://example.invalid","request",false,()->{});
            try {
                idle(s);
                if(!"logoff".equals(BuildConfig.FLAVOR)){assertNull(find(a,"Товары к отбору"));return;}
                assertNotNull(find(a,"Monitor Hawkeye 2052713928520"));assertNotNull(find(a,"Осталось: 2"));
                assertNull(find(a,"Completed product"));assertTrue(writes.isEmpty());
                scan(s,"2052713928520");idle(s);assertNotNull(find(a,"Осталось: 1"));assertEquals(1,writes.size());
                assertEquals("PICK_UNIT",writes.get(0).get("action"));assertFalse(writes.get(0).containsKey("kiz"));
                scan(s,"2052713928520");idle(s);assertNull(find(a,"Monitor Hawkeye 2052713928520"));assertEquals(2,writes.size());
                assertTrue(find(a,"Завершить отбор").isEnabled());
            }finally{s.close();}
        }
    }
    private static void scan(FboTwoStageScreen s,String barcode){s.scannerField().setText(barcode);s.submit();}
    private static TextView find(Activity a,String label){return find(a.findViewById(android.R.id.content),label);}
    private static TextView find(View v,String label){if(v instanceof TextView&&((TextView)v).getText().toString().contains(label))return (TextView)v;if(v instanceof ViewGroup)for(int i=0;i<((ViewGroup)v).getChildCount();i++){TextView hit=find(((ViewGroup)v).getChildAt(i),label);if(hit!=null)return hit;}return null;}
    private static void idle(FboTwoStageScreen s)throws Exception{var busy=FboTwoStageScreen.class.getDeclaredField("busy");busy.setAccessible(true);for(int i=0;i<300;i++){Shadows.shadowOf(Looper.getMainLooper()).idle();if(!busy.getBoolean(s))return;Thread.sleep(10);}fail("Plan did not load");}
}
