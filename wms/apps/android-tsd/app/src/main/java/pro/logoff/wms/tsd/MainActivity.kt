package pro.logoff.wms.tsd

import android.os.Bundle
import android.text.InputType
import android.view.KeyEvent
import android.view.View
import android.widget.Button
import android.widget.EditText
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.TextView
import androidx.activity.ComponentActivity
import androidx.lifecycle.lifecycleScope
import kotlinx.coroutines.launch
import pro.logoff.wms.tsd.auth.TsdSessionStore
import pro.logoff.wms.tsd.data.OperationOutbox
import pro.logoff.wms.tsd.data.PendingOperation
import pro.logoff.wms.tsd.data.TsdDatabase
import pro.logoff.wms.tsd.network.TsdLoginRequest
import pro.logoff.wms.tsd.network.WmsApiFactory
import pro.logoff.wms.tsd.sync.TsdSyncRunner

class MainActivity : ComponentActivity() {
    private lateinit var outbox: OperationOutbox
    private lateinit var sessionStore: TsdSessionStore
    private lateinit var statusView: TextView
    private lateinit var sessionView: TextView
    private lateinit var countsView: TextView
    private lateinit var rejectedView: TextView
    private lateinit var operationHintView: TextView
    private lateinit var scanInput: EditText
    private lateinit var baseUrlInput: EditText
    private lateinit var deviceCodeInput: EditText
    private lateinit var deviceSecretInput: EditText
    private lateinit var clientIdInput: EditText
    private lateinit var boxCodeInput: EditText
    private lateinit var fromBoxCodeInput: EditText
    private lateinit var toBoxCodeInput: EditText
    private lateinit var quantityInput: EditText
    private lateinit var stockStatusInput: EditText
    private lateinit var sourceDocumentInput: EditText
    private lateinit var commentInput: EditText
    private lateinit var receiptModeButton: Button
    private lateinit var moveModeButton: Button
    private lateinit var inventoryModeButton: Button
    private lateinit var loginButton: Button
    private lateinit var logoutButton: Button
    private lateinit var syncButton: Button
    private lateinit var retryRejectedButton: Button
    private var operationMode = TsdOperationMode.RECEIPT

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        outbox = OperationOutbox(TsdDatabase.get(this).operationDao())
        sessionStore = TsdSessionStore(this)

        // Русский комментарий: MVP использует scanner keyboard wedge, поэтому сканер пишет прямо в EditText.
        statusView = TextView(this).apply {
            text = "Готово к сканированию"
            textSize = 18f
        }
        sessionView = TextView(this).apply { textSize = 16f }
        countsView = TextView(this).apply { textSize = 16f }
        operationHintView = TextView(this).apply { textSize = 15f }
        rejectedView = TextView(this).apply { textSize = 14f }

        baseUrlInput = singleLineInput("API URL").apply {
            setText("https://wms.logoff.pro/")
        }
        deviceCodeInput = singleLineInput("Код ТСД")
        deviceSecretInput = singleLineInput("Секрет ТСД").apply {
            inputType = InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_VARIATION_PASSWORD
        }
        clientIdInput = singleLineInput("ID клиента")
        boxCodeInput = singleLineInput("Короб")
        fromBoxCodeInput = singleLineInput("Короб-источник")
        toBoxCodeInput = singleLineInput("Короб-приемник")
        quantityInput = singleLineInput("Количество").apply {
            inputType = InputType.TYPE_CLASS_NUMBER
        }
        stockStatusInput = singleLineInput("Статус остатка").apply {
            setText("AVAILABLE")
        }
        sourceDocumentInput = singleLineInput("Документ-основание")
        commentInput = singleLineInput("Комментарий")

        scanInput = singleLineInput("Сканируйте штрихкод товара").apply {
            setOnEditorActionListener { _, _, _ ->
                submitScan()
                true
            }
        }

        receiptModeButton = operationModeButton("Приемка", TsdOperationMode.RECEIPT)
        moveModeButton = operationModeButton("Перемещение", TsdOperationMode.MOVE)
        inventoryModeButton = operationModeButton("Инвентаризация", TsdOperationMode.INVENTORY)

        loginButton = Button(this).apply {
            text = "Войти на ТСД"
            setOnClickListener { loginDevice() }
        }

        logoutButton = Button(this).apply {
            text = "Сбросить вход"
            setOnClickListener { clearSession() }
        }

        syncButton = Button(this).apply {
            text = "Синхронизировать"
            setOnClickListener { syncPending() }
        }

        retryRejectedButton = Button(this).apply {
            text = "Вернуть отклонённые в очередь"
            setOnClickListener { requeueRejected() }
        }

        val modeRow = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            addView(receiptModeButton)
            addView(moveModeButton)
            addView(inventoryModeButton)
        }

        val root = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(32, 32, 32, 32)
            addView(statusView)
            addView(sessionView)
            addView(countsView)
            addView(baseUrlInput)
            addView(deviceCodeInput)
            addView(deviceSecretInput)
            addView(loginButton)
            addView(logoutButton)
            addView(TextView(this@MainActivity).apply {
                text = "Операция"
                textSize = 16f
            })
            addView(modeRow)
            addView(operationHintView)
            addView(clientIdInput)
            addView(boxCodeInput)
            addView(fromBoxCodeInput)
            addView(toBoxCodeInput)
            addView(quantityInput)
            addView(stockStatusInput)
            addView(sourceDocumentInput)
            addView(commentInput)
            addView(scanInput)
            addView(syncButton)
            addView(retryRejectedButton)
            addView(TextView(this@MainActivity).apply {
                text = "Отклонённые операции"
                textSize = 16f
            })
            addView(rejectedView)
        }

        setContentView(ScrollView(this).apply { addView(root) })
        setOperationMode(TsdOperationMode.RECEIPT)
        lifecycleScope.launch { refreshQueue() }
    }

    override fun dispatchKeyEvent(event: KeyEvent): Boolean {
        if (event.action == KeyEvent.ACTION_DOWN && event.keyCode == KeyEvent.KEYCODE_ENTER) {
            submitScan()
            return true
        }
        return super.dispatchKeyEvent(event)
    }

    private fun submitScan() {
        val barcode = scanInput.textValue()
        if (barcode.isEmpty()) return

        val clientId = clientIdInput.requiredValue("Укажите ID клиента") ?: return
        val stockStatus = stockStatusInput.optionalValue()

        lifecycleScope.launch {
            val operation = when (operationMode) {
                TsdOperationMode.RECEIPT -> {
                    val boxCode = boxCodeInput.requiredValue("Укажите короб приемки") ?: return@launch
                    val quantity = quantityInput.quantityValue("Количество должно быть больше 0", allowZero = false) ?: return@launch
                    outbox.enqueueReceipt(
                        clientId = clientId,
                        barcode = barcode,
                        boxCode = boxCode,
                        quantity = quantity,
                        status = stockStatus,
                        sourceDocument = sourceDocumentInput.optionalValue(),
                        comment = commentInput.optionalValue(),
                    )
                }

                TsdOperationMode.MOVE -> {
                    val fromBoxCode = fromBoxCodeInput.requiredValue("Укажите короб-источник") ?: return@launch
                    val toBoxCode = toBoxCodeInput.requiredValue("Укажите короб-приемник") ?: return@launch
                    val quantity = quantityInput.quantityValue("Количество должно быть больше 0", allowZero = false) ?: return@launch
                    outbox.enqueueMove(
                        clientId = clientId,
                        barcode = barcode,
                        fromBoxCode = fromBoxCode,
                        toBoxCode = toBoxCode,
                        quantity = quantity,
                        status = stockStatus,
                        comment = commentInput.optionalValue(),
                    )
                }

                TsdOperationMode.INVENTORY -> {
                    val boxCode = boxCodeInput.requiredValue("Укажите короб инвентаризации") ?: return@launch
                    val quantity = quantityInput.quantityValue("Факт может быть 0 или больше", allowZero = true) ?: return@launch
                    outbox.enqueueInventory(
                        clientId = clientId,
                        barcode = barcode,
                        boxCode = boxCode,
                        countedQuantity = quantity,
                        status = stockStatus,
                    )
                }
            }

            scanInput.setText("")
            refreshQueue("${operationMode.title}: скан принят в offline-очередь (${operation.operationType})")
        }
    }

    private fun loginDevice() {
        val code = deviceCodeInput.textValue()
        val secret = deviceSecretInput.textValue()
        if (code.isEmpty() || secret.isEmpty()) {
            statusView.text = "Укажите код и секрет ТСД"
            return
        }

        loginButton.isEnabled = false
        lifecycleScope.launch {
            val result = runCatching {
                val api = WmsApiFactory.create(baseUrlInput.textValue())
                api.login(TsdLoginRequest(code = code, secret = secret))
            }

            loginButton.isEnabled = true
            result.onSuccess { response ->
                sessionStore.save(response)
                deviceSecretInput.setText("")
                refreshQueue("ТСД вошёл: ${response.device.name}")
            }.onFailure { error ->
                refreshQueue(error.message ?: "Не удалось войти на ТСД")
            }
        }
    }

    private fun clearSession() {
        sessionStore.clear()
        statusView.text = "Вход ТСД сброшен"
        lifecycleScope.launch { refreshQueue() }
    }

    private fun syncPending() {
        val session = sessionStore.load()
        if (session == null) {
            statusView.text = "Сначала войдите по коду и секрету ТСД"
            return
        }

        syncButton.isEnabled = false
        lifecycleScope.launch {
            val api = runCatching {
                WmsApiFactory.create(baseUrlInput.textValue())
            }.getOrElse { error ->
                syncButton.isEnabled = true
                refreshQueue(error.message ?: "Некорректный API URL")
                return@launch
            }

            val summary = TsdSyncRunner(outbox, api, session.deviceCode)
                .syncPending("${session.tokenType} ${session.accessToken}")
            syncButton.isEnabled = true
            refreshQueue(
                "${summary.message}: отправлено ${summary.sent}, принято ${summary.applied}, " +
                    "отклонено ${summary.rejected}, на повтор ${summary.retried}",
            )
        }
    }

    private fun requeueRejected() {
        lifecycleScope.launch {
            val restored = outbox.requeueRejected()
            refreshQueue("Возвращено в очередь: $restored")
        }
    }

    private fun setOperationMode(mode: TsdOperationMode) {
        operationMode = mode
        operationHintView.text = mode.hint
        receiptModeButton.isSelected = mode == TsdOperationMode.RECEIPT
        moveModeButton.isSelected = mode == TsdOperationMode.MOVE
        inventoryModeButton.isSelected = mode == TsdOperationMode.INVENTORY
        receiptModeButton.isEnabled = mode != TsdOperationMode.RECEIPT
        moveModeButton.isEnabled = mode != TsdOperationMode.MOVE
        inventoryModeButton.isEnabled = mode != TsdOperationMode.INVENTORY

        val isMove = mode == TsdOperationMode.MOVE
        val isInventory = mode == TsdOperationMode.INVENTORY
        boxCodeInput.visibility = if (isMove) View.GONE else View.VISIBLE
        fromBoxCodeInput.visibility = if (isMove) View.VISIBLE else View.GONE
        toBoxCodeInput.visibility = if (isMove) View.VISIBLE else View.GONE
        sourceDocumentInput.visibility = if (mode == TsdOperationMode.RECEIPT) View.VISIBLE else View.GONE
        commentInput.visibility = if (isInventory) View.GONE else View.VISIBLE
        quantityInput.hint = if (isInventory) "Фактическое количество" else "Количество"
        scanInput.hint = "Сканируйте штрихкод товара"
    }

    private suspend fun refreshQueue(message: String? = null) {
        val counts = outbox.counts()
        val rejected = outbox.rejected()

        if (message != null) {
            statusView.text = message
        }
        sessionView.text = sessionStore.load()?.let { session ->
            "ТСД: ${session.deviceName} (${session.deviceCode})"
        } ?: "ТСД не авторизован"
        countsView.text = "В очереди: ${counts.pending}; отклонено: ${counts.rejected}"
        rejectedView.text =
            if (rejected.isEmpty()) {
                "Отклонённых операций нет"
            } else {
                rejected.joinToString(separator = "\n\n") { it.toRejectedLine() }
            }
    }

    private fun singleLineInput(label: String): EditText =
        EditText(this).apply {
            hint = label
            setSingleLine(true)
        }

    private fun operationModeButton(label: String, mode: TsdOperationMode): Button =
        Button(this).apply {
            text = label
            setOnClickListener { setOperationMode(mode) }
        }

    private fun EditText.textValue(): String = text.toString().trim()

    private fun EditText.optionalValue(): String? = textValue().ifEmpty { null }

    private fun EditText.requiredValue(message: String): String? {
        val value = textValue()
        if (value.isEmpty()) {
            statusView.text = message
            requestFocus()
            return null
        }

        return value
    }

    private fun EditText.quantityValue(message: String, allowZero: Boolean): Int? {
        val value = textValue().toIntOrNull()
        val isValid = value != null && if (allowZero) value >= 0 else value > 0
        if (!isValid) {
            statusView.text = message
            requestFocus()
            return null
        }

        return value
    }

    private fun PendingOperation.toRejectedLine(): String {
        val barcode = payload["barcode"] ?: payload["fromBoxCode"] ?: operationKey
        return "$operationType / $barcode\n$messageForOperator"
    }

    private val PendingOperation.messageForOperator: String
        get() = lastMessage ?: "Причина не указана"
}

private enum class TsdOperationMode(
    val title: String,
    val hint: String,
) {
    RECEIPT(
        title = "Приемка",
        hint = "Приемка добавит товар в указанный короб через receipt_scan.",
    ),
    MOVE(
        title = "Перемещение",
        hint = "Перемещение перенесет количество из короба-источника в короб-приемник.",
    ),
    INVENTORY(
        title = "Инвентаризация",
        hint = "Инвентаризация сверит фактическое количество в коробе с остатком WMS.",
    ),
}
