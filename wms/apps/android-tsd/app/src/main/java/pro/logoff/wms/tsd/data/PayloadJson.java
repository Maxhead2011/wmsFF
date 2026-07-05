package pro.logoff.wms.tsd.data;

import org.json.JSONObject;

import java.util.Iterator;
import java.util.LinkedHashMap;
import java.util.Map;

final class PayloadJson {
    private PayloadJson() {
    }

    static String payloadToJson(Map<String, String> payload) {
        return new JSONObject(payload).toString();
    }

    static Map<String, String> jsonToPayload(String payloadJson) {
        Map<String, String> result = new LinkedHashMap<>();
        try {
            JSONObject payload = new JSONObject(payloadJson);
            Iterator<String> keys = payload.keys();
            while (keys.hasNext()) {
                String key = keys.next();
                result.put(key, payload.optString(key));
            }
        } catch (Exception ignored) {
            return result;
        }
        return result;
    }
}
