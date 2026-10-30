package pro.logoff.wms.tsd.network;

public class TsdClientSummary {
    public String id;
    public String code;
    public String name;
    public boolean storesWithoutBoxes;
    public java.util.List<Store> stores;
    public static class Store { public String id; public String name; }
}
