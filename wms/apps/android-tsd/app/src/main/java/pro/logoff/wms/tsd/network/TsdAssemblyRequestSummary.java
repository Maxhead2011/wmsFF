package pro.logoff.wms.tsd.network;

import java.util.List;

public class TsdAssemblyRequestSummary {
    public String id;
    // FIX: nullable fields preserve compatibility with older servers.
    public Integer number;
    public Integer totalQuantity;
    public String wmsSummary() {
        return (number == null ? "Заявка WMS" : String.format(java.util.Locale.ROOT, "Заявка WMS №%06d", number))
            + (totalQuantity == null ? "" : " · " + totalQuantity + " ед.");
    }
    public String title;
    public String status;
    public String city;
    public String desiredDate;
    public String createdAt;
    public String updatedAt;
    public TsdAssemblyClient client;
    public int rowsCount;
    public TsdAssemblyWorker inWorkBy;
    public TsdAssemblyProcess activeTsdProcess;
    public List<TsdAssemblyProcess> activeTsdProcesses;
}
