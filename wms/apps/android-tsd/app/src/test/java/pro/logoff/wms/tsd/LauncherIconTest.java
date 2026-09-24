package pro.logoff.wms.tsd;

import android.content.Context;
import android.graphics.Bitmap;
import android.graphics.Canvas;
import android.graphics.Color;
import android.graphics.drawable.AdaptiveIconDrawable;
import android.graphics.drawable.Drawable;
import org.junit.Test;
import org.junit.runner.RunWith;
import org.robolectric.RobolectricTestRunner;
import org.robolectric.RuntimeEnvironment;
import org.robolectric.annotation.Config;
import org.robolectric.annotation.GraphicsMode;
import static org.junit.Assert.*;

@RunWith(RobolectricTestRunner.class) @Config(sdk=28) @GraphicsMode(GraphicsMode.Mode.NATIVE)
public class LauncherIconTest {
    // TEST: our launcher must expose an adaptive icon; sold variants retain their existing manifest.
    @Test public void onlyLogoffGetsTheLauncherIcon() throws Exception {
        Context c=RuntimeEnvironment.getApplication();
        if(!"logoff".equals(BuildConfig.FLAVOR)){assertEquals(0,c.getApplicationInfo().icon);return;}
        assertNotEquals(0,c.getApplicationInfo().icon);
        Drawable d=c.getDrawable(c.getApplicationInfo().icon);
        assertTrue(d instanceof AdaptiveIconDrawable);
        assertNotNull(((AdaptiveIconDrawable)d).getForeground());
        assertNotNull(((AdaptiveIconDrawable)d).getBackground());
        // TEST: export the actual Android-rendered adaptive drawable for visual review.
        Bitmap preview=Bitmap.createBitmap(256,256,Bitmap.Config.ARGB_8888);
        d.setBounds(0,0,256,256);d.draw(new Canvas(preview));
        java.io.File output=new java.io.File("build/reports/launcher-icon-preview.png");output.getParentFile().mkdirs();
        try(java.io.FileOutputStream stream=new java.io.FileOutputStream(output)){preview.compress(Bitmap.CompressFormat.PNG,100,stream);}

    }
    // TEST: the legacy icon is also loadable and draws the approved white/red artwork at launcher sizes.
    @Test public void legacyIconDrawsAtSmallAndLargeSizes() {
        if(!"logoff".equals(BuildConfig.FLAVOR))return;
        Context c=RuntimeEnvironment.getApplication();
        int id=c.getResources().getIdentifier("logoff_launcher_legacy","drawable",c.getPackageName());
        assertNotEquals(0,id);
        for(int size:new int[]{48,192}) {
            Drawable d=c.getDrawable(id);Bitmap bitmap=Bitmap.createBitmap(size,size,Bitmap.Config.ARGB_8888);
            d.setBounds(0,0,size,size);d.draw(new Canvas(bitmap));
            int red=0,white=0;
            for(int y=0;y<size;y++)for(int x=0;x<size;x++) {
                int pixel=bitmap.getPixel(x,y);
                if(Color.alpha(pixel)>200&&Color.red(pixel)>160&&Color.green(pixel)<80)red++;
                if(Color.alpha(pixel)>200&&Color.red(pixel)>220&&Color.green(pixel)>220&&Color.blue(pixel)>220)white++;
            }
            assertTrue("red background",red>size*size/3);
            assertTrue("visible white symbol",white>size*size/25);
        }
    }
}
