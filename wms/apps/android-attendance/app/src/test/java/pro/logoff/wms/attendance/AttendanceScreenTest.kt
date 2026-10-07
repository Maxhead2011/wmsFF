package pro.logoff.wms.attendance

import android.app.Application
import androidx.compose.foundation.layout.Column
import androidx.compose.material3.Button
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveableStateHolder
import androidx.compose.ui.test.junit4.StateRestorationTester
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createComposeRule
import org.junit.Rule
import org.junit.Test
import org.junit.Assert.*
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [29], application = Application::class)
class AttendanceScreenTest {
    @get:Rule val compose = createComposeRule()
    // TEST: portrait uses a separate employee screen; rotating preserves selection and permits work after clock-out.
    @Test fun `portrait selection and landscape show same closed employee`() {
        val person = Employee("one", "Грузчик", "moscow", true)
        val selected = mutableStateOf<String?>(null)
        val landscape = mutableStateOf(false)
        var action = ""
        compose.setContent { MaterialTheme {
            AttendanceHome(listOf(person), emptyList(), selected.value, { selected.value = it }, { action = it }, landscape.value)
        } }
        compose.onNodeWithText("Грузчик").performClick()
        compose.onNodeWithText("Смена закрыта").assertExists()
        compose.onNodeWithText("Погрузка / разгрузка").performScrollTo().performClick()
        assertEquals("handling", action)
        compose.runOnIdle { landscape.value = true }
        compose.onNodeWithText("Найти сотрудника").assertExists()
        compose.onNodeWithText("Смена закрыта").assertExists()
        compose.onNodeWithText("Сменить сотрудника", substring = true).assertDoesNotExist()
    }
    // TEST: actual saveable composition retains the draft and id across navigation and activity recreation.
    @Test fun `draft survives back and recreation without duplicating event id`() {
        val person = Employee("one", "Грузчик", "moscow", true)
        val open = mutableStateOf(true)
        val restore = StateRestorationTester(compose)
        val ids = mutableListOf<String>()
        restore.setContent { MaterialTheme {
            val holder = rememberSaveableStateHolder()
            if (open.value) holder.SaveableStateProvider("handling:one") {
                HandlingScreen(person, listOf(person), false, { open.value = false }) { _, pallets, _, _, _, _, _, _, id ->
                    assertEquals("3", pallets); ids.add(id)
                }
            } else Button(onClick = { open.value = true }) { Text("Вернуться") }
        } }
        compose.onNodeWithText("Палеты").performScrollTo().performTextInput("3")
        compose.onNodeWithText("Сохранить для проверки").performClick()
        compose.onNodeWithText("Назад · Черновик сохранится", substring = true).performClick()
        compose.onNodeWithText("Вернуться").performClick()
        restore.emulateSavedInstanceStateRestore()
        compose.onNodeWithText("Сохранить для проверки").performClick()
        assertEquals(2, ids.size); assertEquals(ids[0], ids[1])
    }
    // TEST: saving must remain visible without scrolling past every participant.
    @Test fun `cargo save remains visible with many employees`() {
        val people = (1..40).map { Employee("person-$it", "Грузчик $it", "moscow", true) }
        compose.setContent { MaterialTheme {
            HandlingScreen(people.first(), people, false, {}) { _, _, _, _, _, _, _, _, _ -> }
        } }
        compose.onNodeWithText("Сохранить для проверки").assertIsDisplayed()
    }
    // TEST: actual screen composition hides employee controls throughout camera capture and exposes them after cancellation.
    @Test fun `photo mark owns the screen until cancelled`() {
        val marking = mutableStateOf(true)
        val person = Employee("one", "Сотрудник", "moscow", true)
        compose.setContent {
            MaterialTheme { Column {
                AttendanceTask(marking.value, person, { marking.value = false }, mark = {
                    Text("Фотофиксация обеда")
                    Button(onClick = { marking.value = false }) { Text("Отмена") }
                }, content = { Text("Найти сотрудника"); Text("Начать смену") })
            } }
        }
        compose.onNodeWithText("Фотофиксация обеда").assertIsDisplayed()
        compose.onNodeWithText("Найти сотрудника").assertDoesNotExist()
        compose.onNodeWithText("Начать смену").assertDoesNotExist()
        compose.onNodeWithText("Отмена").performClick()
        compose.onNodeWithText("Найти сотрудника").assertIsDisplayed()
        compose.onNodeWithText("Фотофиксация обеда").assertDoesNotExist()
    }
    // TEST: removal of the selected employee cannot leave a second live form under the error.
    @Test fun `unavailable employee blocks list until explicit return`() {
        val marking = mutableStateOf(true)
        compose.setContent { MaterialTheme { Column {
            AttendanceTask(marking.value, null, { marking.value = false }, mark = { Text("Камера") }, content = { Text("Список сотрудников") })
        } } }
        compose.onNodeWithText("Список сотрудников").assertDoesNotExist()
        compose.onNodeWithText("Камера").assertDoesNotExist()
        compose.onNodeWithText("Вернуться к списку").performClick()
        compose.onNodeWithText("Список сотрудников").assertIsDisplayed()
    }
    // TEST: all four visible inputs and direction reach the durable-save callback in their correct positions.
    @Test fun `loader enters four cargo rows and loading direction`() {
        val person = Employee("one", "Грузчик", "moscow", true)
        val busy = mutableStateOf(false)
        var sent: List<String>? = null
        compose.setContent { MaterialTheme {
            HandlingScreen(person, listOf(person), busy.value, {}) { members, pallets, boxes, bags, rolls, start, type, note, id ->
                assertEquals(listOf(person.id), members); assertTrue(start > 0); assertTrue(id.isNotBlank())
                sent = listOf(pallets, boxes, bags, rolls, type, note); busy.value = true
            }
        } }
        compose.onNodeWithText("Погрузка").performClick()
        for ((label, value) in listOf("Палеты" to "1,5", "Короба" to "16", "Мешки" to "5", "Рулоны" to "30")) {
            compose.onNodeWithText(label).performScrollTo().performTextInput(value)
        }
        compose.onNodeWithText("Сохранить для проверки").assertIsDisplayed().performClick()
        compose.runOnIdle { assertEquals(listOf("1,5", "16", "5", "30", "LOADING", ""), sent) }
        compose.onNodeWithText("Сохранение…").assertIsNotEnabled()
    }
}
