package pro.logoff.wms.tsd.network;

import java.util.List;

public class TsdOzonFboOverview {
    public List<Plan> plans;

    public static class Plan {
        public String id;
        public String title;
        public String status;
        public String sourceFileName;
        public int totalUnits;
        public int assembledUnits;
        public int boxes;
        public int closedBoxes;
    }
}
