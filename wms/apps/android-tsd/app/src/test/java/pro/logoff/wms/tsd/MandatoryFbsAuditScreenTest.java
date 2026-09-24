package pro.logoff.wms.tsd;
import android.view.*;import android.widget.*;import org.junit.Test;import org.junit.runner.RunWith;import org.robolectric.*;import org.robolectric.annotation.Config;import static org.junit.Assert.*;
@RunWith(RobolectricTestRunner.class) @Config(sdk=28)
public class MandatoryFbsAuditScreenTest {
 static void set(MainActivity a,String n,Object v)throws Exception{var f=MainActivity.class.getDeclaredField(n);f.setAccessible(true);f.set(a,v);}
 static TextView find(View v,String s){if(v instanceof TextView&&((TextView)v).getText().toString().contains(s))return (TextView)v;if(v instanceof ViewGroup)for(int i=0;i<((ViewGroup)v).getChildCount();i++){TextView x=find(((ViewGroup)v).getChildAt(i),s);if(x!=null)return x;}return null;}
 // TEST: request 1291 must never strand a picker after an audit-open network failure.
 @Test public void failedMandatoryOpenShowsReasonAndRetryWithoutBypass()throws Exception{
 try(var c=Robolectric.buildActivity(MainActivity.class).setup()){
 MainActivity a=c.get();set(a,"mandatoryFbsAuditActive",true);set(a,"mandatoryFbsAuditBoxCode","BOX");set(a,"activeInventory",null);set(a,"statusMessage","Ошибка соединения");
 var m=MainActivity.class.getDeclaredMethod("renderInventoryCountScreen");m.setAccessible(true);m.invoke(a);View root=a.findViewById(android.R.id.content);
 if("logoff".equals(BuildConfig.FLAVOR)){assertNotNull(find(root,"Ошибка соединения"));assertNotNull(find(root,"Повторить открытие проверки"));assertTrue(find(root,"Повторить открытие проверки").isEnabled());set(a,"inventoryRequestBusy",true);m.invoke(a);assertFalse(find(a.findViewById(android.R.id.content),"Повторить открытие проверки").isEnabled());}
 else assertNull(find(root,"Повторить открытие проверки"));
 assertNull(find(a.findViewById(android.R.id.content),"Пропустить"));
 }}
}
