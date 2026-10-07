package pro.logoff.wms.attendance

import android.content.res.Configuration
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import org.json.JSONObject

// FIX: identical large labels in the employee list and action panel; no horizontal squeeze in portrait.
@Composable
internal fun AttendanceHome(people: List<Employee>, events: List<Event>, selected: String?,
    onSelect: (String?) -> Unit, onAction: (String) -> Unit,
    landscape: Boolean = LocalConfiguration.current.orientation == Configuration.ORIENTATION_LANDSCAPE) {
    var query by rememberSaveable { mutableStateOf("") }
    val person = people.find { it.id == selected }
    val list: @Composable () -> Unit = {
        Column(Modifier.fillMaxHeight()) {
            Text("Выберите себя", fontSize = 28.sp, fontWeight = FontWeight.Bold)
            OutlinedTextField(query, { query = it }, label = { Text("Найти сотрудника") },
                singleLine = true, modifier = Modifier.fillMaxWidth())
            LazyColumn(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(12.dp), contentPadding = PaddingValues(vertical = 12.dp)) {
                items(people.filter { it.name.contains(query, true) }, key = { it.id }) { employee ->
                    if (employee.id == selected) Button(onClick = { onSelect(employee.id) }, modifier = Modifier.fillMaxWidth().heightIn(min = 88.dp)) {
                        ActionLabel(employee.name + employee.distinguishing.takeIf { it.isNotBlank() }?.let { " · $it" }.orEmpty())
                    } else OutlinedButton(onClick = { onSelect(employee.id) }, modifier = Modifier.fillMaxWidth().heightIn(min = 88.dp)) {
                        ActionLabel(employee.name + employee.distinguishing.takeIf { it.isNotBlank() }?.let { " · $it" }.orEmpty())
                    }
                }
            }
        }
    }
    val detail: @Composable () -> Unit = {
        Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()), verticalArrangement = Arrangement.spacedBy(12.dp)) {
            if (!landscape) OutlinedButton(onClick = { onSelect(null) }) { Text("← Сменить сотрудника") }
            if (person == null) Text("Выберите сотрудника слева", fontSize = 28.sp, fontWeight = FontWeight.Bold)
            else {
                Text(person.name, fontSize = 34.sp, fontWeight = FontWeight.Bold)
                val open = projectedOpen(person, events)
                val pause = projectedBreak(person, events)
                Text(pause?.let { "На обеде с ${clockText(it)}" } ?: open?.let { "На смене с ${clockText(it)}" } ?: "Смена закрыта", fontWeight = FontWeight.Bold)
                if (pause != null) Text("Время обеда вычитается из оплачиваемого времени", style = MaterialTheme.typography.bodySmall)
                OutlinedButton(onClick = { onAction(if (open == null) "clockIn" else "clockOut") }, modifier = Modifier.fillMaxWidth().heightIn(min = 88.dp)) {
                    ActionLabel(if (open == null) "Начать смену" else "Закончить смену")
                }
                if (open != null) OutlinedButton(onClick = { onAction(if (pause == null) "breakStart" else "breakEnd") }, modifier = Modifier.fillMaxWidth().heightIn(min = 88.dp)) {
                    ActionLabel(if (pause == null) "Обед" else "Вернулся с обеда")
                }
                if (person.loader) {
                    Button(onClick = { onAction("handling") }, modifier = Modifier.fillMaxWidth().heightIn(min = 88.dp)) { ActionLabel("Погрузка / разгрузка") }
                    Text("Можно добавить работу после закрытия смены", style = MaterialTheme.typography.bodySmall)
                }
                OutlinedButton(onClick = { onAction("history") }, modifier = Modifier.fillMaxWidth().heightIn(min = 88.dp)) { ActionLabel("Мои работы") }
                Text("При начале и окончании смены и обеда выполняется фотофиксация. Фото хранится на планшете 35 дней.", style = MaterialTheme.typography.bodySmall)
            }
        }
    }
    if (landscape) Row(Modifier.fillMaxSize(), horizontalArrangement = Arrangement.spacedBy(24.dp)) {
        Box(Modifier.weight(0.42f)) { list() }; Box(Modifier.weight(0.58f)) { detail() }
    } else if (person == null) list() else detail()
}

@Composable private fun ActionLabel(label: String) { Text(label, fontSize = 28.sp, lineHeight = 34.sp, fontWeight = FontWeight.Bold) }

// FIX: delivery is different from payroll approval; never claim that accepted work is already paid/approved.
internal fun deliveryLabel(event: Event): String = when(event.status) {
    "ACCEPTED" -> if (event.kind == "HANDLING") "Передано в WMS · Проверка оплаты в ФОТ" else "Передано в WMS"
    "REVIEW" -> "Нужна проверка администратора"
    else -> "Сохранено на планшете · Ожидает отправки"
}
internal fun belongsTo(event: Event, employeeId: String): Boolean = event.employeeId == employeeId ||
    (event.kind == "HANDLING" && runCatching {
        val ids = JSONObject(event.payload).optJSONArray("participantIds")
        ids != null && (0 until ids.length()).any { ids.optString(it) == employeeId }
    }.getOrDefault(false))
internal fun workDescription(event: Event): String = if (event.kind == "HANDLING") runCatching {
    val p = JSONObject(event.payload)
    val type = if (p.optString("type") == "LOADING") "Погрузка" else "Разгрузка"
    val cargo = listOf("pallets" to "Паллеты", "boxes" to "Короба", "bags" to "Мешки", "rolls" to "Рулоны")
        .filter { p.optString(it.first).toDoubleOrNull()?.let { n -> n > 0 } == true }
        .joinToString(" · ") { "${it.second}: ${p.optString(it.first)}" }
    "$type · ${clockText(p.optLong("startsAtMs", event.capturedAt))}\n$cargo"
}.getOrDefault("Погрузка / разгрузка") else when(event.kind) {
    "CLOCK_IN" -> "Начало смены"; "CLOCK_OUT" -> "Окончание смены"; "BREAK_START" -> "Обед"; "BREAK_END" -> "Вернулся с обеда"; else -> event.kind
}

@Composable internal fun WorkHistory(person: Employee?, events: List<Event>, onBack: () -> Unit, onRetry: () -> Unit) {
    Column(Modifier.fillMaxSize()) {
        OutlinedButton(onClick = onBack) { Text("← Назад") }
        Text(person?.let { "${it.name} · Мои работы" } ?: "Отправка отметок", fontSize = 28.sp, fontWeight = FontWeight.Bold)
        Text("Записи с этого планшета. Расчёт и оплата — в ФОТ.", style = MaterialTheme.typography.bodySmall)
        OutlinedButton(onClick = onRetry) { Text("Повторить отправку") }
        val visible = events.filter { if (person == null) it.status != "ACCEPTED" else belongsTo(it, person.id) }.asReversed()
        if (visible.isEmpty()) Text("Записей пока нет")
        LazyColumn(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(12.dp)) {
            items(visible, key = { it.id }) { event ->
                Card(Modifier.fillMaxWidth()) { Column(Modifier.padding(16.dp)) {
                    Text(workDescription(event), fontWeight = FontWeight.Bold)
                    Text("Внесено: ${clockText(event.capturedAt)}", style = MaterialTheme.typography.bodySmall)
                    Text(deliveryLabel(event), fontWeight = FontWeight.Bold)
                    if (event.reason.isNotBlank()) Text(event.reason, color = MaterialTheme.colorScheme.error)
                } }
            }
        }
    }
}
