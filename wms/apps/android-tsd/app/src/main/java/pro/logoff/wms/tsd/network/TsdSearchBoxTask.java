package pro.logoff.wms.tsd.network;

public class TsdSearchBoxTask {
    public String boxCode;
    public boolean found;
    public boolean isFound;
    public String instructionType;
    public String instructionLabel;
    public boolean requiresRelabel;
    public boolean requiresMovement;
    public boolean shipsWhole;
    public StorageLocation storageLocation;

    public static class StorageLocation {
        public String palletId;
        public String palletCode;
        public String zoneId;
        public String zoneCode;
        public String zoneName;
    }
}
