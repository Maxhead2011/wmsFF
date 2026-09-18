package pro.logoff.wms.tsd;

import android.media.SoundPool;
import org.junit.Test;
import org.junit.runner.RunWith;
import org.robolectric.RuntimeEnvironment;
import org.robolectric.RobolectricTestRunner;
import org.robolectric.Shadows;
import org.robolectric.annotation.Config;
import org.robolectric.shadows.ShadowSoundPool;
import static org.junit.Assert.*;

@RunWith(RobolectricTestRunner.class) @Config(sdk=28)
public class FboScanFeedbackTest {
    private ShadowSoundPool pool(FboScanFeedback.Voice voice) throws Exception {
        var field=FboScanFeedback.Voice.class.getDeclaredField("pool");field.setAccessible(true);
        return Shadows.shadowOf((SoundPool)field.get(voice));
    }
    // TEST: no stale "hit" after a later "miss", even while offline recordings are loading.
    @Test public void latestScanWinsDuringLoadingAndSoundsDoNotLoop() throws Exception {
        FboScanFeedback.Voice voice=new FboScanFeedback.Voice(RuntimeEnvironment.getApplication());
        try {
            ShadowSoundPool sounds=pool(voice);voice.play(true);voice.play(false);
            sounds.notifyResourceLoaded(R.raw.fbo_scan_hit,true);
            assertFalse(sounds.wasResourcePlayed(R.raw.fbo_scan_hit));
            sounds.notifyResourceLoaded(R.raw.fbo_scan_miss,true);
            assertEquals(1,sounds.getResourcePlaybacks(R.raw.fbo_scan_miss).size());
            voice.play(true);assertEquals(1,sounds.getResourcePlaybacks(R.raw.fbo_scan_hit).size());
        }finally{voice.close();}
    }
    // TEST: late audio callbacks cannot speak after leaving the screen; failed loads do not block work.
    @Test public void closeCancelsPendingSpeechAndFailedLoadIsSilent() throws Exception {
        FboScanFeedback.Voice voice=new FboScanFeedback.Voice(RuntimeEnvironment.getApplication());
        ShadowSoundPool sounds=pool(voice);voice.play(true);
        sounds.notifyResourceLoaded(R.raw.fbo_scan_hit,false);
        assertFalse(sounds.wasResourcePlayed(R.raw.fbo_scan_hit));
        voice.close();voice.close();voice.play(false);
        sounds.notifyResourceLoaded(R.raw.fbo_scan_hit,true);
        assertFalse(sounds.wasResourcePlayed(R.raw.fbo_scan_hit));
        assertFalse(sounds.wasResourcePlayed(R.raw.fbo_scan_miss));
    }
}
