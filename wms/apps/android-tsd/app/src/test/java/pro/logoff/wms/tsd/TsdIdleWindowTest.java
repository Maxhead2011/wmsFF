package pro.logoff.wms.tsd;

import android.app.Activity;
import android.app.Dialog;
import android.view.KeyEvent;
import android.view.MotionEvent;
import org.junit.Test;
import org.junit.runner.RunWith;
import org.robolectric.Robolectric;
import org.robolectric.RobolectricTestRunner;
import org.robolectric.annotation.Config;
import pro.logoff.wms.tsd.auth.TsdIdleWindow;
import static org.junit.Assert.*;

// TEST: modal input counts; showing/refreshing a dialog does not.
@RunWith(RobolectricTestRunner.class) @Config(sdk=28)
public class TsdIdleWindowTest {
    @Test public void observesKeysAndTouchesButNotWindowRefresh(){
        Activity activity=Robolectric.buildActivity(Activity.class).setup().get();
        Dialog dialog=new Dialog(activity);int[] inputs={0};
        TsdIdleWindow.attach(dialog.getWindow(),()->{inputs[0]++;return true;});
        dialog.show();dialog.getWindow().getCallback().onWindowFocusChanged(true);
        assertEquals(0,inputs[0]);
        dialog.getWindow().getCallback().dispatchKeyEvent(new KeyEvent(KeyEvent.ACTION_DOWN,KeyEvent.KEYCODE_A));
        assertEquals(1,inputs[0]);
        MotionEvent event=MotionEvent.obtain(0,0,MotionEvent.ACTION_DOWN,1,1,0);
        dialog.getWindow().getCallback().dispatchTouchEvent(event);event.recycle();
        assertEquals(2,inputs[0]);dialog.dismiss();
    }
    @Test public void consumesInputAfterExpiry(){
        Activity activity=Robolectric.buildActivity(Activity.class).setup().get();
        Dialog dialog=new Dialog(activity);int[] delivered={0};
        dialog.setOnKeyListener((d,key,event)->{delivered[0]++;return false;});
        TsdIdleWindow.attach(dialog.getWindow(),()->false);
        assertTrue(dialog.getWindow().getCallback().dispatchKeyEvent(new KeyEvent(KeyEvent.ACTION_DOWN,KeyEvent.KEYCODE_ENTER)));
        assertEquals(0,delivered[0]);
    }
}
