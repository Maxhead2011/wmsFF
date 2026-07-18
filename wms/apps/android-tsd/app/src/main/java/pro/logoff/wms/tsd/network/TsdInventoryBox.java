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
    public List<TsdInventoryLine> lines = new ArrayList<>();
}
