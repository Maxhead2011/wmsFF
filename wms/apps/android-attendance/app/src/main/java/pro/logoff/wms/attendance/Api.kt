package pro.logoff.wms.attendance

import okhttp3.*
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.RequestBody.Companion.asRequestBody
import okhttp3.RequestBody.Companion.toRequestBody
import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import java.io.IOException
import java.util.concurrent.TimeUnit

class ApiFailure(val code: Int) : IOException("HTTP $code")
data class Snapshot(val employees: List<Employee>, val serverTime: Long, val receipts: List<Receipt> = emptyList())
data class Receipt(val id: String, val status: String, val reason: String, val employee: Employee?, val photoStored: Boolean = false)
interface AttendanceApi {
    fun register(code: String, name: String): Device
    fun snapshot(device: Device): Snapshot
    fun send(device: Device, event: Event): Receipt
}

class HttpAttendanceApi(private val url: String = BuildConfig.API_URL) : AttendanceApi {
    private val client = OkHttpClient.Builder().connectTimeout(15, TimeUnit.SECONDS).readTimeout(35, TimeUnit.SECONDS)
        .writeTimeout(60, TimeUnit.SECONDS).followRedirects(false).followSslRedirects(false).build()
    private fun request(path: String, token: String? = null, body: RequestBody? = null, key: String? = null): JSONObject {
        val request = Request.Builder().url(url + path).header("Accept", "application/json")
        token?.let { request.header("Authorization", "Bearer $it") }
        key?.let { request.header("Idempotency-Key", it) }
        body?.let { request.post(it) }
        client.newCall(request.build()).execute().use { response ->
            if (!response.isSuccessful) throw ApiFailure(response.code)
            return JSONObject(response.body?.string() ?: throw IOException("Пустой ответ"))
        }
    }
    override fun register(code: String, name: String): Device {
        val r = request("register", body = JSONObject().put("code", code).put("name", name)
            .put("protocolVersion", 1).toString().toRequestBody("application/json".toMediaType()))
        require(r.getInt("protocolVersion") == 1) { "Несовместимая версия API" }
        return Device(r.getString("deviceId"), r.getString("warehouseId"), r.getString("warehouseName"), name, r.getString("token"))
            .also { require(it.id.isNotBlank() && it.warehouseId.isNotBlank() && it.token.isNotBlank()) }
    }
    override fun snapshot(device: Device): Snapshot {
        val r = request("state", device.token)
        require(r.getString("deviceId") == device.id && r.getString("warehouseId") == device.warehouseId) { "Неверная привязка устройства" }
        val rows = r.getJSONArray("employees")
        val resolutions = r.optJSONArray("receipts") ?: JSONArray()
        return Snapshot((0 until rows.length()).map { employee(rows.getJSONObject(it)) }.also {
            require(it.all { e -> e.warehouseId == device.warehouseId }) { "Сотрудник другого филиала" }
        }, r.getLong("serverTimeMs"), (0 until resolutions.length()).map { receipt(resolutions.getJSONObject(it)) })
    }
    override fun send(device: Device, event: Event): Receipt {
        require(device.id == event.deviceId && device.warehouseId == event.warehouseId) { "Привязка события не совпадает" }
        val json = JSONObject().put("eventId", event.id).put("employeeId", event.employeeId).put("deviceId", event.deviceId)
            .put("warehouseId", event.warehouseId).put("kind", event.kind).put("capturedAtMs", event.capturedAt)
            .put("elapsedAtMs", event.elapsedAt).put("serverOffsetMs", event.offsetMs ?: JSONObject.NULL)
            .put("lastSyncAtMs", event.lastSyncAt ?: JSONObject.NULL).put("photoSha256", event.photoHash ?: JSONObject.NULL)
            .put("payload", JSONObject(event.payload))
        val form = MultipartBody.Builder().setType(MultipartBody.FORM)
            .addFormDataPart("event", json.toString())
        event.photoPath?.let { path ->
            val file = File(path)
            require(file.isFile && file.length() > 0 && sha256(file) == event.photoHash) { "Фотография отсутствует или повреждена" }
            form.addFormDataPart("photo", "${event.id}.jpg", file.asRequestBody("image/jpeg".toMediaType()))
        }
        val r = request("events", device.token, form.build(), event.id)
        // FIX: acknowledge only this event and only after the server has persisted the photograph.
        require(r.getString("eventId") == event.id) { "Неверный идентификатор подтверждения" }
        val status = r.getString("status")
        require(status == "ACCEPTED" || status == "REVIEW") { "Неизвестный статус" }
        require(event.photoPath == null || r.optBoolean("photoStored")) { "Станция не подтвердила сохранение фото" }
        val state = r.optJSONObject("employee")?.let(::employee)
        require(state == null || (state.id == event.employeeId && state.warehouseId == event.warehouseId))
        require(event.kind == "HANDLING" || state != null) { "Нет состояния смены" }
        return Receipt(event.id, status, r.optString("reason"), state, r.optBoolean("photoStored"))
    }
    private fun receipt(r: JSONObject): Receipt {
        require(r.getString("status") in listOf("ACCEPTED", "REVIEW"))
        return Receipt(r.getString("eventId"), r.getString("status"), r.optString("reason"),
            r.optJSONObject("employee")?.let(::employee), r.optBoolean("photoStored"))
    }
    private fun employee(j: JSONObject) = Employee(j.getString("id"), j.getString("name"), j.getString("warehouseId"),
        j.optBoolean("loader"), j.optBoolean("active", true), if (j.isNull("openSinceMs")) null else j.getLong("openSinceMs"),
        j.getLong("revision"), j.optString("distinguishing"))
}
