package pro.logoff.wms.tsd;
import java.util.LinkedHashMap;
import java.util.Map;

final class FbsKizRelabelRequest {
    private FbsKizRelabelRequest() {}
    // FIX: the audit path may register the physical pair, but must not attach WB or pick stock yet.
    static Map<String, Object> prepare(String oldKiz) {
        Map<String, Object> data = new LinkedHashMap<>();
        data.put("kiz", oldKiz);
        data.put("supportsKizRelabel", true);
        data.put("prepareKizRelabelOnly", true);
        return data;
    }
    static Map<String, Object> confirm(String newKiz, String proposalId, boolean auditOnly) {
        if (proposalId == null || proposalId.trim().isEmpty()) throw new IllegalArgumentException("Missing relabel proposal");
        Map<String, Object> data = new LinkedHashMap<>();
        data.put("kiz", newKiz);
        data.put("supportsKizRelabel", true);
        data.put("confirmKizRelabel", true);
        data.put("kizRelabelProposalId", proposalId);
        data.put("registerKizRelabelOnly", auditOnly);
        return data;
    }
}
