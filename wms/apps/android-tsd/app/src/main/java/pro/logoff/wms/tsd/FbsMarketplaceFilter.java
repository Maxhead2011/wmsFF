package pro.logoff.wms.tsd;

import java.util.ArrayList;
import java.util.List;
import pro.logoff.wms.tsd.network.TsdFbsRequestsResponse;

// FIX: do not mix WB and Ozon requests or silently treat an unknown marketplace as WB.
final class FbsMarketplaceFilter {
    static List<TsdFbsRequestsResponse.Request> select(List<TsdFbsRequestsResponse.Request> requests, String marketplace) {
        List<TsdFbsRequestsResponse.Request> result = new ArrayList<>();
        if (requests == null) return result;
        for (TsdFbsRequestsResponse.Request request : requests) {
            if (request == null) continue;
            if (marketplace == null || marketplace.isEmpty()) { result.add(request); continue; }
            if (request.marketplaces == null || request.marketplaces.isEmpty()) continue;
            boolean matches = true;
            for (String value : request.marketplaces) if (!marketplace.equalsIgnoreCase(value)) matches = false;
            if (matches) result.add(request);
        }
        return result;
    }
}
