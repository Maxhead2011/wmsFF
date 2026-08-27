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
    // FIX: fields already returned by the inventory API and shown in the archive.
    public String completedByName;
    public String completedAt;
    public List<TsdInventoryBox> boxes = new ArrayList<>();
    public TsdInventoryProgress progress;
}
