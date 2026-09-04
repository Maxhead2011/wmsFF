package pro.logoff.wms.tsd.network;

import java.util.ArrayList;
import java.util.List;

public class TsdSkuCollection {
    public String id;
    public int number;
    public String title;
    public String status;
    public TsdAssemblyClient client;
    public List<Source> skuCollectionSources = new ArrayList<>();
    public List<Scan> skuCollectionScans = new ArrayList<>();

    public int planned() {
        int value = 0;
        for (Source source : skuCollectionSources) value += source.plannedQuantity;
        return value;
    }

    public int picked() {
        int value = 0;
        for (Source source : skuCollectionSources) value += source.pickedQuantity;
        return value;
    }

    public int received() {
        int value = 0;
        for (Source source : skuCollectionSources) value += source.receivedQuantity;
        return value;
    }

    public static class Source {
        public String id;
        public String sourceBoxCode;
        public int plannedQuantity;
        public int pickedQuantity;
        public int receivedQuantity;
        public StorageLocation storageLocation;

        // FIX: keep a readable route even with an older API or an unknown placement.
        public String routeLabel(boolean uzbek) {
            String unknown = uzbek ? "ko‘rsatilmagan" : "не указано";
            String room = storageLocation == null ? null : storageLocation.zoneName;
            if (room == null || room.trim().isEmpty()) {
                room = storageLocation == null ? null : storageLocation.zoneCode;
            }
            String pallet = storageLocation == null ? null : storageLocation.palletCode;
            return (uzbek ? "Xona: " : "Помещение: ") + valueOr(room, unknown) + "\n"
                + (uzbek ? "Pallet-sort: " : "Паллетсорт: ") + valueOr(pallet, uzbek ? unknown : "не указан") + "\n"
                + (uzbek ? "Quti: " : "Короб: ") + valueOr(sourceBoxCode, uzbek ? unknown : "не указан");
        }

        private static String valueOr(String value, String fallback) {
            return value == null || value.trim().isEmpty() ? fallback : value.trim();
        }
    }

    public static class StorageLocation {
        public String palletCode;
        public String zoneName;
        public String zoneCode;
    }

    public static class Scan {
        public String id;
        public String kiz;
        public String sourceBoxCode;
        public String targetBoxCode;
        public String status;
    }
}
