package pro.logoff.wms.tsd;
import org.junit.Test;import static org.junit.Assert.*;
import org.junit.runner.RunWith;import org.robolectric.RobolectricTestRunner;import org.robolectric.RuntimeEnvironment;import org.robolectric.Shadows;import org.robolectric.annotation.Config;import android.media.SoundPool;
import pro.logoff.wms.tsd.network.TsdFbsAssemblyResponse;
@RunWith(RobolectricTestRunner.class) @Config(sdk=28)
public class PersonalEventVoiceTest {
 // TEST: selection only speaks on a successful response, once.
 @Test public void openOnce(){var v=new PersonalEventVoice();var r=new TsdFbsAssemblyResponse();r.task=new TsdFbsAssemblyResponse.Task();v.selected("r");assertNull(v.fbs("r",null));assertEquals(PersonalEventVoice.Cue.FBS_OPEN,v.fbs("r",r));assertNull(v.fbs("r",r));v.selected("s");assertNull(v.fbs("r",r));assertEquals(PersonalEventVoice.Cue.FBS_OPEN,v.fbs("s",r));}
 // TEST: empty and blocked queues never mean completed; repeated renders stay silent.
 @Test public void emptyAndCompleteDiffer(){var v=new PersonalEventVoice();var r=new TsdFbsAssemblyResponse();r.progress=new TsdFbsAssemblyResponse.Progress();v.selected("r");assertEquals(PersonalEventVoice.Cue.FBS_EMPTY,v.fbs("r",r));assertNull(v.fbs("r",r));r.progress.requestTotalItems=3;r.progress.requestCompletedItems=2;r.progress.requestRemainingItems=1;assertNull(v.fbs("r",r));r.progress.requestCompletedItems=3;r.progress.requestRemainingItems=0;assertEquals(PersonalEventVoice.Cue.FBS_DONE,v.fbs("r",r));assertNull(v.fbs("r",r));}
 // TEST: work becoming available resets terminal announcement.
 @Test public void workResumes(){var v=new PersonalEventVoice();var r=new TsdFbsAssemblyResponse();assertEquals(PersonalEventVoice.Cue.FBS_EMPTY,v.fbs("r",r));r.task=new TsdFbsAssemblyResponse.Task();assertNull(v.fbs("r",r));r.task=null;assertEquals(PersonalEventVoice.Cue.FBS_EMPTY,v.fbs("r",r));}
 // TEST: six recordings are restricted to the exact account on our flavor.
 @Test public void accountAndResources()throws Exception{int[] ids={R.raw.eleonora_event_fbs_open,R.raw.eleonora_event_fbs_done,R.raw.eleonora_event_fbs_empty,R.raw.eleonora_event_recount,R.raw.eleonora_event_kiz_check,R.raw.eleonora_event_pallet};for(String owner:new String[]{PersonalScanVoice.ACCOUNT,"another-user"}){var v=new FboScanFeedback.Voice(RuntimeEnvironment.getApplication(),owner);var f=FboScanFeedback.Voice.class.getDeclaredField("pool");f.setAccessible(true);var sound=Shadows.shadowOf((SoundPool)f.get(v));boolean enabled=owner.equals(PersonalScanVoice.ACCOUNT)&&"logoff".equals(BuildConfig.FLAVOR);for(int i=0;i<ids.length;i++){v.event(PersonalEventVoice.Cue.values()[i]);if(enabled)sound.notifyResourceLoaded(ids[i],true);assertEquals(enabled?1:0,sound.getResourcePlaybacks(ids[i]).size());}v.close();}}
}
