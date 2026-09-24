package pro.logoff.wms.tsd;
import android.app.AlertDialog;
import android.view.View;
import android.view.ViewGroup;
import android.widget.TextView;
import org.junit.Test;
import org.junit.runner.RunWith;
import org.robolectric.Robolectric;
import org.robolectric.RobolectricTestRunner;
import org.robolectric.annotation.Config;
import pro.logoff.wms.tsd.network.TsdFbsAssemblyResponse;
import static org.junit.Assert.*;

@RunWith(RobolectricTestRunner.class) @Config(sdk=28)
public class FbsKizReplacementNoticeTest {
    private boolean contains(View view,String text) {
        if(view instanceof TextView && ((TextView)view).getText().toString().contains(text))return true;
        if(view instanceof ViewGroup){ViewGroup group=(ViewGroup)view;for(int i=0;i<group.getChildCount();i++)if(contains(group.getChildAt(i),text))return true;}
        return false;
    }
    // TEST: the warning is visible in the automatically opened dialog, not hidden behind it.
    @Test public void replacementDialogAlwaysShowsMandatoryWarningOnlyInOurFlavor() throws Exception {
        try(var controller=Robolectric.buildActivity(MainActivity.class).setup()) {
            var activity=controller.get();var task=new TsdFbsAssemblyResponse.Task();task.id="task";
            var show=MainActivity.class.getDeclaredMethod("showFbsGuidedScanDialog",String.class,TsdFbsAssemblyResponse.Task.class,String.class,String.class,String.class,String.class,String.class);show.setAccessible(true);
            show.invoke(activity,"SCAN_NEW_KIZ",task,"Товар","Артикул","Цвет","46","WB");
            var field=MainActivity.class.getDeclaredField("fbsGuidedScanDialog");field.setAccessible(true);
            var dialog=(AlertDialog)field.get(activity);assertTrue(dialog.isShowing());
            assertEquals("logoff".equals(BuildConfig.FLAVOR),contains(dialog.getWindow().getDecorView(),"КИЗ НЕОБХОДИМО ЗАМЕНИТЬ"));
            dialog.dismiss();
        }
    }
}
