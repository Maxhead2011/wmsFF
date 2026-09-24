package pro.logoff.wms.tsd;
import org.junit.Test;
import static org.junit.Assert.*;
import android.media.SoundPool;
import org.junit.runner.RunWith;
import org.robolectric.RuntimeEnvironment;
import org.robolectric.RobolectricTestRunner;
import org.robolectric.Shadows;
import org.robolectric.annotation.Config;
import org.robolectric.shadows.ShadowSoundPool;

@RunWith(RobolectricTestRunner.class) @Config(sdk=28)
public class PersonalScanVoiceTest {
    // TEST: identity and flavor, never display name, select the personal account.
    @Test public void identityAndRepeatedErrors(){
        PersonalScanVoice p=new PersonalScanVoice(PersonalScanVoice.ACCOUNT);
        assertEquals("logoff".equals(BuildConfig.FLAVOR),p.personal);
        assertFalse(new PersonalScanVoice("Элькапоне").personal);
        assertFalse(new PersonalScanVoice(null).personal);
        assertFalse(p.repeated("wrong-box"));
        assertEquals(p.personal,p.repeated("wrong-box"));
        assertEquals(p.personal,p.repeated("wrong-box"));
        assertFalse(p.repeated("wrong-barcode"));
        p.success();assertFalse(p.repeated("wrong-barcode"));
    }
    // TEST: every personal recording maps to its intended cue, other accounts keep common audio.
    @Test public void resourcesAndRepeatReset() throws Exception {
        if(!"logoff".equals(BuildConfig.FLAVOR))return;
        FboScanFeedback.Voice voice=new FboScanFeedback.Voice(RuntimeEnvironment.getApplication(),PersonalScanVoice.ACCOUNT);
        var field=FboScanFeedback.Voice.class.getDeclaredField("pool");field.setAccessible(true);
        ShadowSoundPool sound=Shadows.shadowOf((SoundPool)field.get(voice));
        int[] ids={R.raw.eleonora_box,R.raw.eleonora_barcode,R.raw.eleonora_kiz,R.raw.eleonora_put,R.raw.eleonora_error,R.raw.eleonora_closed};
        try {
            for(int i=0;i<ids.length;i++){voice.prompt(FboPackingVoice.Cue.values()[i]);sound.notifyResourceLoaded(ids[i],true);assertEquals(1,sound.getResourcePlaybacks(ids[i]).size());}
            sound.notifyResourceLoaded(R.raw.eleonora_repeat,true);
            voice.error("bad-kiz");assertEquals(2,sound.getResourcePlaybacks(R.raw.eleonora_error).size());
            voice.error("bad-kiz");voice.error("bad-kiz");assertEquals(2,sound.getResourcePlaybacks(R.raw.eleonora_repeat).size());
            voice.success();voice.error("bad-kiz");assertEquals(3,sound.getResourcePlaybacks(R.raw.eleonora_error).size());
            voice.error("other-error");assertEquals(4,sound.getResourcePlaybacks(R.raw.eleonora_error).size());
            voice.success();voice.scan(false,"bad-barcode");sound.notifyResourceLoaded(R.raw.eleonora_miss,true);assertEquals(1,sound.getResourcePlaybacks(R.raw.eleonora_miss).size());
            voice.scan(false,"bad-barcode");assertEquals(3,sound.getResourcePlaybacks(R.raw.eleonora_repeat).size());
            voice.scan(true,"ok");sound.notifyResourceLoaded(R.raw.eleonora_hit,true);voice.scan(false,"bad-barcode");assertEquals(2,sound.getResourcePlaybacks(R.raw.eleonora_miss).size());
            assertFalse(sound.wasResourcePlayed(R.raw.fbo_scan_hit));assertFalse(sound.wasResourcePlayed(R.raw.fbo_pack_box));
        }finally{voice.close();}
        FboScanFeedback.Voice other=new FboScanFeedback.Voice(RuntimeEnvironment.getApplication(),"another-user");
        try{ShadowSoundPool normal=Shadows.shadowOf((SoundPool)field.get(other));other.error("x");normal.notifyResourceLoaded(R.raw.fbo_pack_error,true);other.error("x");assertEquals(2,normal.getResourcePlaybacks(R.raw.fbo_pack_error).size());assertFalse(normal.wasResourcePlayed(R.raw.eleonora_error));}finally{other.close();}
    }
}
