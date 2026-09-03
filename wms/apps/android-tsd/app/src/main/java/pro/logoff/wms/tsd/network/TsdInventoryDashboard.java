package pro.logoff.wms.tsd.network;

import java.util.ArrayList;
import java.util.List;

public class TsdInventoryDashboard {
    public TsdInventorySession activeFull;
    public List<TsdInventorySession> activeSessions = new ArrayList<>();
    public List<TsdInventorySession> reviewSessions = new ArrayList<>();
    public List<TsdInventorySession> historySessions = new ArrayList<>();
    public boolean canManage;
}
