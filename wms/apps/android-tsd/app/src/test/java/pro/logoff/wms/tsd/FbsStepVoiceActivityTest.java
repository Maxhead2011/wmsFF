package pro.logoff.wms.tsd;

import java.util.*;
import org.junit.Test;
import org.junit.runner.RunWith;
import org.robolectric.Robolectric;
import org.robolectric.RobolectricTestRunner;
import org.robolectric.annotation.Config;
import static org.junit.Assert.*;

@RunWith(RobolectricTestRunner.class) @Config(sdk=28)
public class FbsStepVoiceActivityTest {
    // TEST: real activity routes new-barcode/error audio, isolates sold apps and silences background callbacks.
    @Test public void promptsRespectScreenFlavorAndLifecycle() throws Exception {
        try(var controller=Robolectric.buildActivity(MainActivity.class).setup()) {
            var activity=controller.get();
            List<FboPackingVoice.Cue> spoken=new ArrayList<>();
            var audio=MainActivity.class.getDeclaredField("assemblyScanVoice");audio.setAccessible(true);
            audio.set(activity,new FboScanFeedback(){
                public void play(boolean accepted) {}
                public void prompt(FboPackingVoice.Cue cue){spoken.add(cue);}
                public void close() {}
            });
            var screen=MainActivity.class.getDeclaredField("screen");screen.setAccessible(true);
            var method=MainActivity.class.getDeclaredMethod("speakFbsPrompt",FboPackingVoice.Cue.class);method.setAccessible(true);
            method.invoke(activity,FboPackingVoice.Cue.NEW_BARCODE);
            assertTrue(spoken.isEmpty());
            screen.set(activity,Enum.valueOf((Class)screen.getType(),"FBS_ASSEMBLY"));
            method.invoke(activity,FboPackingVoice.Cue.NEW_BARCODE);
            method.invoke(activity,FboPackingVoice.Cue.ERROR);
            assertEquals("logoff".equals(BuildConfig.FLAVOR)
                ? Arrays.asList(FboPackingVoice.Cue.NEW_BARCODE,FboPackingVoice.Cue.ERROR)
                : Collections.emptyList(),spoken);
            int count=spoken.size();controller.pause();
            method.invoke(activity,FboPackingVoice.Cue.PUT);
            assertEquals(count,spoken.size());
        }
    }
}
