package pro.logoff.wms.attendance

import android.Manifest
import android.app.DatePickerDialog
import android.app.TimePickerDialog
import android.content.pm.PackageManager
import android.os.Bundle
import android.os.SystemClock
import android.view.WindowManager
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.camera.core.CameraSelector
import androidx.camera.core.ImageCapture
import androidx.camera.core.ImageCaptureException
import androidx.camera.core.Preview
import androidx.camera.lifecycle.ProcessCameraProvider
import androidx.camera.view.PreviewView
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.lifecycle.compose.LocalLifecycleOwner
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.unit.dp
import androidx.compose.ui.viewinterop.AndroidView
import androidx.core.content.ContextCompat
import kotlinx.coroutines.*
import kotlinx.coroutines.flow.collectLatest
import java.io.File
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
            MaterialTheme(colorScheme = lightColorScheme(primary = Color(0xFFB81830), secondary = Color(0xFF202B43))) {
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
    val employees by app.repo.dao.employees().collectAsState(initial = emptyList())
    val events by app.repo.dao.events().collectAsState(initial = emptyList())
    fun refresh() {
        app.schedule()
        scope.launch(Dispatchers.IO) {
            try {
                val d = app.store.device() ?: return@launch
                val ok = app.sync.run(d) { app.store.time(it.serverTime, System.currentTimeMillis()) }
                app.store.syncMessage = if (ok) "Связь с WMS установлена" else "Нет связи. Отметки сохранены на планшете"
            } catch (e: CancellationException) { throw e }
            catch (e: Exception) { app.store.syncMessage = failureText(e) }
        }
    }
    LaunchedEffect(Unit) {
        try { device = withContext(Dispatchers.IO) { app.store.device() }; if (device != null) refresh() }
        catch (e: Exception) { fatal = true; message = "Регистрация недоступна. Очередь сохранена. Обратитесь к администратору" }
        initialized = true
        while (true) { syncMessage = app.store.syncMessage; delay(2000) }
    }
    // Only selection expires; entered handling data and a captured photo are never discarded by a timer.
    LaunchedEffect(selected, screen, busy) {
        if (screen == "list" && selected != null && !busy) { delay(45_000); selected = null }
    }
    Column(Modifier.fillMaxSize().statusBarsPadding().navigationBarsPadding().imePadding().padding(20.dp)) {
        Text("LOGOFF · Учёт времени", style = MaterialTheme.typography.headlineSmall, fontWeight = FontWeight.Bold)
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
        if (screen.startsWith("clock") && employee != null) {
            CameraScreen(employee, screen == "clockIn", busy, onCancel = { screen = "list" }) { photo, time, elapsed, eventId ->
                if (!busy) {
                    busy = true
                    scope.launch {
                        try {
                            withContext(Dispatchers.IO) { app.repo.mark(d, employee.id, screen == "clockIn", photo, time, elapsed,
                                app.store.offsetMs, app.store.syncedAt, eventId) }
                            photo.delete()
                            message = "Отметка сохранена на планшете: ${clockText(time)}. Ожидает подтверждения WMS"
                            screen = "list"; selected = null; query = ""; refresh()
                        } catch (e: CancellationException) { throw e }
                        catch (e: Exception) { message = e.message ?: "Не удалось сохранить отметку" }
                        finally { busy = false }
                    }
                }
            }
        } else if (screen == "handling" && employee != null) {
            HandlingScreen(employee, employees.filter { it.active && it.warehouseId == d.warehouseId }, busy,
                onCancel = { screen = "list" }) { members, quantity, start, type, note, id ->
                if (!busy) {
                    busy = true
                    scope.launch {
                        try {
                            withContext(Dispatchers.IO) { app.repo.handling(d, employee.id, members, quantity, start, type, note,
                                app.store.offsetMs, app.store.syncedAt, id) }
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
                OutlinedButton(onClick = { refresh() }) { Text("Обновить") }
                OutlinedButton(onClick = { screen = "queue"; selected = null }) { Text("Отправка отметок") }
            }
            OutlinedTextField(query, { query = it; selected = null }, label = { Text("Найти сотрудника") }, modifier = Modifier.fillMaxWidth(), singleLine = true)
            if (employees.isEmpty()) Text("Список сотрудников появится после подключения к API планшетов WMS.", Modifier.padding(vertical = 16.dp))
            LazyColumn(verticalArrangement = Arrangement.spacedBy(12.dp), modifier = Modifier.weight(1f)) {
                items(employees.filter { it.active && it.warehouseId == d.warehouseId && it.name.contains(query, true) }, key = { it.id }) { person ->
                    Card(Modifier.fillMaxWidth()) {
                        Column(Modifier.padding(16.dp)) {
                            TextButton(onClick = { selected = person.id }, modifier = Modifier.fillMaxWidth().heightIn(min = 56.dp)) {
                                Text(person.name + if (person.distinguishing.isNotBlank()) " · ${person.distinguishing}" else "", style = MaterialTheme.typography.titleLarge)
                            }
                            if (person.id == selected) {
                                val open = projectedOpen(person, events)
                                Text(open?.let { "На смене с ${clockText(it)}" } ?: "Смена не открыта")
                                Button(onClick = { screen = if (open == null) "clockIn" else "clockOut" }, modifier = Modifier.fillMaxWidth().heightIn(min = 60.dp)) {
                                    Text(if (open == null) "Начать смену" else "Закончить смену")
                                }
                                if (person.loader) OutlinedButton(onClick = { screen = "handling" }, modifier = Modifier.fillMaxWidth().heightIn(min = 56.dp)) { Text("Добавить погрузку / разгрузку") }
                            }
                        }
                    }
                }
            }
        }
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
private fun CameraScreen(employee: Employee, clockIn: Boolean, busy: Boolean, onCancel: () -> Unit,
    onSave: (File, Long, Long, String) -> Unit) {
    val context = LocalContext.current
    val lifecycle = LocalLifecycleOwner.current
    var granted by remember { mutableStateOf(ContextCompat.checkSelfPermission(context, Manifest.permission.CAMERA) == PackageManager.PERMISSION_GRANTED) }
    val permission = rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) { granted = it }
    var error by remember { mutableStateOf("") }
    var ready by remember { mutableStateOf(false) }
    var shooting by remember { mutableStateOf(false) }
    var photo by remember { mutableStateOf<File?>(null) }
    var takenAt by remember { mutableLongStateOf(0) }
    var elapsed by remember { mutableLongStateOf(0) }
    var eventId by remember { mutableStateOf(UUID.randomUUID().toString()) }
    val preview = remember { PreviewView(context) }
    val camera = remember { ImageCapture.Builder().setJpegQuality(75).setTargetResolution(android.util.Size(960, 720)).build() }
    DisposableEffect(granted, lifecycle) {
        var disposed = false
        var provider: ProcessCameraProvider? = null
        if (granted) {
            val future = ProcessCameraProvider.getInstance(context)
            future.addListener({
                if (!disposed) try {
                    val p = future.get(); provider = p
                    val view = Preview.Builder().build().also { it.setSurfaceProvider(preview.surfaceProvider) }
                    p.bindToLifecycle(lifecycle, CameraSelector.DEFAULT_FRONT_CAMERA, view, camera); ready = true
                } catch (e: Exception) { error = "Фронтальная камера недоступна. Обратитесь к администратору" }
            }, ContextCompat.getMainExecutor(context))
        }
        onDispose { disposed = true; provider?.unbindAll() }
    }
    Column(Modifier.fillMaxSize(), verticalArrangement = Arrangement.spacedBy(10.dp)) {
        Text(employee.name, style = MaterialTheme.typography.titleLarge)
        Text(if (clockIn) "Начало смены · фотография" else "Окончание смены · фотография")
        if (!granted) Button(onClick = { permission.launch(Manifest.permission.CAMERA) }) { Text("Разрешить камеру") }
        if (error.isNotBlank()) Text(error, color = MaterialTheme.colorScheme.error)
        if (photo == null) AndroidView(factory = { preview }, modifier = Modifier.fillMaxWidth().weight(1f))
        else {
            AndroidView(factory = { android.widget.ImageView(context).apply { scaleType = android.widget.ImageView.ScaleType.FIT_CENTER } },
                update = { it.setImageURI(android.net.Uri.fromFile(photo)) }, modifier = Modifier.fillMaxWidth().weight(1f))
            Text("Время отметки: ${clockText(takenAt)}")
        }
        if (photo == null) Button(enabled = granted && ready && !shooting && !busy, modifier = Modifier.fillMaxWidth().height(60.dp), onClick = {
            shooting = true; error = ""
            val dir = File(context.filesDir, "captures").apply { mkdirs() }
            val file = File(dir, "$eventId.jpg")
            takenAt = System.currentTimeMillis(); elapsed = SystemClock.elapsedRealtime()
            camera.targetRotation = preview.display?.rotation ?: 0
            camera.takePicture(ImageCapture.OutputFileOptions.Builder(file).build(), ContextCompat.getMainExecutor(context), object : ImageCapture.OnImageSavedCallback {
                override fun onImageSaved(output: ImageCapture.OutputFileResults) { shooting = false; photo = file }
                override fun onError(exception: ImageCaptureException) { shooting = false; error = "Фото не сохранено. Повторите съёмку" }
            })
        }) { Text(if (shooting) "Съёмка…" else "Сделать фото") }
        else {
            Button(enabled = !busy, modifier = Modifier.fillMaxWidth().height(60.dp), onClick = { onSave(photo!!, takenAt, elapsed, eventId) }) { Text(if (busy) "Сохранение…" else "Подтвердить отметку") }
            TextButton(enabled = !busy, onClick = { photo?.delete(); photo = null; eventId = UUID.randomUUID().toString() }) { Text("Переснять") }
        }
        OutlinedButton(enabled = !busy && !shooting, onClick = { photo?.delete(); onCancel() }, modifier = Modifier.fillMaxWidth()) { Text("Отмена") }
    }
}

@Composable
private fun HandlingScreen(creator: Employee, employees: List<Employee>, busy: Boolean, onCancel: () -> Unit,
    onSave: (List<String>, String, Long, String, String, String) -> Unit) {
    val context = LocalContext.current
    var participants by rememberSaveable { mutableStateOf<List<String>>(listOf(creator.id)) }
    var quantity by rememberSaveable { mutableStateOf("") }
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
        OutlinedTextField(quantity, { quantity = it.take(10) }, enabled = !busy, label = { Text("Количество паллет") }, modifier = Modifier.fillMaxWidth())
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
        Button(enabled = !busy && quantity.isNotBlank(), onClick = { onSave(participants, quantity, start, type, note, id) }, modifier = Modifier.fillMaxWidth().height(60.dp)) {
            Text(if (busy) "Сохранение…" else "Сохранить для проверки")
        }
        OutlinedButton(enabled = !busy, onClick = onCancel, modifier = Modifier.fillMaxWidth()) { Text("Отмена") }
    }
}
