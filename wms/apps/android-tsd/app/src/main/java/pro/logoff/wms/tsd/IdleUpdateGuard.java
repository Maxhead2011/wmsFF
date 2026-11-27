package pro.logoff.wms.tsd;

import java.util.Map;
import org.json.JSONObject;

final class IdleUpdateGuard {
    private IdleUpdateGuard() {}

    static String channelUrl(String profile) {
        if (!ServerSettings.MAIN.equals(profile) && !ServerSettings.BACKUP.equals(profile)) {
            throw new IllegalArgumentException("Не выбран сервер обновлений");
        }
        return ServerSettings.baseUrl(profile) + ServerSettings.apkPath("pro.logoff.wms.tsd.servers");
    }
    // FIX: receipt drafts in released builds survive navigation to the menu.
    static boolean hasReceiptDraft(Map<String, ?> entries) {
        for (String key : entries.keySet()) {
            if (key.startsWith("receipt-box-draft:v1:")) return true;
        }
        return false;
    }

    static boolean hasFboScan(Map<String,?> entries) {
        for(Map.Entry<String,?> e:entries.entrySet()){
            String key=e.getKey();
            if(key.endsWith(":position")){
                try {
                    // FIX: a persisted UI checkpoint survives package replacement; it is not a pending API command.
                    // Validate it, preserve every byte and continue blocking actual command keys below.
                    new JSONObject((String)e.getValue());
                } catch(Exception invalid){return true;}
            } else if(!(key.endsWith(":directionPacking") || key.endsWith(":mode") || key.endsWith(":picking-mode") || key.endsWith(":fast"))) return true;
        }
        return false;
    }
}
