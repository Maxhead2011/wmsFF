package pro.logoff.wms.tsd.network

import retrofit2.http.Body
import retrofit2.http.Header
import retrofit2.http.POST
import retrofit2.Retrofit
import retrofit2.converter.moshi.MoshiConverterFactory

data class TsdOperationRequest(
    val deviceId: String,
    val operationKey: String,
    val operationType: String,
    val payload: Map<String, String>,
)

data class TsdOperationResponse(
    val operationKey: String,
    val operationType: String,
    val status: String,
    val message: String? = null,
    val reviewReason: String? = null,
    val resolutionMessage: String? = null,
    val serverTime: String,
)

data class TsdSyncRequest(
    val operations: List<TsdOperationRequest>,
    val deviceClock: String? = null,
)

data class TsdLoginRequest(
    val code: String,
    val secret: String,
)

data class TsdDeviceInfo(
    val id: String,
    val code: String,
    val name: String,
)

data class TsdLoginResponse(
    val accessToken: String,
    val tokenType: String,
    val device: TsdDeviceInfo,
)

interface WmsApi {
    @POST("api/v1/tsd/login")
    suspend fun login(@Body request: TsdLoginRequest): TsdLoginResponse

    @POST("api/v1/tsd/operations")
    suspend fun sendOperation(
        @Header("Authorization") authorization: String,
        @Body request: TsdOperationRequest,
    ): TsdOperationResponse

    @POST("api/v1/tsd/sync")
    suspend fun syncOperations(
        @Header("Authorization") authorization: String,
        @Body request: TsdSyncRequest,
    ): List<TsdOperationResponse>
}

object WmsApiFactory {
    fun create(baseUrl: String): WmsApi =
        Retrofit.Builder()
            .baseUrl(normalizeBaseUrl(baseUrl))
            .addConverterFactory(MoshiConverterFactory.create())
            .build()
            .create(WmsApi::class.java)

    private fun normalizeBaseUrl(baseUrl: String): String =
        when {
            baseUrl.isBlank() -> DEFAULT_BASE_URL
            baseUrl.endsWith("/") -> baseUrl
            else -> "$baseUrl/"
        }

    private const val DEFAULT_BASE_URL = "https://wms.logoff.pro/"
}
