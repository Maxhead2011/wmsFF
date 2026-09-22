package pro.logoff.wms.tsd;

import android.content.Context;
import android.media.AudioAttributes;
import android.media.SoundPool;
import java.util.HashSet;
import java.util.Set;

// FIX: bundled female speech works offline and never depends on a TTS engine installed on the TSD.
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
                hit = pool.load(context, (personal.personal?R.raw.eleonora_hit:R.raw.fbo_scan_hit), 1);
                miss = pool.load(context, (personal.personal?R.raw.eleonora_miss:R.raw.fbo_scan_miss), 1);
                prompts.put(FboPackingVoice.Cue.BOX, pool.load(context, (personal.personal?R.raw.eleonora_box:R.raw.fbo_pack_box), 1));
                prompts.put(FboPackingVoice.Cue.BARCODE, pool.load(context, (personal.personal?R.raw.eleonora_barcode:R.raw.fbo_pack_barcode), 1));
                prompts.put(FboPackingVoice.Cue.KIZ, pool.load(context, (personal.personal?R.raw.eleonora_kiz:R.raw.fbo_pack_kiz), 1));
                // FIX: the user-provided new-barcode recording also fills Eleonora's missing cue.
                prompts.put(FboPackingVoice.Cue.NEW_BARCODE, pool.load(context, R.raw.fbs_new_barcode, 1));
                prompts.put(FboPackingVoice.Cue.PUT, pool.load(context, (personal.personal?R.raw.eleonora_put:R.raw.fbo_pack_put), 1));
                prompts.put(FboPackingVoice.Cue.ERROR, pool.load(context, (personal.personal?R.raw.eleonora_error:R.raw.fbo_pack_error), 1));
                prompts.put(FboPackingVoice.Cue.CLOSED, pool.load(context, (personal.personal?R.raw.eleonora_closed:R.raw.fbo_pack_closed), 1));
                if(personal.personal)repeat=pool.load(context,R.raw.eleonora_repeat,1);
                if(personal.personal){
                    events.put(PersonalEventVoice.Cue.FBS_OPEN,pool.load(context,R.raw.eleonora_event_fbs_open,1));
                    events.put(PersonalEventVoice.Cue.FBS_DONE,pool.load(context,R.raw.eleonora_event_fbs_done,1));
                    events.put(PersonalEventVoice.Cue.FBS_EMPTY,pool.load(context,R.raw.eleonora_event_fbs_empty,1));
                    events.put(PersonalEventVoice.Cue.RECOUNT,pool.load(context,R.raw.eleonora_event_recount,1));
                    events.put(PersonalEventVoice.Cue.KIZ_CHECK,pool.load(context,R.raw.eleonora_event_kiz_check,1));
                    events.put(PersonalEventVoice.Cue.PALLET,pool.load(context,R.raw.eleonora_event_pallet,1));
                }
            } catch (RuntimeException unavailable) { close(); }
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
            pool = null; pending = 0; stream = 0; loaded.clear();
            if (previous != null) {
                try { previous.release(); } catch (RuntimeException ignored) { }
            }
        }
    }
}
