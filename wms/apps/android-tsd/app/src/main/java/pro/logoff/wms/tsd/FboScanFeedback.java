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
    void close();

    final class Voice implements FboScanFeedback {
        private SoundPool pool;
        private final Set<Integer> loaded = new HashSet<>();
        private int hit, miss, pending, stream;
        private final java.util.Map<FboPackingVoice.Cue,Integer> prompts = new java.util.EnumMap<>(FboPackingVoice.Cue.class);
        Voice(Context context) {
            try {
                pool = new SoundPool.Builder().setMaxStreams(1).setAudioAttributes(
                    new AudioAttributes.Builder().setUsage(AudioAttributes.USAGE_ASSISTANCE_SONIFICATION)
                        .setContentType(AudioAttributes.CONTENT_TYPE_SPEECH).build()).build();
                pool.setOnLoadCompleteListener((soundPool, sample, status) -> {
                    if (pool == null || status != 0) return;
                    loaded.add(sample);
                    if (pending == sample) playSample(sample);
                });
                hit = pool.load(context, R.raw.fbo_scan_hit, 1);
                miss = pool.load(context, R.raw.fbo_scan_miss, 1);
                prompts.put(FboPackingVoice.Cue.BOX, pool.load(context, R.raw.fbo_pack_box, 1));
                prompts.put(FboPackingVoice.Cue.BARCODE, pool.load(context, R.raw.fbo_pack_barcode, 1));
                prompts.put(FboPackingVoice.Cue.KIZ, pool.load(context, R.raw.fbo_pack_kiz, 1));
                prompts.put(FboPackingVoice.Cue.PUT, pool.load(context, R.raw.fbo_pack_put, 1));
            } catch (RuntimeException unavailable) { close(); }
        }
        public void play(boolean accepted) { playSample(accepted ? hit : miss); }
        public void prompt(FboPackingVoice.Cue cue) { if(cue!=null) playSample(prompts.getOrDefault(cue,0)); }
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
