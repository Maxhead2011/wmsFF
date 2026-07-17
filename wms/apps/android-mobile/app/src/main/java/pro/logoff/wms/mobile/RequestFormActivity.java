package pro.logoff.wms.mobile;

import android.net.Uri;
import android.os.Bundle;
import android.view.View;
import android.widget.ArrayAdapter;
import android.widget.TextView;
import android.widget.Toast;

import androidx.activity.result.ActivityResultLauncher;
import androidx.activity.result.contract.ActivityResultContracts;
import androidx.appcompat.app.AppCompatActivity;

import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.util.ArrayList;
import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

import okhttp3.MediaType;
import okhttp3.MultipartBody;
import okhttp3.RequestBody;
import pro.logoff.wms.mobile.databinding.ActivityRequestFormBinding;
import pro.logoff.wms.mobile.network.MobileRepository;
import retrofit2.Call;
import retrofit2.Callback;
import retrofit2.Response;

public class RequestFormActivity extends AppCompatActivity {
    private ActivityRequestFormBinding binding;
    private LogoffApplication app;
    private final List<Map<String, Object>> items = new ArrayList<>();
    private List<Map<String, Object>> clients = Collections.emptyList();
    private ActivityResultLauncher<String[]> picker;
    private String requestId = "";

    @Override protected void onCreate(Bundle state) {
        super.onCreate(state); app = (LogoffApplication) getApplication(); binding = ActivityRequestFormBinding.inflate(getLayoutInflater()); setContentView(binding.getRoot());
        clients = app.state().clients();
        requestId = getIntent().getStringExtra("requestId") == null ? "" : getIntent().getStringExtra("requestId");
        List<String> names = new ArrayList<>(); for (Map<String, Object> client : clients) names.add(AppState.string(client.get("name")));
        binding.client.setAdapter(new ArrayAdapter<>(this, android.R.layout.simple_spinner_dropdown_item, names));
        binding.addItem.setOnClickListener(view -> addItem()); binding.save.setOnClickListener(view -> create()); binding.upload.setOnClickListener(view -> picker.launch(new String[]{"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "application/vnd.ms-excel"}));
        picker = registerForActivityResult(new ActivityResultContracts.OpenDocument(), this::upload);
        if (!requestId.isEmpty()) {
            binding.title.setText(getIntent().getStringExtra("title")); binding.city.setText(getIntent().getStringExtra("city")); binding.comment.setText(getIntent().getStringExtra("comment"));
            binding.save.setText("Сохранить изменения"); binding.upload.setVisibility(View.GONE); binding.addItem.setVisibility(View.GONE); binding.barcode.setEnabled(false); binding.quantity.setEnabled(false); binding.itemName.setEnabled(false);
        }
    }

    private void addItem() {
        String barcode = text(binding.barcode); int quantity = intValue(text(binding.quantity));
        if (barcode.isEmpty() || quantity < 1) { showError("Для позиции укажите ШК/SKU и количество."); return; }
        Map<String, Object> item = new LinkedHashMap<>(); item.put("barcode", barcode); item.put("quantity", quantity); String name = text(binding.itemName); if (!name.isEmpty()) item.put("name", name); items.add(item);
        TextView row = new TextView(this); row.setText(barcode + " · " + quantity + " шт" + (name.isEmpty() ? "" : " · " + name)); row.setTextSize(15); row.setPadding(12, 12, 12, 12); row.setOnLongClickListener(view -> { items.remove(item); binding.items.removeView(row); return true; }); binding.items.addView(row);
        binding.barcode.setText(""); binding.quantity.setText(""); binding.itemName.setText(""); binding.error.setVisibility(View.GONE);
    }

    private void create() {
        if (!validBase()) return;
        Map<String, Object> body = baseBody();
        Call<Map<String, Object>> request;
        if (requestId.isEmpty()) { body.put("type", "OUTBOUND"); body.put("priority", "NORMAL"); body.put("items", items); request = app.repository().api().createRequest(body); }
        else { body.remove("clientId"); request = app.repository().api().updateRequest(requestId, body); }
        setBusy(true); request.enqueue(new Callback<>() {
            @Override public void onResponse(Call<Map<String, Object>> call, Response<Map<String, Object>> response) { setBusy(false); if (response.isSuccessful()) { Toast.makeText(RequestFormActivity.this, requestId.isEmpty() ? "Заявка создана" : "Изменения сохранены", Toast.LENGTH_LONG).show(); finish(); } else showError(MobileRepository.errorMessage(response)); }
            @Override public void onFailure(Call<Map<String, Object>> call, Throwable error) { setBusy(false); showError(MobileRepository.readable(error)); }
        });
    }

    private void upload(Uri uri) {
        if (uri == null || !validBase()) return;
        try {
            byte[] bytes = read(uri); String fileName = queryName(uri); RequestBody fileBody = RequestBody.create(bytes, MediaType.get("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")); MultipartBody.Part file = MultipartBody.Part.createFormData("file", fileName, fileBody);
            Map<String, Object> base = baseBody(); setBusy(true);
            app.repository().api().uploadRequest(file, textPart(base.get("clientId")), textPart(base.get("title")), textPart(base.get("destinationCity")), textPart(base.get("comment"))).enqueue(new Callback<>() {
                @Override public void onResponse(Call<Map<String, Object>> call, Response<Map<String, Object>> response) { setBusy(false); if (response.isSuccessful()) { Toast.makeText(RequestFormActivity.this, "Заявка из Excel создана", Toast.LENGTH_LONG).show(); finish(); } else showError(MobileRepository.errorMessage(response)); }
                @Override public void onFailure(Call<Map<String, Object>> call, Throwable error) { setBusy(false); showError(MobileRepository.readable(error)); }
            });
        } catch (IOException error) { showError("Не удалось прочитать файл: " + error.getMessage()); }
    }

    private Map<String, Object> baseBody() { Map<String, Object> body = new LinkedHashMap<>(); body.put("clientId", AppState.string(clients.get(binding.client.getSelectedItemPosition()).get("id"))); body.put("title", text(binding.title)); body.put("destinationCity", text(binding.city)); body.put("comment", text(binding.comment)); return body; }
    private boolean validBase() { if (clients.isEmpty()) { showError("Нет доступного клиента."); return false; } if (text(binding.title).isEmpty() || text(binding.city).isEmpty()) { showError("Укажите название заявки и город."); return false; } return true; }
    private void setBusy(boolean busy) { binding.save.setEnabled(!busy); binding.upload.setEnabled(!busy); }
    private void showError(String value) { binding.error.setText(value); binding.error.setVisibility(View.VISIBLE); }
    private String text(TextView view) { return view.getText() == null ? "" : view.getText().toString().trim(); }
    private int intValue(String value) { try { return Integer.parseInt(value); } catch (Exception ignored) { return 0; } }
    private RequestBody textPart(Object value) { return RequestBody.create(AppState.string(value), MediaType.get("text/plain")); }
    private byte[] read(Uri uri) throws IOException { try (InputStream input = getContentResolver().openInputStream(uri); ByteArrayOutputStream output = new ByteArrayOutputStream()) { if (input == null) throw new IOException("Файл недоступен"); byte[] buffer = new byte[8192]; int count; while ((count = input.read(buffer)) >= 0) output.write(buffer, 0, count); return output.toByteArray(); } }
    private String queryName(Uri uri) { try (android.database.Cursor cursor = getContentResolver().query(uri, new String[]{android.provider.OpenableColumns.DISPLAY_NAME}, null, null, null)) { if (cursor != null && cursor.moveToFirst()) return cursor.getString(0); } catch (Exception ignored) {} return "request.xlsx"; }
}
