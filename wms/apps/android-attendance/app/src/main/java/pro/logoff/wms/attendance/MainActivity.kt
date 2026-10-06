package pro.logoff.wms.attendance

import android.app.DatePickerDialog
import android.app.TimePickerDialog
import android.os.Bundle
import android.view.WindowManager
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.text.TextStyle
import kotlinx.coroutines.*
import java.time.Instant
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import java.util.Calendar
import java.util.UUID

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
    // Only selection expires; entered handling data and a captured photo are never discarded by a timer.
    LaunchedEffect(selected, screen, busy) {
        if (screen == "list" && selected != null && !busy) { delay(45_000); selected = null }
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
                    screen = "list"; selected = null; query = ""; refresh()
                }
            }
        }, content = {
        if (screen == "handling" && employee != null) {
            HandlingScreen(employee, employees.filter { it.active && it.warehouseId == d.warehouseId }, busy,
                onCancel = { screen = "list" }) { members, quantity, boxes, bags, rolls, start, type, note, id ->
                if (!busy) {
                    busy = true
                    scope.launch {
                        try {
                            withContext(Dispatchers.IO) { app.repo.handling(d, employee.id, members, quantity, start, type, note,
                                app.store.offsetMs, app.store.syncedAt, id, boxes, bags, rolls) }
                            message = "Работа сохранена на планшете. После отправки её проверит администратор"
                            screen = "list"; selected = null; refresh()
                        } catch (e: CancellationException) { throw e }
                        catch (e: Exception) { message = e.message ?: "Не удалось сохранить работу" }
                        finally { busy = false }
                    }
                }
            }
        } else if (screen == "queue") {
            Button(onClick = { screen = "list" }) { Text("Назад к сотрудникам") }
            LazyColumn {
                items(events.filter { it.status != "ACCEPTED" }.takeLast(100).reversed(), key = { it.id }) {
                    Text("${clockText(it.capturedAt)} · ${if (it.status == "REVIEW") "На проверке" else "Ожидает отправки"}\n${it.reason}", Modifier.padding(vertical = 10.dp))
                }
            }
        } else {
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                OutlinedButton(enabled = !marking, onClick = { refresh() }) { Text("Обновить") }
                OutlinedButton(enabled = !marking, onClick = { screen = "queue"; selected = null }) { Text("Отправка отметок") }
            }
            OutlinedTextField(query, { query = it; selected = null }, enabled = !marking, label = { Text("Найти сотрудника") }, modifier = Modifier.fillMaxWidth(), singleLine = true)
            if (employees.isEmpty()) Text("Список сотрудников появится после подключения к API планшетов WMS.", Modifier.padding(vertical = 16.dp))
            LazyColumn(verticalArrangement = Arrangement.spacedBy(12.dp), modifier = Modifier.weight(1f)) {
                items(employees.filter { it.active && it.warehouseId == d.warehouseId && it.name.contains(query, true) }, key = { it.id }) { person ->
                    Card(Modifier.fillMaxWidth(), colors = CardDefaults.cardColors(containerColor = Color.White)) {
                        Column(Modifier.padding(16.dp)) {
                            TextButton(enabled = !marking, onClick = { selected = person.id }, modifier = Modifier.fillMaxWidth().heightIn(min = 96.dp)) {
                                Text(person.name + if (person.distinguishing.isNotBlank()) " · ${person.distinguishing}" else "", style = MaterialTheme.typography.titleLarge, color = MaterialTheme.colorScheme.onSurface)
                            }
                            val open = projectedOpen(person, events)
                            val pause = projectedBreak(person, events)
                            Text(pause?.let { "На обеде с ${clockText(it)}" } ?: open?.let { "На смене с ${clockText(it)}" } ?: "Смена не открыта",
                                color = if (pause != null) Color(0xFF8A4B00) else if (open != null) Color(0xFF21622B) else Color(0xFF374151), fontWeight = FontWeight.Bold)
                            if (pause != null) Text("Время обеда вычитается из оплачиваемого времени", style = MaterialTheme.typography.bodySmall)
                            if (person.id == selected) {
                                Text("При отметке выполняется фотофиксация. Фото хранится на планшете 35 дней.", style = MaterialTheme.typography.bodySmall)
                                Button(enabled = !marking, onClick = { screen = if (open == null) "clockIn" else "clockOut" }, modifier = Modifier.fillMaxWidth().heightIn(min = 80.dp)) {
                                    Text(if (open == null) "Начать смену" else "Закончить смену")
                                }
                                if (open != null) OutlinedButton(enabled = !marking, onClick = { screen = if (pause == null) "breakStart" else "breakEnd" }, modifier = Modifier.fillMaxWidth().heightIn(min = 80.dp)) {
                                    Text(if (pause == null) "Обед" else "Вернулся")
                                }
                                if (person.loader) OutlinedButton(enabled = !marking, onClick = { screen = "handling" }, modifier = Modifier.fillMaxWidth().heightIn(min = 80.dp)) { Text("Добавить погрузку / разгрузку") }
                            }
                        }
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

@Composable
internal fun HandlingScreen(creator: Employee, employees: List<Employee>, busy: Boolean, onCancel: () -> Unit,
    onSave: (List<String>, String, String, String, String, Long, String, String, String) -> Unit) {
    val context = LocalContext.current
    var participants by rememberSaveable { mutableStateOf<List<String>>(listOf(creator.id)) }
    var quantity by rememberSaveable { mutableStateOf("") }
    var boxes by rememberSaveable { mutableStateOf("") }
    var bags by rememberSaveable { mutableStateOf("") }
    var rolls by rememberSaveable { mutableStateOf("") }
    var start by rememberSaveable { mutableLongStateOf(System.currentTimeMillis()) }
    var type by rememberSaveable { mutableStateOf("UNLOADING") }
    var note by rememberSaveable { mutableStateOf("") }
    val id = rememberSaveable { UUID.randomUUID().toString() }
    Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()), verticalArrangement = Arrangement.spacedBy(12.dp)) {
        Text("Погрузка / разгрузка", style = MaterialTheme.typography.titleLarge)
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            FilterChip(selected = type == "LOADING", onClick = { type = "LOADING" }, enabled = !busy, label = { Text("Погрузка") })
            FilterChip(selected = type == "UNLOADING", onClick = { type = "UNLOADING" }, enabled = !busy, label = { Text("Разгрузка") })
        }
        OutlinedButton(enabled = !busy, onClick = {
            val c = Calendar.getInstance(java.util.TimeZone.getTimeZone("Europe/Moscow")).apply { timeInMillis = start }
            DatePickerDialog(context, { _, year, month, day ->
                c.set(year, month, day)
                TimePickerDialog(context, { _, hour, minute ->
                    c.set(Calendar.HOUR_OF_DAY, hour); c.set(Calendar.MINUTE, minute); c.set(Calendar.SECOND, 0); c.set(Calendar.MILLISECOND, 0)
                    start = c.timeInMillis
                }, c.get(Calendar.HOUR_OF_DAY), c.get(Calendar.MINUTE), true).show()
            }, c.get(Calendar.YEAR), c.get(Calendar.MONTH), c.get(Calendar.DAY_OF_MONTH)).show()
        }) { Text("Начало (МСК): ${clockText(start)} · изменить") }
        // FIX: one labelled row per cargo type; decimal pallets and integer units use appropriate keyboards.
        OutlinedTextField(quantity, { quantity = it.take(10) }, enabled = !busy, singleLine = true, keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Decimal), label = { Text("Палеты") }, modifier = Modifier.fillMaxWidth())
        OutlinedTextField(boxes, { boxes = it.take(6) }, enabled = !busy, singleLine = true, keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number), label = { Text("Короба") }, modifier = Modifier.fillMaxWidth())
        OutlinedTextField(bags, { bags = it.take(6) }, enabled = !busy, singleLine = true, keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number), label = { Text("Мешки") }, modifier = Modifier.fillMaxWidth())
        OutlinedTextField(rolls, { rolls = it.take(6) }, enabled = !busy, singleLine = true, keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number), label = { Text("Рулоны") }, modifier = Modifier.fillMaxWidth())
        Text("1 палета = 16 коробов = 5 мешков = 30 рулонов. Заполняйте только фактически выполненный объём без повторного учёта.")
        Text("Участники (создатель включён)")
        employees.forEach { employee ->
            Row {
                Checkbox(checked = employee.id in participants, enabled = !busy && employee.id != creator.id, onCheckedChange = { checked ->
                    participants = ArrayList(if (checked) (participants + employee.id).distinct() else participants - employee.id)
                })
                Text(employee.name, Modifier.padding(top = 12.dp))
            }
        }
        OutlinedTextField(note, { note = it.take(1000) }, enabled = !busy, label = { Text("Комментарий") }, modifier = Modifier.fillMaxWidth())
        Button(enabled = !busy && listOf(quantity,boxes,bags,rolls).any { it.isNotBlank() }, onClick = { onSave(participants, quantity, boxes, bags, rolls, start, type, note, id) }, modifier = Modifier.fillMaxWidth().height(60.dp)) {
            Text(if (busy) "Сохранение…" else "Сохранить для проверки")
        }
        OutlinedButton(enabled = !busy, onClick = onCancel, modifier = Modifier.fillMaxWidth()) { Text("Отмена") }
    }
}
