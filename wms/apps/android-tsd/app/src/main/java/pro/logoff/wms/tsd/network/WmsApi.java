package pro.logoff.wms.tsd.network;

import java.util.List;
import java.util.Map;

import retrofit2.Call;
import retrofit2.http.Body;
import retrofit2.http.DELETE;
import retrofit2.http.GET;
import retrofit2.http.Header;
import retrofit2.http.Path;
import retrofit2.http.POST;
import retrofit2.http.PATCH;
import retrofit2.http.Query;
import retrofit2.http.Multipart;
import retrofit2.http.Part;
import okhttp3.MultipartBody;

public interface WmsApi {
    @POST("api/v1/tsd/login")
    Call<TsdLoginResponse> login(@Body TsdLoginRequest request);

    @POST("api/v1/tsd/monitor/heartbeat")
    Call<Map<String, Object>> sendMonitorHeartbeat(
        @Header("Authorization") String authorization,
        @Body Map<String, Object> request
    );

    @POST("api/v1/tsd/monitor/error")
    Call<Map<String, Object>> sendMonitorError(
        @Header("Authorization") String authorization,
        @Body Map<String, Object> request
    );

    @Multipart
    @POST("api/v1/tsd/monitor/error/{id}/screenshot")
    Call<Map<String, Object>> uploadMonitorErrorScreenshot(
        @Header("Authorization") String authorization,
        @Path("id") String operationId,
        @Part MultipartBody.Part screenshot
    );

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

    // FIX: isolated SKU collection endpoints preserve all existing transfer and FBS routes.
    @GET("api/v1/tsd/sku-collections")
    Call<List<TsdSkuCollection>> listSkuCollections(@Header("Authorization") String authorization);

    @GET("api/v1/tsd/sku-collections/{id}")
    Call<TsdSkuCollection> getSkuCollection(
        @Header("Authorization") String authorization,
        @Path("id") String id
    );

    @POST("api/v1/tsd/sku-collections/{id}/pick")
    Call<TsdSkuCollection> pickSkuCollection(
        @Header("Authorization") String authorization,
        @Path("id") String id,
        @Body Map<String, Object> request
    );

    @POST("api/v1/tsd/sku-collections/{id}/receive")
    Call<TsdSkuCollection> receiveSkuCollection(
        @Header("Authorization") String authorization,
        @Path("id") String id,
        @Body Map<String, Object> request
    );

    @GET("api/v1/tsd/transfers/source")
    Call<TsdTransferResponse> inspectTransferSource(
        @Header("Authorization") String authorization,
        @Query("boxCode") String boxCode
    );

    @POST("api/v1/tsd/transfers/item")
    Call<TsdTransferResponse> inspectTransferItem(
        @Header("Authorization") String authorization,
        @Body Map<String, Object> request
    );

    @POST("api/v1/tsd/transfers/execute")
    Call<TsdTransferResponse> executeTransfer(
        @Header("Authorization") String authorization,
        @Body Map<String, Object> request
    );

    @POST("api/v1/tsd/transfers/execute-batch")
    Call<TsdTransferResponse> executeTransferBatch(
        @Header("Authorization") String authorization,
        @Body Map<String, Object> request
    );

    @GET("api/v1/tsd/storage-pallet/current")
    Call<TsdStoragePalletResponse> currentStoragePallet(
        @Header("Authorization") String authorization,
        @Query("deviceCode") String deviceCode
    );

    @POST("api/v1/tsd/storage-pallet/open")
    Call<TsdStoragePalletResponse> openStoragePallet(
        @Header("Authorization") String authorization,
        @Body Map<String, Object> request
    );

    @POST("api/v1/tsd/storage-pallet/{id}/scan-box")
    Call<TsdStoragePalletResponse> scanStoragePalletBox(
        @Header("Authorization") String authorization,
        @Path("id") String id,
        @Body Map<String, Object> request
    );

    @POST("api/v1/tsd/storage-pallet/{id}/restore-box")
    Call<TsdStoragePalletResponse> restoreStoragePalletBox(
        @Header("Authorization") String authorization,
        @Path("id") String id,
        @Body Map<String, Object> request
    );

    @POST("api/v1/tsd/storage-pallet/{id}/close")
    Call<TsdStoragePalletResponse> closeStoragePallet(
        @Header("Authorization") String authorization,
        @Path("id") String id
    );

    @DELETE("api/v1/tsd/storage-pallet/{id}")
    Call<TsdStoragePalletResponse> deleteStoragePallet(
        @Header("Authorization") String authorization,
        @Path("id") String id
    );

    @GET("api/v1/tsd/fbs/next")
    Call<TsdFbsAssemblyResponse> nextFbsAssembly(
        @Header("Authorization") String authorization,
        @Query("deviceCode") String deviceCode,
        @Query("requestId") String requestId
    );

    @GET("api/v1/tsd/fbs/requests")
    Call<TsdFbsRequestsResponse> listFbsAssemblyRequests(
        @Header("Authorization") String authorization,
        @Query("deviceCode") String deviceCode,
        @Query("archive") String archive
    );

    @POST("api/v1/tsd/fbs/tasks/{id}/scan-box")
    Call<TsdFbsAssemblyResponse> scanFbsBox(
        @Header("Authorization") String authorization,
        @Path("id") String id,
        @Body Map<String, Object> request
    );

    @POST("api/v1/tsd/fbs/tasks/{id}/scan")
    Call<TsdFbsAssemblyResponse> scanFbsCode(
        @Header("Authorization") String authorization,
        @Path("id") String id,
        @Body Map<String, Object> request
    );

    @POST("api/v1/tsd/fbs/tasks/{id}/scan-barcode")
    Call<TsdFbsAssemblyResponse> scanFbsBarcode(
        @Header("Authorization") String authorization,
        @Path("id") String id,
        @Body Map<String, Object> request
    );

    @POST("api/v1/tsd/fbs/tasks/{id}/scan-kiz")
    Call<TsdFbsAssemblyResponse> scanFbsKiz(
        @Header("Authorization") String authorization,
        @Path("id") String id,
        @Body Map<String, Object> request
    );

    @POST("api/v1/tsd/fbs/tasks/{id}/undo-kiz")
    Call<TsdFbsAssemblyResponse> undoFbsKiz(
        @Header("Authorization") String authorization,
        @Path("id") String id
    );

    @POST("api/v1/tsd/fbs/tasks/{id}/complete")
    Call<TsdFbsAssemblyResponse> completeFbsAssembly(
        @Header("Authorization") String authorization,
        @Path("id") String id
    );

    @POST("api/v1/tsd/fbs/tasks/{id}/release")
    Call<TsdFbsAssemblyResponse> releaseFbsAssembly(
        @Header("Authorization") String authorization,
        @Path("id") String id
    );

    @GET("api/v1/tsd/fbs/cargo")
    Call<TsdFbsCargoPackingResponse> getFbsCargoPacking(
        @Header("Authorization") String authorization,
        @Query("deviceCode") String deviceCode
    );

    @POST("api/v1/tsd/fbs/cargo/open")
    Call<TsdFbsCargoPackingResponse> openFbsCargoPacking(
        @Header("Authorization") String authorization,
        @Body Map<String, Object> request
    );

    @POST("api/v1/tsd/fbs/cargo/{id}/scan-order")
    Call<TsdFbsCargoPackingResponse> scanFbsCargoOrder(
        @Header("Authorization") String authorization,
        @Path("id") String id,
        @Body Map<String, Object> request
    );

    @POST("api/v1/tsd/fbs/cargo/{id}/undo-last")
    Call<TsdFbsCargoPackingResponse> undoLastFbsCargoOrder(
        @Header("Authorization") String authorization,
        @Path("id") String id
    );

    @POST("api/v1/tsd/fbs/cargo/{id}/cancel")
    Call<TsdFbsCargoPackingResponse> cancelFbsCargoPacking(
        @Header("Authorization") String authorization,
        @Path("id") String id
    );

    @POST("api/v1/tsd/fbs/cargo/{id}/close")
    Call<TsdFbsCargoPackingResponse> closeFbsCargoPacking(
        @Header("Authorization") String authorization,
        @Path("id") String id
    );

    @GET("api/v1/ozon-fbo/overview")
    Call<TsdOzonFboOverview> listOzonFboPlans(
        @Header("Authorization") String authorization,
        @Query("clientId") String clientId
    );

    @GET("api/v1/ozon-fbo/plans/{id}")
    Call<TsdOzonFboPlan> getOzonFboPlan(
        @Header("Authorization") String authorization,
        @Path("id") String id
    );

    @POST("api/v1/ozon-fbo/boxes/{id}/scan")
    Call<TsdOzonFboPlan.Box> scanOzonFboBox(
        @Header("Authorization") String authorization,
        @Path("id") String id,
        @Body Map<String, String> request
    );

    @POST("api/v1/ozon-fbo/boxes/{id}/close")
    Call<TsdOzonFboPlan> closeOzonFboBox(
        @Header("Authorization") String authorization,
        @Path("id") String id
    );

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
    Call<TsdInventoryDashboard> inventoryDashboard(
        @Header("Authorization") String authorization,
        @Query("workOnly") boolean workOnly
    );

    @POST("api/v1/inventory/sessions")
    Call<TsdInventorySession> startInventory(
        @Header("Authorization") String authorization,
        @Body Map<String, Object> request
    );

    @GET("api/v1/inventory/sessions/{id}")
    Call<TsdInventorySession> getInventory(
        @Header("Authorization") String authorization,
        @Path("id") String id,
        @Query("workOnly") boolean workOnly
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

    @POST("api/v1/inventory/boxes/{id}/resolve")
    Call<TsdInventoryBox> resolveInventoryBox(
        @Header("Authorization") String authorization,
        @Path("id") String id,
        @Body Map<String, Object> request
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
