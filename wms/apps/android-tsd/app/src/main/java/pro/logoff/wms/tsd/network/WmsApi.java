package pro.logoff.wms.tsd.network;

import java.util.List;
import java.util.Map;

import retrofit2.Call;
import retrofit2.http.Body;
import retrofit2.http.GET;
import retrofit2.http.Header;
import retrofit2.http.Path;
import retrofit2.http.POST;
import retrofit2.http.PATCH;
import retrofit2.http.Query;

public interface WmsApi {
    @POST("api/v1/tsd/login")
    Call<TsdLoginResponse> login(@Body TsdLoginRequest request);

    @POST("api/v1/tsd/operations")
    Call<TsdOperationResponse> sendOperation(
        @Header("Authorization") String authorization,
        @Body TsdOperationRequest request
    );

    @POST("api/v1/tsd/sync")
    Call<List<TsdOperationResponse>> syncOperations(
        @Header("Authorization") String authorization,
        @Body TsdSyncRequest request
    );

    @GET("api/v1/tsd/clients")
    Call<List<TsdClientSummary>> listClients(@Header("Authorization") String authorization);

    @POST("api/v1/tsd/receipts/open-box")
    Call<Map<String, Object>> openReceiptBox(
        @Header("Authorization") String authorization,
        @Body Map<String, Object> request
    );

    @GET("api/v1/tsd/sku-by-barcode")
    Call<TsdSkuInfo> findSkuByBarcode(
        @Header("Authorization") String authorization,
        @Query("clientId") String clientId,
        @Query("barcode") String barcode
    );

    @GET("api/v1/tsd/receipts/check-kiz")
    Call<TsdKizCheckResponse> checkReceiptKiz(
        @Header("Authorization") String authorization,
        @Query("clientId") String clientId,
        @Query("kiz") String kiz
    );

    @GET("api/v1/tsd/requests")
    Call<List<TsdAssemblyRequestSummary>> listAssemblyRequests(@Header("Authorization") String authorization);

    @GET("api/v1/tsd/requests/{id}")
    Call<TsdAssemblyPlan> getAssemblyRequest(
        @Header("Authorization") String authorization,
        @Path("id") String id
    );

    @GET("api/v1/tsd/requests/{id}/boxless-packing")
    Call<TsdBoxlessPackingResponse> getBoxlessPacking(
        @Header("Authorization") String authorization,
        @Path("id") String id
    );

    @POST("api/v1/tsd/requests/{id}/boxless-packing/open-box")
    Call<TsdBoxlessPackingResponse> openBoxlessPackingBox(
        @Header("Authorization") String authorization,
        @Path("id") String id,
        @Body Map<String, Object> request
    );

    @POST("api/v1/tsd/requests/{id}/boxless-packing/scan-item")
    Call<TsdBoxlessPackingResponse> scanBoxlessPackingItem(
        @Header("Authorization") String authorization,
        @Path("id") String id,
        @Body Map<String, Object> request
    );

    @POST("api/v1/tsd/requests/{id}/boxless-packing/close-box")
    Call<TsdBoxlessPackingResponse> closeBoxlessPackingBox(
        @Header("Authorization") String authorization,
        @Path("id") String id,
        @Body Map<String, Object> request
    );

    @POST("api/v1/tsd/requests/{id}/boxless-packing/finish")
    Call<TsdBoxlessPackingResponse> finishBoxlessPacking(
        @Header("Authorization") String authorization,
        @Path("id") String id,
        @Body Map<String, Object> request
    );

    @POST("api/v1/tsd/requests/{id}/box-search/scan")
    Call<Map<String, Object>> scanAssemblyBox(
        @Header("Authorization") String authorization,
        @Path("id") String id,
        @Body Map<String, String> request
    );

    @POST("api/v1/stock/fulfillment/package-request")
    Call<Map<String, Object>> packageClientRequest(
        @Header("Authorization") String authorization,
        @Body Map<String, Object> request
    );

    @GET("api/v1/inventory/dashboard")
    Call<TsdInventoryDashboard> inventoryDashboard(@Header("Authorization") String authorization);

    @POST("api/v1/inventory/sessions")
    Call<TsdInventorySession> startInventory(
        @Header("Authorization") String authorization,
        @Body Map<String, Object> request
    );

    @GET("api/v1/inventory/sessions/{id}")
    Call<TsdInventorySession> getInventory(
        @Header("Authorization") String authorization,
        @Path("id") String id
    );

    @POST("api/v1/inventory/sessions/{id}/boxes/open")
    Call<TsdInventoryBox> openInventoryBox(
        @Header("Authorization") String authorization,
        @Path("id") String id,
        @Body Map<String, Object> request
    );

    @POST("api/v1/inventory/boxes/{id}/scan")
    Call<TsdInventoryLine> scanInventoryItem(
        @Header("Authorization") String authorization,
        @Path("id") String id,
        @Body Map<String, Object> request
    );

    @PATCH("api/v1/inventory/boxes/{id}/count")
    Call<TsdInventoryLine> setInventoryCount(
        @Header("Authorization") String authorization,
        @Path("id") String id,
        @Body Map<String, Object> request
    );

    @POST("api/v1/inventory/boxes/{id}/finish")
    Call<TsdInventoryBox> finishInventoryBox(
        @Header("Authorization") String authorization,
        @Path("id") String id
    );

    @POST("api/v1/inventory/sessions/{id}/review")
    Call<TsdInventorySession> finishInventory(
        @Header("Authorization") String authorization,
        @Path("id") String id
    );

    @POST("api/v1/stock/transfers/whole-box")
    Call<Map<String, Object>> transferWholeBox(
        @Header("Authorization") String authorization,
        @Body Map<String, Object> request
    );
}
