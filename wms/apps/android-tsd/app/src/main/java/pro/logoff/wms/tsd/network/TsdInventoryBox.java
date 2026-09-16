package pro.logoff.wms.tsd.network;

import java.util.ArrayList;
import java.util.List;

public class TsdInventoryBox {
    public String id;
    public String sessionId;
    public String boxId;
    public String boxCode;
    public String clientId;
    public String clientName;
    public String status;
    // FIX: source inventory impact returned by the server before administrator approval.
    public List<String> kizTransferWarnings = new ArrayList<>();
    public List<TsdInventoryLine> lines = new ArrayList<>();
}
