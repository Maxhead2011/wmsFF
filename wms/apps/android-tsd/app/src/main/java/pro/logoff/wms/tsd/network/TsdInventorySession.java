package pro.logoff.wms.tsd.network;

import java.util.ArrayList;
import java.util.List;

public class TsdInventorySession {
    public String id;
    public String type;
    public String status;
    public String clientId;
    public String title;
    public String comment;
    public String createdByName;
    public List<TsdInventoryBox> boxes = new ArrayList<>();
    public TsdInventoryProgress progress;
}
