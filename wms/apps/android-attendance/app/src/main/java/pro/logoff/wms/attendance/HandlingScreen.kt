package pro.logoff.wms.attendance

import android.app.DatePickerDialog
import android.app.TimePickerDialog
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import java.util.Calendar
import java.util.UUID

@Composable
internal fun HandlingScreen(creator: Employee, employees: List<Employee>, busy: Boolean, onCancel: () -> Unit, error: String = "",
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
    // FIX: only fields scroll; back, errors and save remain outside the participant list.
    Column(Modifier.fillMaxSize(), verticalArrangement = Arrangement.spacedBy(8.dp)) {
        OutlinedButton(enabled = !busy, onClick = onCancel) { Text("← Назад · Черновик сохранится") }
        Text(creator.name, fontWeight = FontWeight.Bold)
        Column(Modifier.weight(1f).verticalScroll(rememberScrollState()), verticalArrangement = Arrangement.spacedBy(12.dp)) {
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
        }
        if (error.isNotBlank()) Text(error, color = MaterialTheme.colorScheme.error, fontWeight = FontWeight.Bold)
        Button(enabled = !busy && listOf(quantity,boxes,bags,rolls).any { it.isNotBlank() }, onClick = { onSave(participants, quantity, boxes, bags, rolls, start, type, note, id) }, modifier = Modifier.fillMaxWidth().heightIn(min = 72.dp)) {
            Text(if (busy) "Сохранение…" else "Сохранить для проверки")
        }

    }
}
