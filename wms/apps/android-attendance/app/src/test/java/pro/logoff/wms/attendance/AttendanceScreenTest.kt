package pro.logoff.wms.attendance

import android.app.Application
import androidx.compose.foundation.layout.Column
import androidx.compose.material3.Button
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.mutableStateOf
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
        compose.onNodeWithText("Сохранить для проверки").performScrollTo().performClick()
        compose.runOnIdle { assertEquals(listOf("1,5", "16", "5", "30", "LOADING", ""), sent) }
        compose.onNodeWithText("Сохранение…").assertIsNotEnabled()
    }
}
