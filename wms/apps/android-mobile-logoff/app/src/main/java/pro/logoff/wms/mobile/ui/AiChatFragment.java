package pro.logoff.wms.mobile.ui;

import android.graphics.Typeface;
import android.os.Bundle;
import android.view.Gravity;
import android.view.LayoutInflater;
import android.view.View;
import android.view.ViewGroup;
import android.view.inputmethod.EditorInfo;
import android.widget.LinearLayout;
import android.widget.TextView;
import android.widget.Toast;

import androidx.annotation.NonNull;
import androidx.annotation.Nullable;
import androidx.core.content.ContextCompat;
import androidx.fragment.app.Fragment;

import com.google.android.material.button.MaterialButton;
import com.google.android.material.card.MaterialCardView;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

import okhttp3.ResponseBody;
import pro.logoff.wms.mobile.LogoffApplication;
import pro.logoff.wms.mobile.R;
import pro.logoff.wms.mobile.databinding.FragmentAiChatBinding;
import pro.logoff.wms.mobile.files.DocumentSaver;
import pro.logoff.wms.mobile.network.MobileRepository;
import retrofit2.Call;
import retrofit2.Callback;
import retrofit2.Response;

public class AiChatFragment extends Fragment {
    private FragmentAiChatBinding binding;
    private LogoffApplication app;

    public static AiChatFragment newInstance() { return new AiChatFragment(); }

    @Nullable @Override public View onCreateView(
            @NonNull LayoutInflater inflater,
            @Nullable ViewGroup container,
            @Nullable Bundle state
    ) {
        binding = FragmentAiChatBinding.inflate(inflater, container, false);
        app = (LogoffApplication) requireActivity().getApplication();
        binding.send.setOnClickListener(view -> send());
        binding.message.setOnEditorActionListener((view, actionId, event) -> {
            if (actionId == EditorInfo.IME_ACTION_SEND) { send(); return true; }
            return false;
        });
        addSuggestion("Короба вне палет-сорта");
        addSuggestion("Остатки до 30 шт.");
        addSuggestion("Проблемы КИЗ");
        addBubble("Я работаю напрямую с API WMS. Спросите о товарах, коробах, заявках, КИЗ или перемещениях.", false);
        return binding.getRoot();
    }

    private void addSuggestion(String text) {
        MaterialButton button = new MaterialButton(requireContext(), null, com.google.android.material.R.attr.materialButtonOutlinedStyle);
        button.setText(text);
        button.setAllCaps(false);
        button.setOnClickListener(view -> { binding.message.setText(text); send(); });
        LinearLayout.LayoutParams params = new LinearLayout.LayoutParams(-2, dp(44));
        params.setMarginEnd(dp(8));
        binding.suggestions.addView(button, params);
    }

    private void send() {
        String message = binding.message.getText() == null ? "" : binding.message.getText().toString().trim();
        if (message.length() < 2) return;
        binding.message.setText("");
        addBubble(message, true);
        setLoading(true);
        Map<String, Object> body = new LinkedHashMap<>();
        body.put("message", message);
        app.repository().api().wmsAiChat(body).enqueue(new Callback<>() {
            @Override public void onResponse(Call<Map<String, Object>> call, Response<Map<String, Object>> response) {
                if (binding == null) return;
                setLoading(false);
                if (!response.isSuccessful() || response.body() == null) {
                    addBubble(MobileRepository.errorMessage(response), false);
                    return;
                }
                renderResponse(response.body());
            }
            @Override public void onFailure(Call<Map<String, Object>> call, Throwable error) {
                if (binding == null) return;
                setLoading(false);
                addBubble(MobileRepository.readable(error), false);
            }
        });
    }

    @SuppressWarnings("unchecked")
    private void renderResponse(Map<String, Object> value) {
        String title = text(value.get("title"));
        String answer = text(value.get("answer"));
        StringBuilder content = new StringBuilder();
        if (!title.isEmpty()) content.append(title).append("\n\n");
        content.append(answer);
        Object rawRows = value.get("rows");
        Object rawColumns = value.get("columns");
        if (rawRows instanceof List<?> && rawColumns instanceof List<?>) {
            List<?> rows = (List<?>) rawRows;
            List<?> columns = (List<?>) rawColumns;
            int shown = Math.min(rows.size(), 20);
            for (int index = 0; index < shown; index++) {
                Object rowValue = rows.get(index);
                if (!(rowValue instanceof Map<?, ?>)) continue;
                content.append("\n\n").append(index + 1).append(". ");
                List<String> cells = new ArrayList<>();
                for (Object columnValue : columns) {
                    if (!(columnValue instanceof Map<?, ?>)) continue;
                    Map<String, Object> column = (Map<String, Object>) columnValue;
                    String key = text(column.get("key"));
                    String label = text(column.get("label"));
                    String cell = text(((Map<String, Object>) rowValue).get(key));
                    if (!cell.isEmpty()) cells.add((label.isEmpty() ? key : label) + ": " + cell);
                }
                content.append(String.join(" · ", cells));
            }
            if (rows.size() > shown) content.append("\n\nЕщё строк: ").append(rows.size() - shown);
        }
        addBubble(content.toString(), false);
        Object exportValue = value.get("export");
        if (exportValue instanceof Map<?, ?> && Boolean.TRUE.equals(((Map<?, ?>) exportValue).get("available"))) {
            addExportButton((Map<String, Object>) exportValue);
        }
    }

    @SuppressWarnings("unchecked")
    private void addExportButton(Map<String, Object> export) {
        MaterialButton button = new MaterialButton(requireContext());
        button.setText("Скачать Excel");
        button.setAllCaps(false);
        button.setOnClickListener(view -> {
            Map<String, Object> params = export.get("params") instanceof Map<?, ?>
                    ? (Map<String, Object>) export.get("params") : new LinkedHashMap<>();
            Call<ResponseBody> call = app.repository().api().wmsAiExport(
                    text(export.get("tool")), nullableText(params.get("search")), nullableText(params.get("boxCode")),
                    nullableText(params.get("palletCode")), decimal(params.get("maxTotal")), decimal(params.get("minTotal")),
                    nullableText(params.get("clientSearch")), integer(params.get("requestNumber")), integer(params.get("days")),
                    nullableText(params.get("status"))
            );
            button.setEnabled(false);
            call.enqueue(new Callback<>() {
                @Override public void onResponse(Call<ResponseBody> request, Response<ResponseBody> response) {
                    if (!response.isSuccessful() || response.body() == null) { button.setEnabled(true); return; }
                    String fileName = text(export.get("fileName"));
                    DocumentSaver.save(requireContext(), fileName.isEmpty() ? "wms-ai.xlsx" : fileName,
                            "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", response.body(),
                            new DocumentSaver.Callback() {
                                @Override public void saved(android.net.Uri uri) { requireActivity().runOnUiThread(() -> Toast.makeText(requireContext(), "Excel сохранён в Загрузки/LOGOff WMS", Toast.LENGTH_LONG).show()); }
                                @Override public void failed(String message) { requireActivity().runOnUiThread(() -> { button.setEnabled(true); Toast.makeText(requireContext(), message, Toast.LENGTH_LONG).show(); }); }
                            });
                }
                @Override public void onFailure(Call<ResponseBody> request, Throwable error) { button.setEnabled(true); }
            });
        });
        LinearLayout.LayoutParams params = new LinearLayout.LayoutParams(-1, dp(50));
        params.topMargin = dp(8);
        params.bottomMargin = dp(8);
        binding.messages.addView(button, params);
        scrollToBottom();
    }

    private void addBubble(String text, boolean mine) {
        if (binding == null || text == null || text.isBlank()) return;
        MaterialCardView card = new MaterialCardView(requireContext());
        card.setRadius(dp(18));
        card.setCardElevation(0);
        card.setCardBackgroundColor(ContextCompat.getColor(requireContext(), mine ? R.color.logoff_blue_soft : R.color.logoff_card));
        TextView label = new TextView(requireContext());
        label.setText(text);
        label.setTextColor(ContextCompat.getColor(requireContext(), R.color.logoff_black));
        label.setTextSize(14);
        label.setLineSpacing(0, 1.12f);
        if (mine) label.setTypeface(Typeface.DEFAULT, Typeface.BOLD);
        label.setPadding(dp(16), dp(13), dp(16), dp(13));
        card.addView(label);
        LinearLayout.LayoutParams params = new LinearLayout.LayoutParams(mine ? dp(300) : -1, -2);
        params.gravity = mine ? Gravity.END : Gravity.START;
        params.bottomMargin = dp(8);
        binding.messages.addView(card, params);
        scrollToBottom();
    }

    private void setLoading(boolean loading) {
        binding.progress.setVisibility(loading ? View.VISIBLE : View.GONE);
        binding.send.setEnabled(!loading);
        binding.message.setEnabled(!loading);
    }
    private void scrollToBottom() { binding.messagesScroll.post(() -> binding.messagesScroll.fullScroll(View.FOCUS_DOWN)); }
    private String text(Object value) { return value == null || "null".equals(String.valueOf(value)) ? "" : String.valueOf(value).trim(); }
    private String nullableText(Object value) { String result = text(value); return result.isEmpty() ? null : result; }
    private Double decimal(Object value) { return value instanceof Number ? ((Number) value).doubleValue() : null; }
    private Integer integer(Object value) { return value instanceof Number ? ((Number) value).intValue() : null; }
    private int dp(int value) { return Math.round(value * getResources().getDisplayMetrics().density); }

    @Override public void onDestroyView() { binding = null; super.onDestroyView(); }
}
