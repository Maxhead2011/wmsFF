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
    public int foundCount;
    public int remainingCount;
    public int relabelTotal;
    public int movementTotal;
    public boolean storesWithoutBoxes;
    public String assemblyMode;
    public TsdAssemblyProcess activeTsdProcess;
    public List<TsdAssemblyProcess> activeTsdProcesses;
    public List<String> foundBoxCodes;
    public List<String> confirmedOutgoingBoxCodes;
    public List<String> shipmentBoxCodes;
    public List<String> outgoingBoxCodes;
    public List<TsdSearchBoxTask> searchBoxes;
    public List<TsdSearchBoxTask> shipmentBoxes;
    public List<TsdSearchBoxTask> outgoingBoxes;
    public List<TsdRelabelTask> relabelTasks;
    public List<TsdMovementTask> movementTasks;
    public TsdRelabelProgress relabelProgress;
    public TsdMovementProgress movementProgress;

    public static class TsdRelabelProgress {
        public int totalRequired;
        public int totalDone;
        public int totalRemaining;
    }

    public static class TsdMovementProgress {
        public int totalRequired;
        public int totalMoved;
        public int totalRemaining;
        public List<String> doneSourceBoxes;
        public List<TsdMovementSourceBox> sourceBoxes;
        public List<TsdMovementProgressRow> rows;
        public List<TsdActualMovementRow> actualRows;
    }

    public static class TsdMovementSourceBox {
        public String sourceBox;
        public int requiredQuantity;
        public int movedQuantity;
        public int remainingQuantity;
        public boolean done;
        public List<String> targetBoxes;
    }

    public static class TsdMovementProgressRow {
        public String sourceBox;
        public String targetBox;
        public String purpose;
        public String targetRole;
        public String barcode;
        public String name;
        public String size;
        public int quantity;
        public int requiredQuantity;
        public int movedQuantity;
        public int remainingQuantity;
        public boolean done;
        public String note;
        public List<String> actualTargetBoxes;
    }

    public static class TsdActualMovementRow {
        public String sourceBox;
        public String targetBox;
        public String purpose;
        public String targetRole;
        public String barcode;
        public String name;
        public String size;
        public int quantity;
        public String movedAt;
    }
}
