package pro.logoff.wms.tsd;
import java.lang.reflect.*;
import java.util.*;
import org.junit.Test;
import org.junit.runner.RunWith;
import org.robolectric.*;
import org.robolectric.annotation.Config;
import pro.logoff.wms.tsd.auth.TsdSession;
import static org.junit.Assert.*;

@RunWith(RobolectricTestRunner.class) @Config(sdk=28)
public class ReturnsActivityTest {
    // TEST: token renewal preserves an uncertain scan, another employee cannot inherit it.
    @Test public void pendingScanSurvivesNewTokenButIsIsolatedByEmployee() throws Exception {
        try(var first=Robolectric.buildActivity(ReturnsActivity.class); var next=Robolectric.buildActivity(ReturnsActivity.class)) {
            ReturnsActivity a=first.get(), b=next.get();
            set(a,"session",session("one","employee"));set(a,"clientId","client");set(a,"batchId","batch");set(a,"pendingAction","scan");
            Map<String,String> pending=new LinkedHashMap<>();pending.put("id","stable-operation");pending.put("boxCode","BOX-1");set(a,"pending",pending);call(a,"save");
            set(b,"session",session("renewed","employee"));call(b,"restore");
            assertEquals("batch",get(b,"batchId"));assertEquals("scan",get(b,"pendingAction"));assertEquals(pending,get(b,"pending"));
            set(b,"session",session("another","different-employee"));set(b,"pending",new LinkedHashMap<String,String>());call(b,"restore");
            assertEquals("",get(b,"batchId"));assertEquals("",get(b,"pendingAction"));
        }
    }
    // TEST: uncertain release reuses the exact unit and KIZ after activity recreation.
    @Test public void pendingMarkKeepsExactUnitAndKiz() throws Exception {
        try(var first=Robolectric.buildActivity(ReturnsActivity.class); var next=Robolectric.buildActivity(ReturnsActivity.class)) {
            ReturnsActivity a=first.get(), b=next.get();
            set(a,"session",session("one","release-worker"));set(a,"batchId","return-batch");set(a,"mode","MARK");set(a,"releaseUnit","unit-1");set(a,"releaseBox","BOX-1");set(a,"releaseBarcode","0123");set(a,"pendingAction","mark");
            Map<String,String> pending=new LinkedHashMap<>();pending.put("unitId","unit-1");pending.put("kiz","full-code");set(a,"pending",pending);call(a,"save");
            set(b,"session",session("new-token","release-worker"));call(b,"restore");
            assertEquals("mark",get(b,"pendingAction"));assertEquals("unit-1",get(b,"releaseUnit"));assertEquals("BOX-1",get(b,"releaseBox"));assertEquals(pending,get(b,"pending"));
        }
    }
    // TEST: Returns matches main buttons and is placed immediately after inventory.
    @Test public void returnsIsBelowInventory() {
        android.app.Activity a=Robolectric.buildActivity(android.app.Activity.class).setup().get();
        android.widget.LinearLayout root=new android.widget.LinearLayout(a);
        for(String title:new String[]{"Приемка товара","Инвентаризация","КИЗы"}) { android.widget.Button b=new android.widget.Button(a);b.setText(title);root.addView(b); }
        ReturnsActivity.addMenu(a,root);
        android.widget.Button returns=(android.widget.Button)root.getChildAt(2);
        assertEquals("Возвраты",returns.getText().toString());
        assertEquals(Math.round(86*a.getResources().getDisplayMetrics().density),returns.getLayoutParams().height);
        assertEquals(android.graphics.Color.WHITE,returns.getCurrentTextColor());
        assertEquals("КИЗы",((android.widget.Button)root.getChildAt(3)).getText().toString());
    }
    static TsdSession session(String token,String user){return new TsdSession(token,"Bearer","DEVICE","Device",user,"User",Collections.singletonList("WORKER"));}
    static void set(Object target,String name,Object value)throws Exception{Field f=ReturnsActivity.class.getDeclaredField(name);f.setAccessible(true);f.set(target,value);}
    static Object get(Object target,String name)throws Exception{Field f=ReturnsActivity.class.getDeclaredField(name);f.setAccessible(true);return f.get(target);}
    static void call(Object target,String name)throws Exception{Method m=ReturnsActivity.class.getDeclaredMethod(name);m.setAccessible(true);m.invoke(target);}
}
