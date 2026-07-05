package pro.logoff.wms.tsd.network;

import java.util.List;

public class TsdAssemblyPlan {
    public String id;
    public String title;
    public String status;
    public String statusLabel;
    public String city;
    public String desiredDate;
    public TsdAssemblyClient client;
    public int rowsCount;
    public int totalRequested;
    public int boxesTotal;
    public int relabelTotal;
    public int movementTotal;
    public List<TsdSearchBoxTask> searchBoxes;
    public List<TsdRelabelTask> relabelTasks;
    public List<TsdMovementTask> movementTasks;
}
