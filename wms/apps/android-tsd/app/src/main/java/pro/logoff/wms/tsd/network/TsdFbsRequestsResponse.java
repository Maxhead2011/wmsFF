package pro.logoff.wms.tsd.network;

import java.util.List;

public class TsdFbsRequestsResponse {
    public String currentRequestId;
    public String message;
    public List<Request> requests;

    public static class Request {
        public String requestId;
        public int requestNumber;
        public String title;
        public String status;
        public Client client;
        public List<String> marketplaces;
        public List<String> supplyIds;
        public List<String> warehouseNames;
        public int totalOrders;
        public int readyOrders;
        public int awaitingWbConfirmation;
        public int noAvailableStock;
        public int completedOrders;
        public int inProgressOrders;
        public String completedAt;
    }

    public static class Client {
        public String id;
        public String code;
        public String name;
    }
}
