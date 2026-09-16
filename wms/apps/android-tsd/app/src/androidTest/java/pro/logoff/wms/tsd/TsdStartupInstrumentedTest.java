package pro.logoff.wms.tsd;

import android.content.Context;
import android.content.Intent;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;
import java.io.InputStreamReader;
import java.io.StringReader;
import java.nio.charset.StandardCharsets;
import org.junit.Test;
import org.junit.runner.RunWith;
import static org.junit.Assert.*;

@RunWith(AndroidJUnit4.class)
public class TsdStartupInstrumentedTest {
    @Test public void placeholdersCompileOnAndroidAndKeepScannedData() throws Exception {
        // TEST: ICU rejects an unescaped closing brace; the host JVM silently accepted it.
        TsdTextCatalog catalog=TsdTextCatalog.load(
            new StringReader("Осталось: {0}\tQoldi: {0}\tRemaining: {0}\n"),
            new StringReader("Осталось: {0}\n"));
        String data="0104640684261753215apMFH%IhcZVg\u001d91EE12";
        assertEquals("Remaining: "+data,catalog.text("Осталось: "+data,"en"));
        assertEquals("Qoldi: 3",catalog.text("Осталось: 3","uz"));
    }

    @Test public void releaseCatalogLoadsOnAndroid() throws Exception {
        // TEST: load every shipped template using Android, not Robolectric's host regex.
        Context context=InstrumentationRegistry.getInstrumentation().getTargetContext();
        TsdTextCatalog catalog=TsdTextCatalog.load(
            new InputStreamReader(context.getAssets().open("tsd-translations.tsv"),StandardCharsets.UTF_8),
            new InputStreamReader(context.getAssets().open("tsd-templates.tsv"),StandardCharsets.UTF_8));
        assertEquals("Back",catalog.text("Назад","en"));
        assertEquals("Назад",catalog.text("Назад","ru"));
    }

    @Test public void appStartsAndReachesLogin() throws Exception {
        // TEST: a caught startup error/fatal screen must not count as a successful launch.
        android.app.Instrumentation instrumentation=InstrumentationRegistry.getInstrumentation();
        Intent intent=new Intent(instrumentation.getTargetContext(),MainActivity.class);
        intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        MainActivity activity=(MainActivity)instrumentation.startActivitySync(intent);
        try {
            instrumentation.waitForIdleSync();
            for(String name:new String[]{"deviceCodeInput","deviceSecretInput"}) {
                java.lang.reflect.Field field=MainActivity.class.getDeclaredField(name);
                field.setAccessible(true);assertNotNull("Missing login field: "+name,field.get(activity));
            }
            assertFalse(activity.isFinishing());
        } finally {instrumentation.runOnMainSync(activity::finish);}
    }
}
