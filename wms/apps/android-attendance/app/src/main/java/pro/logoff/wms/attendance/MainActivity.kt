package pro.logoff.wms.attendance

import android.os.Bundle
import android.view.WindowManager
import androidx.activity.compose.BackHandler
import androidx.compose.runtime.saveable.rememberSaveableStateHolder
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.text.TextStyle
import kotlinx.coroutines.*
import java.time.Instant
import java.time.ZoneId
import java.time.format.DateTimeFormatter

private val formatTime = DateTimeFormatter.ofPattern("dd.MM.yyyy HH:mm").withZone(ZoneId.of("Europe/Moscow"))
fun clockText(time: Long) = formatTime.format(Instant.ofEpochMilli(time))

class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON or WindowManager.LayoutParams.FLAG_SECURE)
        setContent {
            // FIX: warehouse tablet typography remains readable without changing attendance or camera flows.
            MaterialTheme(colorScheme = lightColorScheme(primary = Color(0xFF173B63), onPrimary = Color.White,
                secondary = Color(0xFF202B43), background = Color(0xFFF1F3F5), surface = Color.White,
                onSurface = Color(0xFF17212D), onSurfaceVariant = Color(0xFF374151)),
                typography = Typography(
                    headlineSmall = TextStyle(fontSize = 30.sp, lineHeight = 36.sp, fontWeight = FontWeight.Bold),
                    titleLarge = TextStyle(fontSize = 38.sp, lineHeight = 46.sp, fontWeight = FontWeight.Bold),
                    bodyLarge = TextStyle(fontSize = 24.sp, lineHeight = 30.sp),
                    bodyMedium = TextStyle(fontSize = 22.sp, lineHeight = 28.sp),
                    bodySmall = TextStyle(fontSize = 18.sp, lineHeight = 24.sp),
                    labelLarge = TextStyle(fontSize = 24.sp, lineHeight = 30.sp, fontWeight = FontWeight.SemiBold))) {
                Surface(Modifier.fillMaxSize()) { AttendanceScreen(application as AttendanceApp) }
            }
        }
    }
}

@Composable
fun AttendanceScreen(app: AttendanceApp) {
    val scope = rememberCoroutineScope()
    val drafts = rememberSaveableStateHolder()
    var savedEventId by rememberSaveable { mutableStateOf<String?>(null) }
    var handlingError by rememberSaveable { mutableStateOf("") }
    var device by remember { mutableStateOf<Device?>(null) }
    var initialized by remember { mutableStateOf(false) }
    var fatal by remember { mutableStateOf(false) }
    var message by remember { mutableStateOf("") }
    var busy by remember { mutableStateOf(false) }
    var selected by rememberSaveable { mutableStateOf<String?>(null) }
    var screen by rememberSaveable { mutableStateOf("list") }
    var syncMessage by remember { mutableStateOf(app.store.syncMessage) }
    var query by rememberSaveable { mutableStateOf("") }
    var refreshing by remember { mutableStateOf(false) }
    val employees by app.repo.dao.employees().collectAsState(initial = emptyList())
    val events by app.repo.dao.events().collectAsState(initial = emptyList())
    fun refresh(background: Boolean = true) {
        if (refreshing) return
        refreshing = true
        if (background) app.schedule()
        scope.launch(Dispatchers.IO) {
            try {
                val d = app.store.device() ?: return@launch
                val ok = app.sync.run(d) { app.store.time(it.serverTime, System.currentTimeMillis()) }
                app.store.syncMessage = if (ok) "Связь с WMS установлена" else "Нет связи. Отметки сохранены на планшете"
            } catch (e: CancellationException) { throw e }
            catch (e: Exception) { app.store.syncMessage = failureText(e) }
            finally { refreshing = false }
        }
    }
    LaunchedEffect(Unit) {
        try { device = withContext(Dispatchers.IO) { app.store.device() }; if (device != null) refresh() }
        catch (e: Exception) { fatal = true; message = "Регистрация недоступна. Очередь сохранена. Обратитесь к администратору" }
        initialized = true
        var ticks = 0
        while (true) {
            syncMessage = app.store.syncMessage; delay(2000)
            if (++ticks % 15 == 0 && device != null) refresh(false)
        }
    }
    BackHandler(enabled = screen != "list" || selected != null) {
        if (!busy) { if (screen == "list") selected = null else screen = "list" }
    }
    // Only selection expires; entered handling data and a captured photo are never discarded by a timer.
    LaunchedEffect(selected, screen, busy) {
        if (screen == "list" && selected != null && !busy) { delay(120_000); selected = null }
    }
    Column(Modifier.fillMaxSize().statusBarsPadding().navigationBarsPadding().imePadding().padding(20.dp)) {
        Text("LOGOFF · Учёт времени", style = MaterialTheme.typography.headlineSmall, fontWeight = FontWeight.Bold)
        Text("Версия ${BuildConfig.VERSION_NAME}", style = MaterialTheme.typography.bodySmall)
        Text(device?.let { "${it.warehouseName} · ${it.name}" } ?: "Подключение планшета", style = MaterialTheme.typography.bodyMedium)
        Spacer(Modifier.height(12.dp))
        if (message.isNotBlank()) {
            Text(message, color = MaterialTheme.colorScheme.primary)
            if (!busy) TextButton(onClick = { message = "" }) { Text("Закрыть сообщение") }
        }
        if (!initialized) { CircularProgressIndicator(); return@Column }
        if (fatal) return@Column
        if (device == null) {
            Registration(busy) { code, name ->
                if (!busy) {
                    busy = true
                    scope.launch {
                        try {
                            val d = withContext(Dispatchers.IO) {
                                app.api.register(code, name).also { app.store.save(it) }
                            }
                            device = d; message = "Планшет подключён"; refresh()
                        } catch (e: CancellationException) { throw e }
                        catch (e: Exception) { message = failureText(e) }
                        finally { busy = false }
                    }
                }
            }
            return@Column
        }
        val d = device!!
        val pending = events.count { it.status == "PENDING" }
        val review = events.count { it.status == "REVIEW" }
        Text("$syncMessage\nОжидают отправки: $pending · На проверке: $review", style = MaterialTheme.typography.bodySmall)
        Spacer(Modifier.height(12.dp))
        val employee = employees.find { it.id == selected && it.active && it.warehouseId == d.warehouseId }
        val marking = screen.startsWith("clock") || screen.startsWith("break")
        AttendanceTask(marking, employee, onCancel = { screen = "list"; selected = null }, mark = { employee ->
            key(employee.id, screen) {
                AutomaticPhotoMark(employee, screen == "clockIn", onCancel = { screen = "list" }, label = when(screen) { "breakStart" -> "Обед"; "breakEnd" -> "Вернулся"; "clockIn" -> "Начало смены"; else -> "Окончание смены" }) { photo, time, elapsed, eventId ->
                    withContext(Dispatchers.IO) {
                        app.repo.mark(d, employee.id, screen == "clockIn", photo, time, elapsed,
                            app.store.offsetMs, app.store.syncedAt, eventId, when(screen) { "breakStart" -> "BREAK_START"; "breakEnd" -> "BREAK_END"; "clockIn" -> "CLOCK_IN"; else -> "CLOCK_OUT" })
                    }
                    photo.delete()
                    message = "Отметка сохранена на планшете: ${clockText(time)}. Ожидает подтверждения WMS"
                    screen = "list"; query = ""; refresh()
                }
            }
        }, content = {
        Box(Modifier.weight(1f)) {
        if (screen == "handling" && employee != null) {
            drafts.SaveableStateProvider("handling:${employee.id}") {
                HandlingScreen(employee, employees.filter { it.active && it.warehouseId == d.warehouseId }, busy,
                    onCancel = { screen = "list" }, error = handlingError) { members, quantity, boxes, bags, rolls, start, type, note, id ->
                    if (!busy) {
                        busy = true; handlingError = ""
                        scope.launch {
                            try {
                                withContext(Dispatchers.IO) { app.repo.handling(d, employee.id, members, quantity, start, type, note,
                                    app.store.offsetMs, app.store.syncedAt, id, boxes, bags, rolls) }
                                drafts.removeState("handling:${employee.id}")
                                savedEventId = id; screen = "saved"; message = ""; refresh()
                            } catch (e: CancellationException) { throw e }
                            catch (e: Exception) { handlingError = e.message ?: "Не удалось сохранить работу. Повторите попытку." }
                            finally { busy = false }
                        }
                    }
                }
            }
        } else if (screen == "saved") {
            Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()), verticalArrangement = Arrangement.spacedBy(16.dp)) {
                val saved = events.find { it.id == savedEventId }
                Text("Работа сохранена", fontSize = 32.sp, fontWeight = FontWeight.Bold)
                Text(employee?.name.orEmpty(), fontWeight = FontWeight.Bold)
                if (saved != null) { Text(workDescription(saved)); Text(deliveryLabel(saved), fontWeight = FontWeight.Bold) }
                else Text("Сохранено на планшете · Ожидает отправки")
                if (saved?.reason?.isNotBlank() == true) Text(saved.reason, color = MaterialTheme.colorScheme.error)
                Button(onClick = { screen = "handling" }, enabled = employee != null, modifier = Modifier.fillMaxWidth().heightIn(min = 80.dp)) { Text("Добавить ещё работу") }
                OutlinedButton(onClick = { screen = "history" }, modifier = Modifier.fillMaxWidth().heightIn(min = 80.dp)) { Text("Мои работы") }
                OutlinedButton(onClick = { screen = "list"; selected = null }, modifier = Modifier.fillMaxWidth()) { Text("Готово · К сотрудникам") }
            }
        } else if (screen == "queue" || screen == "history") {
            WorkHistory(if (screen == "queue") null else employee, events, { screen = "list" }, { refresh() })
        } else if (screen == "handling") {
            Column { Text("Сотрудник больше недоступен. Черновик сохранён."); OutlinedButton(onClick = { screen = "list" }) { Text("Назад") } }
        } else {
            Column(Modifier.fillMaxSize()) {
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    OutlinedButton(onClick = { refresh() }) { Text("Обновить", style = MaterialTheme.typography.bodySmall) }
                    OutlinedButton(onClick = { screen = "queue" }) { Text("Отправка отметок", style = MaterialTheme.typography.bodySmall) }
                }
                Box(Modifier.weight(1f)) {
                    AttendanceHome(employees.filter { it.active && it.warehouseId == d.warehouseId }, events, selected,
                        { selected = it }, { handlingError = ""; screen = it })
                }
            }
        }
        }
        })
    }
}

@Composable
internal fun AttendanceTask(marking: Boolean, employee: Employee?, onCancel: () -> Unit,
    mark: @Composable (Employee) -> Unit, content: @Composable () -> Unit) {
    if (marking) {
        if (employee == null) {
            Text("Сотрудник больше недоступен. Обратитесь к администратору.")
            TextButton(onClick = onCancel) { Text("Вернуться к списку") }
        } else mark(employee)
    } else {
        // FIX: photo capture and the employee list are mutually exclusive, including unavailable employees.
        content()
    }
}

fun failureText(e: Exception): String = when {
    e is ApiFailure && e.code == 404 -> "API планшетов ещё не опубликован в WMS. Передайте администратору. Отметки сохранены"
    e is ApiFailure && e.code in listOf(401, 403) -> "Код подключения или доступ устройства недействителен. Обратитесь к администратору"
    e is ApiFailure && e.code == 429 -> "Слишком много запросов. Повторим позже; очередь сохранена"
    e is java.io.IOException -> "Нет связи с WMS. Проверьте интернет; очередь сохранена"
    else -> "Не удалось выполнить операцию. Данные сохранены, требуется проверка администратора"
}

@Composable
private fun Registration(busy: Boolean, register: (String, String) -> Unit) {
    var code by remember { mutableStateOf("") }
    var name by rememberSaveable { mutableStateOf("Планшет 01") }
    Column(Modifier.verticalScroll(rememberScrollState()), verticalArrangement = Arrangement.spacedBy(16.dp)) {
        Text("Введите одноразовый код из WMS → ФОТ → Устройства. Пароль сотрудника не нужен.")
        Text("Пилотная сборка: требуется серверный API планшетов. Если его ещё нет, подключение недоступно.", color = MaterialTheme.colorScheme.primary)
        OutlinedTextField(name, { name = it.take(80) }, label = { Text("Название планшета") }, enabled = !busy, modifier = Modifier.fillMaxWidth())
        OutlinedTextField(code, { code = it.take(100) }, label = { Text("Одноразовый код") }, visualTransformation = PasswordVisualTransformation(), enabled = !busy, modifier = Modifier.fillMaxWidth())
        Button(onClick = { register(code.trim(), name.trim()) }, enabled = !busy && code.isNotBlank() && name.isNotBlank(), modifier = Modifier.fillMaxWidth().height(60.dp)) {
            Text(if (busy) "Подключение…" else "Подключить планшет")
        }
    }
}
