package pro.logoff.wms.mobile.network;

import java.util.List;
import java.util.Map;

import okhttp3.MultipartBody;
import okhttp3.RequestBody;
import okhttp3.ResponseBody;
import retrofit2.Call;
import retrofit2.http.Body;
import retrofit2.http.DELETE;
import retrofit2.http.GET;
import retrofit2.http.Multipart;
import retrofit2.http.PATCH;
import retrofit2.http.POST;
import retrofit2.http.Part;
import retrofit2.http.Path;
import retrofit2.http.Query;
import retrofit2.http.Streaming;
import retrofit2.http.PUT;

public interface MobileApi {
    // FIX: existing client management routes retain server-side access checks.
    // FIX: existing scoped SKU endpoints; client ownership/stock are excluded by the native form.
    @GET("skus/{id}") Call<Map<String,Object>> skuDetails(@Path("id") String id);
    @PATCH("skus/{id}") Call<Map<String,Object>> updateSkuDetails(@Path("id") String id,@Body Map<String,Object> changes);
    @GET("clients/{id}") Call<Map<String,Object>> clientDetails(@Path("id") String id);
    @PATCH("clients/{id}") Call<Map<String,Object>> updateClientDetails(@Path("id") String id,@Body Map<String,Object> changes);
    // FIX: existing permission-checked, preview-validated financial operations.
    @GET("billing/period-close/capabilities") Call<Map<String,Object>> financialCapabilities();
    @GET("billing/invoices") Call<List<Map<String,Object>>> correctionInvoices(@Query("clientId") String clientId);
    @POST("billing/period-close/preview") Call<Map<String,Object>> previewPeriodClose(@Body Map<String,Object> body);
    @POST("billing/period-close") Call<Map<String,Object>> closePeriod(@Body Map<String,Object> body);
    @POST("billing/period-close/corrections/preview") Call<Map<String,Object>> previewInvoiceCorrection(@Body Map<String,Object> body);
    @POST("billing/period-close/corrections") Call<Map<String,Object>> correctInvoice(@Body Map<String,Object> body);
    // FIX: read-only server projections, with existing authenticated Retrofit transport.
    @GET("billing/settlements") Call<Map<String,Object>> settlements(@Query("periodFrom") String from, @Query("periodTo") String to, @Query("clientId") String clientId);
    @GET("billing/period-close") Call<List<Map<String,Object>>> closedPeriods(@Query("clientId") String clientId, @Query("periodFrom") String from, @Query("periodTo") String to);
    // FIX: server-scoped read-only correction ledger, not a new financial mutation.
    @GET("billing/period-close/corrections") Call<List<Map<String,Object>>> invoiceCorrections(@Query("clientId") String clientId, @Query("periodFrom") String from, @Query("periodTo") String to);
    @GET("wms-ai/openclaw/status") Call<Map<String,Object>> openClawStatus();
    @GET("wms-ai/openclaw/jobs") Call<Map<String,Object>> openClawHistory(@Query("cursor") String cursor);
    @POST("wms-ai/openclaw/jobs") Call<Map<String,Object>> submitOpenClaw(@Body Map<String,Object> body);
    @GET("wms-ai/openclaw/jobs/{id}") Call<Map<String,Object>> openClawJob(@Path("id") String id);
    @POST("mobile/auth/login") Call<Map<String, Object>> login(@Body Map<String, Object> body);
    @POST("mobile/auth/logout") Call<Map<String, Object>> logout(@Body Map<String, Object> body);
    @GET("mobile/bootstrap") Call<Map<String, Object>> bootstrap();
    @GET("mobile/dashboard") Call<Map<String, Object>> dashboard(@Query("clientId") String clientId);
    @GET("mobile/requests") Call<Map<String, Object>> requests(@Query("clientId") String clientId, @Query("search") String search, @Query("status") String status, @Query("limit") int limit);
    @GET("mobile/invoices") Call<Map<String, Object>> invoices(@Query("clientId") String clientId, @Query("search") String search, @Query("status") String status, @Query("limit") int limit);
    @GET("mobile/notifications") Call<Map<String, Object>> notifications(@Query("clientId") String clientId, @Query("unreadOnly") boolean unreadOnly, @Query("limit") int limit);
    @PATCH("mobile/notifications/{id}/read") Call<Map<String, Object>> markNotificationRead(@Path("id") String id);
    @PATCH("mobile/notifications/read-all") Call<Map<String, Object>> markAllNotificationsRead(@Body Map<String, Object> body);
    @GET("mobile/online-receipts") Call<Object> onlineReceipts(@Query("clientId") String clientId);
    @GET("mobile/modules/{module}") Call<Map<String, Object>> nativeModule(@Path("module") String module, @Query("clientId") String clientId, @Query("search") String search, @Query("limit") int limit);
    @POST("wms-ai/chat") Call<Map<String, Object>> wmsAiChat(@Body Map<String, Object> body);
    @Streaming @GET("wms-ai/export.xlsx") Call<ResponseBody> wmsAiExport(
            @Query("tool") String tool,
            @Query("search") String search,
            @Query("boxCode") String boxCode,
            @Query("palletCode") String palletCode,
            @Query("maxTotal") Double maxTotal,
            @Query("minTotal") Double minTotal,
            @Query("clientSearch") String clientSearch,
            @Query("requestNumber") Integer requestNumber,
            @Query("days") Integer days,
            @Query("status") String status
    );
    @GET("marketplace-connections/fbs/orders") Call<Map<String, Object>> fbsOrders(@Query("clientId") String clientId, @Query("refresh") Integer refresh);
    @GET("marketplace-connections/fbs/active-clients") Call<List<Map<String, Object>>> fbsActiveClients();
    @POST("marketplace-connections/fbs/orders/assemble") Call<Map<String, Object>> assembleFbsOrders(@Body Map<String, Object> body);
    @POST("marketplace-connections/fbs/orders/reship") Call<Map<String, Object>> reshipFbsOrders(@Body Map<String, Object> body);
    @POST("marketplace-connections/fbs/orders/cancel") Call<Map<String, Object>> cancelFbsOrders(@Body Map<String, Object> body);
    @POST("marketplace-connections/fbs/supplies/deliver") Call<Map<String, Object>> deliverFbsSupplies(@Body Map<String, Object> body);
    @POST("marketplace-connections/fbs/orders/request") Call<Map<String, Object>> createFbsRequest(@Body Map<String, Object> body);
    @Streaming @POST("marketplace-connections/fbs/orders/stickers.pdf") Call<ResponseBody> fbsOrderStickers(@Body Map<String, Object> body);
    @Streaming @POST("marketplace-connections/fbs/orders/cargo-place-stickers.pdf") Call<ResponseBody> fbsCargoPlaceStickers(@Body Map<String, Object> body);
    @Streaming @POST("marketplace-connections/fbs/orders/supply-stickers.pdf") Call<ResponseBody> fbsSupplyStickers(@Body Map<String, Object> body);
    @Streaming @GET("marketplace-connections/fbs/requests/{requestId}/pick-list.pdf") Call<ResponseBody> fbsRequestPickList(@Path("requestId") String requestId);
    @POST("marketplace-connections/fbs/connections") Call<Map<String, Object>> createFbsConnection(@Body Map<String, Object> body);
    @GET("marketplace-connections/fbs/passes") Call<Map<String, Object>> fbsPasses(@Query("clientId") String clientId, @Query("connectionId") String connectionId);
    @POST("marketplace-connections/fbs/passes") Call<Map<String, Object>> createFbsPass(@Body Map<String, Object> body);
    @PUT("marketplace-connections/fbs/passes/{passId}") Call<Map<String, Object>> updateFbsPass(@Path("passId") long passId, @Body Map<String, Object> body);
    @DELETE("marketplace-connections/fbs/passes/{passId}") Call<Map<String, Object>> deleteFbsPass(@Path("passId") long passId, @Query("clientId") String clientId, @Query("connectionId") String connectionId);
    @GET("marketplace-connections/fbs/calculator/destinations") Call<Map<String, Object>> fbsCalculatorDestinations();
    @POST("marketplace-connections/fbs/calculator/quote") Call<Map<String, Object>> fbsCalculatorQuote(@Body Map<String, Object> body);
    @GET("marketplace-connections/fbs/billing-settings/{clientId}") Call<Map<String, Object>> fbsBillingSettings(@Path("clientId") String clientId);
    @PUT("marketplace-connections/fbs/billing-settings/{clientId}") Call<Map<String, Object>> updateFbsBillingSettings(@Path("clientId") String clientId, @Body Map<String, Object> body);
    @GET("logistics/tariff-sets") Call<List<Map<String, Object>>> logisticsTariffSets();
    @GET("logistics/tariff-sets/{id}") Call<Map<String, Object>> logisticsTariffSet(@Path("id") String id);
    @POST("logistics/quote") Call<Map<String, Object>> logisticsQuote(@Body Map<String, Object> body);
    @POST("mobile/devices") Call<Map<String, Object>> registerDevice(@Body Map<String, Object> body);
    @GET("mobile/app-version") Call<Map<String, Object>> appVersion();
    @POST("client-requests") Call<Map<String, Object>> createRequest(@Body Map<String, Object> body);
    @PATCH("client-requests/{id}") Call<Map<String, Object>> updateRequest(@Path("id") String id, @Body Map<String, Object> body);
    @PATCH("client-requests/{id}/status") Call<Map<String, Object>> updateRequestStatus(@Path("id") String id, @Body Map<String, Object> body);
    @POST("client-requests/{id}/cancel") Call<Map<String, Object>> cancelRequest(@Path("id") String id, @Body Map<String, Object> body);
    @POST("client-requests/{id}/sync-tsd") Call<Map<String, Object>> syncRequestToTsd(@Path("id") String id);
    @GET("tsd/requests/{id}") Call<Map<String, Object>> requestOnlineAssembly(@Path("id") String id);
    @POST("tsd/requests/{id}/fbs-kiz-conflicts/{conflictId}/resolve")
    Call<Map<String, Object>> resolveFbsKizConflict(
            @Path("id") String id,
            @Path("conflictId") String conflictId
    );
    @POST("marketplace-connections/fbs/orders/move-to-new-supply")
    Call<Map<String, Object>> moveFbsOrdersToNewSupply(@Body Map<String, Object> body);
    @Streaming @GET("tsd/requests/{id}/outgoing-boxes.xlsx")
    Call<ResponseBody> requestOutgoingBoxes(@Path("id") String id);
    @Streaming @GET("tsd/requests/{id}/outgoing-contents.xlsx")
    Call<ResponseBody> requestOutgoingContents(@Path("id") String id);
    @Streaming @GET("tsd/requests/{id}/movements.xlsx")
    Call<ResponseBody> requestMovements(@Path("id") String id);
    @Multipart @POST("client-requests/outbound-xlsx/commit")
    Call<Map<String, Object>> uploadRequest(@Part MultipartBody.Part file, @Part("clientId") RequestBody clientId, @Part("title") RequestBody title, @Part("destinationCity") RequestBody city, @Part("comment") RequestBody comment);
    @Streaming @GET("billing/invoices/{id}/document.pdf") Call<ResponseBody> invoicePdf(@Path("id") String id);
    @Streaming @GET("billing/invoices/{id}/act.pdf") Call<ResponseBody> actPdf(@Path("id") String id);
    @GET("expenses/report") Call<Map<String, Object>> expenseReport(
            @Query("clientId") String clientId,
            @Query("dateFrom") String dateFrom,
            @Query("dateTo") String dateTo,
            @Query("category") String category
    );
    @Streaming @GET("expenses/report.xlsx") Call<ResponseBody> expenseReportXlsx(
            @Query("clientId") String clientId,
            @Query("dateFrom") String dateFrom,
            @Query("dateTo") String dateTo,
            @Query("category") String category
    );
    @GET("expenses/debts") Call<Map<String, Object>> expenseDebts(@Query("clientId") String clientId);
    @GET("expenses/entries") Call<List<Map<String, Object>>> expenseEntries(
            @Query("clientId") String clientId,
            @Query("dateFrom") String dateFrom,
            @Query("dateTo") String dateTo,
            @Query("category") String category,
            @Query("limit") int limit
    );
    @POST("expenses/entries") Call<Map<String, Object>> createExpense(@Body Map<String, Object> body);
    @PATCH("expenses/entries/{id}/cancel") Call<Map<String, Object>> cancelExpense(@Path("id") String id);
    @GET("expenses/materials") Call<List<Map<String, Object>>> expenseMaterials();
    @POST("expenses/materials") Call<Map<String, Object>> createExpenseMaterial(@Body Map<String, Object> body);
    @PATCH("expenses/materials/{id}") Call<Map<String, Object>> updateExpenseMaterial(
            @Path("id") String id,
            @Body Map<String, Object> body
    );
    @POST("expenses/materials/{id}/stock") Call<Map<String, Object>> updateExpenseMaterialStock(
            @Path("id") String id,
            @Body Map<String, Object> body
    );
    @GET("expenses/materials/{id}/movements") Call<List<Map<String, Object>>> expenseMaterialMovements(
            @Path("id") String id
    );
    @GET("expenses/clients/{clientId}/material-rules") Call<Map<String, Object>> expenseMaterialRules(
            @Path("clientId") String clientId
    );
    @PUT("expenses/clients/{clientId}/material-rules/{materialId}")
    Call<Map<String, Object>> updateExpenseMaterialRule(
            @Path("clientId") String clientId,
            @Path("materialId") String materialId,
            @Body Map<String, Object> body
    );
}
