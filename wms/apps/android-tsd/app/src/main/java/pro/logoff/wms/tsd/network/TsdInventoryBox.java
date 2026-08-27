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
    // FIX: closing metadata for the mini-inventory box list.
    public String countedByName;
    public String completedAt;
    public List<TsdInventoryLine> lines = new ArrayList<>();
}
