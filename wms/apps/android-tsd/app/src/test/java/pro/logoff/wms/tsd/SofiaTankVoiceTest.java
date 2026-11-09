package pro.logoff.wms.tsd;

import android.media.SoundPool;
import java.io.InputStream;
import java.lang.reflect.Field;
import java.nio.ByteBuffer;
import java.nio.ByteOrder;
import org.junit.Test;
import org.junit.runner.RunWith;
import org.robolectric.RobolectricTestRunner;
import org.robolectric.RuntimeEnvironment;
import org.robolectric.Shadows;
import org.robolectric.annotation.Config;
import org.robolectric.shadows.ShadowSoundPool;
import static org.junit.Assert.*;

@RunWith(RobolectricTestRunner.class)
@Config(sdk = 28)
public class SofiaTankVoiceTest {
    private static final String SOFIA = "f89c0efe-dcd2-4dfa-9cea-e35c0c492f83";
    private static final String[] CLIPS = {
        "hit", "miss", "repeat", "start", "begin", "put", "armor", "ready",
        "move", "locked", "target", "empty", "reset"
    };

    private static int raw(String clip) {
        int id = RuntimeEnvironment.getApplication().getResources().getIdentifier(
            "sofia_tanks_" + clip, "raw", BuildConfig.APPLICATION_ID);
        assertNotEquals("Missing offline recording: " + clip, 0, id);
        return id;
    }

    private static ShadowSoundPool sound(FboScanFeedback.Voice voice) throws Exception {
        Field field = FboScanFeedback.Voice.class.getDeclaredField("pool");
        field.setAccessible(true);
        return Shadows.shadowOf((SoundPool) field.get(voice));
    }

    private static void loaded(ShadowSoundPool sound) {
        for (String clip : CLIPS) sound.notifyResourceLoaded(raw(clip), true);
    }

    private static void plays(ShadowSoundPool sound, String clip, Runnable action) {
        int id = raw(clip);
        int before = sound.getResourcePlaybacks(id).size();
        action.run();
        assertEquals(clip, before + 1, sound.getResourcePlaybacks(id).size());
    }

    // TEST: Sofia now uses the same existing WB packing recordings as ordinary operators.
    @Test public void sofiaUsesStandardPackingAndScanAudio() throws Exception {
        assertFalse(new PersonalScanVoice(SOFIA).personal);
        FboScanFeedback.Voice voice = new FboScanFeedback.Voice(RuntimeEnvironment.getApplication(), SOFIA);
        try {
            ShadowSoundPool sound = sound(voice);
            int[] clips = {R.raw.fbo_pack_box, R.raw.fbo_pack_barcode, R.raw.fbo_pack_kiz,
                R.raw.fbo_pack_put, R.raw.fbo_pack_error, R.raw.fbo_pack_closed,
                R.raw.fbs_new_barcode, R.raw.fbo_scan_hit};
            FboPackingVoice.Cue[] cues = FboPackingVoice.Cue.values();
            for (int i=0;i<cues.length;i++) {
                sound.notifyResourceLoaded(clips[i],true);
                voice.prompt(cues[i]);
                assertTrue(sound.wasResourcePlayed(clips[i]));
            }
            sound.notifyResourceLoaded(R.raw.fbo_scan_miss,true);
            voice.scan(false,"wrong-code"); voice.scan(false,"wrong-code");
            assertEquals(2,sound.getResourcePlaybacks(R.raw.fbo_scan_miss).size());
            for (PersonalEventVoice.Cue cue : PersonalEventVoice.Cue.values()) voice.event(cue);
            for (String clip : CLIPS) assertFalse(sound.wasResourcePlayed(raw(clip)));
            assertFalse(sound.wasResourcePlayed(R.raw.eleonora_hit));
        } finally { voice.close(); }
    }

    // TEST: common users and sold flavors keep their existing default sounds and silence for personal events.
    @Test public void soldFlavorsAndOtherAccountsNeverUseTanks() throws Exception {
        boolean own = "logoff".equals(BuildConfig.FLAVOR);
        String[] owners = own ? new String[]{SOFIA, "another-user", "София", null}
            : new String[]{SOFIA, PersonalScanVoice.ACCOUNT, "another-user", null};
        for (String owner : owners) {
            FboScanFeedback.Voice voice = new FboScanFeedback.Voice(RuntimeEnvironment.getApplication(), owner);
            try {
                ShadowSoundPool sound = sound(voice);
                voice.scan(true, "ok");
                sound.notifyResourceLoaded(R.raw.fbo_scan_hit, true);
                assertEquals(1, sound.getResourcePlaybacks(R.raw.fbo_scan_hit).size());
                voice.prompt(FboPackingVoice.Cue.NEW_BARCODE);
                sound.notifyResourceLoaded(R.raw.fbs_new_barcode, true);
                assertEquals(1, sound.getResourcePlaybacks(R.raw.fbs_new_barcode).size());
                for (PersonalEventVoice.Cue cue : PersonalEventVoice.Cue.values()) voice.event(cue);
                for (String clip : CLIPS) assertFalse(sound.wasResourcePlayed(raw(clip)));
                assertFalse(sound.wasResourcePlayed(R.raw.eleonora_event_fbs_open));
            } finally { voice.close(); }
        }
    }

    // TEST: closing Sofia's session cancels a pending sample before another user's voice is created.
    @Test public void closedSessionCannotPlayIntoEleonorasSession() throws Exception {
        if (!"logoff".equals(BuildConfig.FLAVOR)) return;
        FboScanFeedback.Voice sofia = new FboScanFeedback.Voice(RuntimeEnvironment.getApplication(), SOFIA);
        ShadowSoundPool oldSound = sound(sofia);
        sofia.prompt(FboPackingVoice.Cue.BARCODE);
        sofia.close();
        oldSound.notifyResourceLoaded(R.raw.fbo_pack_barcode, true);
        assertFalse(oldSound.wasResourcePlayed(R.raw.fbo_pack_barcode));
        FboScanFeedback.Voice eleonora = new FboScanFeedback.Voice(RuntimeEnvironment.getApplication(), PersonalScanVoice.ACCOUNT);
        try {
            ShadowSoundPool sound = sound(eleonora);
            eleonora.event(PersonalEventVoice.Cue.FBS_OPEN);
            sound.notifyResourceLoaded(R.raw.eleonora_event_fbs_open, true);
            assertEquals(1, sound.getResourcePlaybacks(R.raw.eleonora_event_fbs_open).size());
            eleonora.prompt(FboPackingVoice.Cue.NEW_BARCODE);
            sound.notifyResourceLoaded(R.raw.fbs_new_barcode, true);
            assertEquals(1, sound.getResourcePlaybacks(R.raw.fbs_new_barcode).size());
            for (String clip : CLIPS) assertFalse(sound.wasResourcePlayed(raw(clip)));
        } finally { eleonora.close(); }
    }

    // TEST: all approved recordings are real short mono PCM WAV assets usable offline by SoundPool.
    @Test public void recordingsAreShortOfflinePcm() throws Exception {
        for (String clip : CLIPS) {
            byte[] bytes;
            try (InputStream in = RuntimeEnvironment.getApplication().getResources().openRawResource(raw(clip))) {
                bytes = in.readAllBytes();
            }
            ByteBuffer b = ByteBuffer.wrap(bytes).order(ByteOrder.LITTLE_ENDIAN);
            assertEquals("RIFF", new String(bytes, 0, 4, java.nio.charset.StandardCharsets.US_ASCII));
            assertEquals("WAVE", new String(bytes, 8, 4, java.nio.charset.StandardCharsets.US_ASCII));
            boolean fmt = false, data = false;
            for (int at = 12; at + 8 <= bytes.length;) {
                String chunk = new String(bytes, at, 4, java.nio.charset.StandardCharsets.US_ASCII);
                int size = b.getInt(at + 4);
                assertTrue(size >= 0 && (long) at + 8 + size <= bytes.length);
                if ("fmt ".equals(chunk)) {
                    assertEquals(1, b.getShort(at + 8));
                    assertEquals(1, b.getShort(at + 10));
                    assertEquals(22050, b.getInt(at + 12));
                    assertEquals(16, b.getShort(at + 22));
                    fmt = true;
                }
                if ("data".equals(chunk)) {
                    assertTrue(clip + " exceeds SoundPool decoded sample limit", size < 1_000_000);
                    assertTrue(clip + " is too short or too long", size >= 11025 && size <= 220500);
                    data = true;
                }
                at += 8 + size + (size % 2);
            }
            assertTrue(clip, fmt && data);
        }
    }
}
