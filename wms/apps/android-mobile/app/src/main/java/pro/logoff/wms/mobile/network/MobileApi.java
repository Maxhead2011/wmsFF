package pro.logoff.wms.mobile.network;

import java.util.Map;

import okhttp3.MultipartBody;
import okhttp3.RequestBody;
import okhttp3.ResponseBody;
import retrofit2.Call;
import retrofit2.http.Body;
import retrofit2.http.GET;
import retrofit2.http.Multipart;
import retrofit2.http.PATCH;
import retrofit2.http.POST;
import retrofit2.http.Part;
import retrofit2.http.Path;
import retrofit2.http.Query;
import retrofit2.http.Streaming;

public interface MobileApi {
    @POST("mobile/auth/login") Call<Map<String, Object>> login(@Body Map<String, Object> body);
    @POST("mobile/auth/logout") Call<Map<String, Object>> logout(@Body Map<String, Object> body);
    @GET("mobile/bootstrap") Call<Map<String, Object>> bootstrap();
    @GET("mobile/dashboard") Call<Map<String, Object>> dashboard(@Query("clientId") String clientId);
    @GET("mobile/requests") Call<Map<String, Object>> requests(@Query("clientId") String clientId, @Query("search") String search, @Query("status") String status, @Query("limit") int limit);
    @GET("mobile/invoices") Call<Map<String, Object>> invoices(@Query("clientId") String clientId, @Query("search") String search, @Query("status") String status, @Query("limit") int limit);
    @GET("mobile/notifications") Call<Map<String, Object>> notifications(@Query("clientId") String clientId, @Query("unreadOnly") boolean unreadOnly, @Query("limit") int limit);
    @PATCH("mobile/notifications/{id}/read") Call<Map<String, Object>> markNotificationRead(@Path("id") String id);
    @GET("mobile/online-receipts") Call<Object> onlineReceipts(@Query("clientId") String clientId);
    @POST("mobile/devices") Call<Map<String, Object>> registerDevice(@Body Map<String, Object> body);
    @GET("mobile/app-version") Call<Map<String, Object>> appVersion();
    @POST("client-requests") Call<Map<String, Object>> createRequest(@Body Map<String, Object> body);
    @PATCH("client-requests/{id}") Call<Map<String, Object>> updateRequest(@Path("id") String id, @Body Map<String, Object> body);
    @POST("client-requests/{id}/cancel") Call<Map<String, Object>> cancelRequest(@Path("id") String id, @Body Map<String, Object> body);
    @Multipart @POST("client-requests/outbound-xlsx/commit")
    Call<Map<String, Object>> uploadRequest(@Part MultipartBody.Part file, @Part("clientId") RequestBody clientId, @Part("title") RequestBody title, @Part("destinationCity") RequestBody city, @Part("comment") RequestBody comment);
    @Streaming @GET("billing/invoices/{id}/document.pdf") Call<ResponseBody> invoicePdf(@Path("id") String id);
    @Streaming @GET("billing/invoices/{id}/act.pdf") Call<ResponseBody> actPdf(@Path("id") String id);
}
