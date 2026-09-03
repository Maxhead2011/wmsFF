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
    }

    public static class Scan {
        public String id;
        public String kiz;
        public String sourceBoxCode;
        public String targetBoxCode;
        public String status;
    }
}
