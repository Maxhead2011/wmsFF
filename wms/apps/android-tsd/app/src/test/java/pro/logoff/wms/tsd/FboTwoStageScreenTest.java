package pro.logoff.wms.tsd;

import android.app.Activity;
import android.graphics.Color;
import android.graphics.drawable.ColorDrawable;
import android.os.Looper;
import android.view.View;
import android.view.ViewGroup;
import android.widget.TextView;
import java.lang.reflect.Proxy;
import java.util.*;
import java.util.concurrent.atomic.AtomicInteger;
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
public class FboTwoStageScreenTest {
    // TEST: only our installation replaces packing and nests Ozon; sold variants retain their menu.
    @Test public void menuIsSeparatedOnlyInOurInstallation() throws Exception {
        try(var controller=Robolectric.buildActivity(MainActivity.class).setup()) {
            MainActivity a=controller.get();
            a.getSharedPreferences("logoff_wms_tsd_session",0).edit().putString("access_token","test")
                .putString("device_code","TEST").putString("user_id","test").putString("user_name","Test")
                .putString("role_codes","ADMIN").commit();
            java.lang.reflect.Method render=MainActivity.class.getDeclaredMethod("renderMainScreen");render.setAccessible(true);render.invoke(a);
            View root=a.findViewById(android.R.id.content);
            if("logoff".equals(BuildConfig.FLAVOR)) {
                assertNotNull(find(root,"Сборка FBO"));assertNotNull(find(root,"Упаковка FBO"));assertNull(find(root,"Упаковка FBS"));assertNull(find(root,"Сборка FBO Ozon"));
                find(root,"Сборка FBO").performClick();root=a.findViewById(android.R.id.content);
                assertNotNull(find(root,"FBO WB"));assertNotNull(find(root,"FBO Ozon"));
            } else {assertNotNull(find(root,"Упаковка FBS"));assertNotNull(find(root,"Сборка FBO Ozon"));assertNull(find(root,"Упаковка FBO"));}
            a.getSharedPreferences("logoff_wms_tsd_session",0).edit().clear().commit();
        }
    }
    private TsdFboPlan plan(String phase) {
        TsdFboPlan p=new TsdFboPlan();p.phase=phase;p.title="Test";p.needed=2;
        p.lines=new ArrayList<>();p.route=new ArrayList<>();p.boxes=new ArrayList<>();p.wholeBoxes=new ArrayList<>();
        TsdFboPlan.Route r=new TsdFboPlan.Route();r.boxCode="BOX_1";r.pallet="PL_1";r.zone="Zone";r.tasks=new ArrayList<>();p.route.add(r);return p;
    }
    private FboTwoStageScreen open(Activity a,TsdFboPlan p,boolean packing,AtomicInteger mutations) throws Exception {
        WmsApi api=(WmsApi)Proxy.newProxyInstance(WmsApi.class.getClassLoader(),new Class[]{WmsApi.class},(o,m,args)->{
            if(m.getName().equals("actFbo"))mutations.incrementAndGet();
            return Proxy.newProxyInstance(Call.class.getClassLoader(),new Class[]{Call.class},(c,method,values)->{
                if(method.getName().equals("execute"))return Response.success(p);return null;
            });
        });
        FboTwoStageScreen s=new FboTwoStageScreen(a,new TsdSession("test","Bearer","T","T",UUID.randomUUID().toString(),"Test",Collections.emptyList()),api,"https://example.invalid","request",packing,()->{});
        java.lang.reflect.Field field=FboTwoStageScreen.class.getDeclaredField("busy");field.setAccessible(true);
        for(int i=0;i<200;i++){Shadows.shadowOf(Looper.getMainLooper()).idle();if(!field.getBoolean(s))return s;Thread.sleep(10);}
        fail("Plan did not load");return s;
    }
    private TextView find(View v,String text){
        if(v instanceof TextView && ((TextView)v).getText().toString().contains(text))return (TextView)v;
        if(v instanceof ViewGroup)for(int i=0;i<((ViewGroup)v).getChildCount();i++){TextView r=find(((ViewGroup)v).getChildAt(i),text);if(r!=null)return r;}return null;
    }
    // TEST: real widgets show yellow route, red rejection, green accepted box; location scans never write stock.
    @Test public void palletAndBoxFeedbackDoesNotMutateStock() throws Exception {
        try(var controller=Robolectric.buildActivity(Activity.class).setup()){
            Activity a=controller.get();AtomicInteger mutations=new AtomicInteger();FboTwoStageScreen s=open(a,plan("PICKING"),false,mutations);
            try{
                s.scannerField().setText("PL_1");s.submit();
                TextView box=find(a.findViewById(android.R.id.content),"→ BOX_1");assertNotNull(box);
                assertEquals(Color.rgb(254,240,138),((ColorDrawable)box.getBackground()).getColor());
                s.scannerField().setText("WRONG");s.submit();
                TextView rejection=find(a.findViewById(android.R.id.content),"не требуется");assertNotNull(rejection);
                assertEquals(Color.rgb(254,202,202),((ColorDrawable)rejection.getBackground()).getColor());
                s.scannerField().setText("BOX_1");s.submit();
                TextView accepted=find(a.findViewById(android.R.id.content),"Нужный короб");assertNotNull(accepted);
                assertEquals(Color.rgb(187,247,208),((ColorDrawable)accepted.getBackground()).getColor());assertEquals(0,mutations.get());
            }finally{s.close();}
        }
    }
    // TEST: wrong entry point cannot expose a scanner, and whole boxes precede loose packing.
    @Test public void packingCannotPickAndMustScanWholeBoxesFirst() throws Exception {
        try(var controller=Robolectric.buildActivity(Activity.class).setup()){
            Activity a=controller.get();AtomicInteger mutations=new AtomicInteger();FboTwoStageScreen s=open(a,plan("PICKING"),true,mutations);
            assertNull(s.scannerField());s.close();
            TsdFboPlan p=plan("PACKING");p.wholeBoxes.add("WHOLE");s=open(a,p,true,mutations);
            try{s.scannerField().setText("NEW_BOX");s.submit();assertEquals(0,mutations.get());assertNotNull(find(a.findViewById(android.R.id.content),"Сначала отсканируйте целые короба"));}finally{s.close();}
        }
    }
}
