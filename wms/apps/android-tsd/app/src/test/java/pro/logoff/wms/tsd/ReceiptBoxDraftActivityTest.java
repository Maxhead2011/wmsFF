package pro.logoff.wms.tsd;

import android.widget.EditText;
import java.lang.reflect.*;
import java.util.*;
import java.util.concurrent.*;
import org.junit.Test;
import org.junit.runner.RunWith;
import org.robolectric.*;
import org.robolectric.annotation.Config;
import static org.junit.Assert.*;

// TEST: regression from Shahida's box 06: reopening must retain all 99 unsent scans.
@RunWith(RobolectricTestRunner.class) @Config(sdk=28)
public class ReceiptBoxDraftActivityTest {
    @Test public void reopeningSameBoxRetainsNinetyNineScans() throws Exception {
        try(var controller=Robolectric.buildActivity(MainActivity.class)) {
            MainActivity a=controller.get();set(a,"executor",new QuietExecutor());set(a,"monitorExecutor",new QuietExecutor());controller.setup();
            a.getSharedPreferences("logoff_wms_tsd_session",0).edit().putString("access_token","test").putString("device_code","DRAFT-TEST").putString("user_id","draft-test").putString("user_name","Test").putString("role_codes","ADMIN").commit();
            assertNotNull(((pro.logoff.wms.tsd.auth.TsdSessionStore)get(a,"sessionStore")).load());
            ((android.content.SharedPreferences)get(a,"uiStore")).edit().clear().commit();
            set(a,"receiptMode","BOXES");set(a,"receiptClientId","draft-client");set(a,"receiptSourceDocument","draft-document");set(a,"receiptDocumentPreferenceKey","draft-test-scope");set(a,"receiptBoxCode","FFL_ELE0811_06");
            Class<?> item=Class.forName(MainActivity.class.getName()+"$ReceiptItem");Constructor<?> ctor=item.getDeclaredConstructor(String.class,String.class,String.class);ctor.setAccessible(true);
            List<Object> items=(List<Object>)get(a,"receiptCurrentItems");for(int i=0;i<99;i++)items.add(ctor.newInstance("2037359944196","unique-kiz-"+i,"Scarf"));
            EditText input=new EditText(a);input.setText("FFL_ELE0811_06");set(a,"boxCodeInput",input);
            invoke(a,"openReceiptBoxFromInput");
            assertEquals("logoff".equals(BuildConfig.FLAVOR)?99:0,items.size());
            a.getSharedPreferences("logoff_wms_tsd_session",0).edit().clear().commit();
        }
    }
    // TEST: every accepted item is on disk before close, not merely in Activity memory.
    @Test public void scansAndDuplicateGuardRestoreAfterActivityRecreation() throws Exception {
        if (!"logoff".equals(BuildConfig.FLAVOR)) return;
        for(int attempt=0;attempt<2;attempt++) {
            try(var controller=Robolectric.buildActivity(MainActivity.class)) {
                MainActivity a=prepare(controller,attempt==0);
                if(attempt==0) {
                    Method add=MainActivity.class.getDeclaredMethod("addReceiptItem",String.class,String.class,pro.logoff.wms.tsd.network.TsdSkuInfo.class);add.setAccessible(true);
                    for(int i=0;i<99;i++)add.invoke(a,"2037359944196","unique-kiz-"+i,null);
                    assertEquals(99,((List<?>)get(a,"receiptCurrentItems")).size());
                } else {
                    set(a,"receiptBoxCode","");EditText input=new EditText(a);input.setText("FFL_ELE0811_06");set(a,"boxCodeInput",input);
                    invoke(a,"openReceiptBoxFromInput");
                    assertEquals(99,((List<?>)get(a,"receiptCurrentItems")).size());
                    assertEquals(99,((Set<?>)get(a,"receiptKizValues")).size());
                    assertEquals(99,((Map<?,?>)get(a,"receiptKizBoxes")).size());
                }
            }
        }
    }
    // TEST: opening a different box cannot silently replace an unfinished receipt.
    @Test public void changingBoxKeepsTheUnfinishedBox() throws Exception {
        if (!"logoff".equals(BuildConfig.FLAVOR)) return;
        try(var controller=Robolectric.buildActivity(MainActivity.class)) {
            MainActivity a=prepare(controller,true);
            Class<?> item=Class.forName(MainActivity.class.getName()+"$ReceiptItem");Constructor<?> ctor=item.getDeclaredConstructor(String.class,String.class,String.class);ctor.setAccessible(true);
            List<Object> items=(List<Object>)get(a,"receiptCurrentItems");items.add(ctor.newInstance("2037359944196","unique-kiz","Scarf"));
            EditText input=new EditText(a);input.setText("FFL_ELE0811_07");set(a,"boxCodeInput",input);invoke(a,"openReceiptBoxFromInput");
            assertEquals("FFL_ELE0811_06",get(a,"receiptBoxCode"));assertEquals(1,items.size());
        }
    }
    private MainActivity prepare(org.robolectric.android.controller.ActivityController<MainActivity> controller,boolean clear)throws Exception {
        MainActivity a=controller.get();set(a,"executor",new QuietExecutor());set(a,"monitorExecutor",new QuietExecutor());controller.setup();
        a.getSharedPreferences("logoff_wms_tsd_session",0).edit().putString("access_token","test").putString("device_code","DRAFT-TEST").putString("user_id","draft-test").putString("user_name","Test").putString("role_codes","ADMIN").commit();
        if(clear)((android.content.SharedPreferences)get(a,"uiStore")).edit().clear().commit();
        set(a,"receiptMode","BOXES");set(a,"receiptClientId","draft-client");set(a,"receiptSourceDocument","draft-document");set(a,"receiptDocumentPreferenceKey","draft-test-scope");set(a,"receiptBoxCode","FFL_ELE0811_06");return a;
    }
    static Object get(Object o,String name)throws Exception{Field f=MainActivity.class.getDeclaredField(name);f.setAccessible(true);return f.get(o);}
    static void set(Object o,String name,Object value)throws Exception{Field f=MainActivity.class.getDeclaredField(name);f.setAccessible(true);f.set(o,value);}
    static void invoke(Object o,String name)throws Exception{Method m=MainActivity.class.getDeclaredMethod(name);m.setAccessible(true);m.invoke(o);}
    static class QuietExecutor extends AbstractExecutorService{public void execute(Runnable r){}public void shutdown(){}public List<Runnable> shutdownNow(){return new ArrayList<>();}public boolean isShutdown(){return false;}public boolean isTerminated(){return false;}public boolean awaitTermination(long n,TimeUnit u){return false;}}
}
