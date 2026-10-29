package pro.logoff.wms.tsd;

import android.content.Context;
import android.media.AudioAttributes;
import android.media.SoundPool;
import java.util.HashSet;
import java.util.Set;

// FIX: bundled speech works offline and never depends on a TTS engine installed on the TSD.
interface FboScanFeedback {
    void play(boolean accepted);
    default void prompt(FboPackingVoice.Cue cue) {}
    default void scan(boolean accepted,String errorKey){play(accepted);}
    default void error(String errorKey){prompt(FboPackingVoice.Cue.ERROR);}
    default void success(){}
    default void event(PersonalEventVoice.Cue cue) {}
    void close();

    final class Voice implements FboScanFeedback {
        private SoundPool pool;
        private final Set<Integer> loaded = new HashSet<>();
        private final java.util.Map<Integer,Integer> samples = new java.util.HashMap<>();
        private int hit, miss, repeat, pending, stream;
        private final PersonalScanVoice personal;
        private final java.util.Map<PersonalEventVoice.Cue,Integer> events = new java.util.EnumMap<>(PersonalEventVoice.Cue.class);
        private final java.util.Map<FboPackingVoice.Cue,Integer> prompts = new java.util.EnumMap<>(FboPackingVoice.Cue.class);
        Voice(Context context) { this(context,null); }
        Voice(Context context,String userId) {
            personal=new PersonalScanVoice(userId);
            try {
                pool = new SoundPool.Builder().setMaxStreams(1).setAudioAttributes(
                    new AudioAttributes.Builder().setUsage(AudioAttributes.USAGE_ASSISTANCE_SONIFICATION)
                        .setContentType(AudioAttributes.CONTENT_TYPE_SPEECH).build()).build();
                pool.setOnLoadCompleteListener((soundPool, sample, status) -> {
                    if (pool == null || status != 0) return;
                    loaded.add(sample);
                    if (pending == sample) playSample(sample);
                });
                // FIX: route the same confirmed events to each account's offline recordings.
                hit = loadSample(context, personal.resource(R.raw.fbo_scan_hit,R.raw.eleonora_hit,R.raw.sofia_tanks_hit));
                miss = loadSample(context, personal.resource(R.raw.fbo_scan_miss,R.raw.eleonora_miss,R.raw.sofia_tanks_miss));
                prompts.put(FboPackingVoice.Cue.BOX, loadSample(context, personal.resource(R.raw.fbo_pack_box,R.raw.eleonora_box,R.raw.sofia_tanks_begin)));
                prompts.put(FboPackingVoice.Cue.BARCODE, loadSample(context, personal.resource(R.raw.fbo_pack_barcode,R.raw.eleonora_barcode,R.raw.sofia_tanks_target)));
                prompts.put(FboPackingVoice.Cue.KIZ, loadSample(context, personal.resource(R.raw.fbo_pack_kiz,R.raw.eleonora_kiz,R.raw.sofia_tanks_locked)));
                prompts.put(FboPackingVoice.Cue.NEW_BARCODE, loadSample(context, personal.resource(R.raw.fbs_new_barcode,R.raw.fbs_new_barcode,R.raw.sofia_tanks_reset)));
                prompts.put(FboPackingVoice.Cue.PUT, loadSample(context, personal.resource(R.raw.fbo_pack_put,R.raw.eleonora_put,R.raw.sofia_tanks_put)));
                prompts.put(FboPackingVoice.Cue.ERROR, loadSample(context, personal.resource(R.raw.fbo_pack_error,R.raw.eleonora_error,R.raw.sofia_tanks_armor)));
                prompts.put(FboPackingVoice.Cue.CLOSED, loadSample(context, personal.resource(R.raw.fbo_pack_closed,R.raw.eleonora_closed,R.raw.sofia_tanks_ready)));
                if(personal.personal){
                    repeat=loadSample(context,personal.resource(0,R.raw.eleonora_repeat,R.raw.sofia_tanks_repeat));
                    events.put(PersonalEventVoice.Cue.FBS_OPEN,loadSample(context,personal.resource(0,R.raw.eleonora_event_fbs_open,R.raw.sofia_tanks_start)));
                    events.put(PersonalEventVoice.Cue.FBS_DONE,loadSample(context,personal.resource(0,R.raw.eleonora_event_fbs_done,R.raw.sofia_tanks_ready)));
                    events.put(PersonalEventVoice.Cue.FBS_EMPTY,loadSample(context,personal.resource(0,R.raw.eleonora_event_fbs_empty,R.raw.sofia_tanks_empty)));
                    events.put(PersonalEventVoice.Cue.RECOUNT,loadSample(context,personal.resource(0,R.raw.eleonora_event_recount,R.raw.sofia_tanks_begin)));
                    events.put(PersonalEventVoice.Cue.KIZ_CHECK,loadSample(context,personal.resource(0,R.raw.eleonora_event_kiz_check,R.raw.sofia_tanks_start)));
                    events.put(PersonalEventVoice.Cue.PALLET,loadSample(context,personal.resource(0,R.raw.eleonora_event_pallet,R.raw.sofia_tanks_move)));
                }
            } catch (RuntimeException unavailable) { close(); }
        }
        // FIX: several Sofia events share a phrase; decode each recording only once per session.
        private int loadSample(Context context,int resource){
            Integer existing=samples.get(resource);
            if(existing!=null)return existing;
            int sample=pool.load(context,resource,1);
            samples.put(resource,sample);
            return sample;
        }
        public void play(boolean accepted) { scan(accepted,"scan:miss"); }
        public void scan(boolean accepted,String errorKey) {
            if(accepted){personal.success();playSample(hit);}
            else playSample(personal.repeated(errorKey)?repeat:miss);
        }
        public void error(String errorKey) { playSample(personal.repeated(errorKey)?repeat:prompts.getOrDefault(FboPackingVoice.Cue.ERROR,0)); }
        public void success(){personal.success();}
        public void prompt(FboPackingVoice.Cue cue) {
            // FIX: offline "Попал", including the user's personal voice pack.
            if(cue==FboPackingVoice.Cue.PACKED_BOX){scan(true,"packing:box");return;}
            if(cue==FboPackingVoice.Cue.ERROR){error("packing:error");return;}
            if(cue==FboPackingVoice.Cue.PUT||cue==FboPackingVoice.Cue.CLOSED)personal.success();
            if(cue!=null)playSample(prompts.getOrDefault(cue,0));
        }
        public void event(PersonalEventVoice.Cue cue){if(personal.personal&&cue!=null)playSample(events.getOrDefault(cue,0));}
        private void playSample(int sample) {
            if (pool == null || sample == 0) return;
            // FIX: rapid scans replace the previous phrase, including while sounds are loading.
            pending = sample;
            if (!loaded.contains(sample)) return;
            try {
                if (stream != 0) pool.stop(stream);
                stream = pool.play(sample, 1f, 1f, 1, 0, 1f);
                pending = 0;
            } catch (RuntimeException unavailable) { close(); }
        }
        public void close() {
            SoundPool previous = pool;
            pool = null; pending = 0; stream = 0; loaded.clear(); samples.clear();
            if (previous != null) {
                try { previous.release(); } catch (RuntimeException ignored) { }
            }
        }
    }
}
