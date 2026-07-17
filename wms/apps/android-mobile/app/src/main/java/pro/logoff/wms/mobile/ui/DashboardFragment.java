package pro.logoff.wms.mobile.ui;

import android.os.Bundle;
import android.view.LayoutInflater;
import android.view.View;
import android.view.ViewGroup;
import android.widget.GridLayout;
import android.widget.LinearLayout;
import android.widget.TextView;
import android.widget.Toast;

import androidx.annotation.NonNull;
import androidx.annotation.Nullable;
import androidx.fragment.app.Fragment;

import java.text.NumberFormat;
import java.util.Collections;
import java.util.List;
import java.util.Locale;
import java.util.Map;

import pro.logoff.wms.mobile.AppState;
import pro.logoff.wms.mobile.LogoffApplication;
import pro.logoff.wms.mobile.R;
import pro.logoff.wms.mobile.databinding.FragmentDashboardBinding;
import pro.logoff.wms.mobile.network.DataCallback;

public class DashboardFragment extends Fragment {
    private FragmentDashboardBinding binding;
    private LogoffApplication app;

    @Nullable @Override public View onCreateView(@NonNull LayoutInflater inflater, @Nullable ViewGroup container, @Nullable Bundle state) {
        binding = FragmentDashboardBinding.inflate(inflater, container, false);
        app = (LogoffApplication) requireActivity().getApplication();
        binding.swipe.setOnRefreshListener(this::load);
        load();
        return binding.getRoot();
    }

    private void load() {
        binding.swipe.setRefreshing(true);
        app.repository().dashboard(app.state().selectedClientId(), new DataCallback<>() {
            @Override public void onSuccess(Map<String, Object> value, boolean cached) {
                if (getActivity() == null) return;
                getActivity().runOnUiThread(() -> { if (isAdded() && binding != null) render(value, cached); });
            }
            @Override public void onError(String message) {
                if (getActivity() == null) return;
                getActivity().runOnUiThread(() -> {
                    if (!isAdded() || binding == null) return;
                    binding.swipe.setRefreshing(false);
                    Toast.makeText(getContext(), message, Toast.LENGTH_LONG).show();
                });
            }
        });
    }

    @Override public void onDestroyView() {
        binding = null;
        super.onDestroyView();
    }

    @SuppressWarnings("unchecked")
    private void render(Map<String, Object> data, boolean cached) {
        binding.swipe.setRefreshing(false);
        String name = AppState.string(app.state().user().get("name"));
        binding.greeting.setText((app.state().isAdmin() ? "Рабочий обзор" : "Здравствуйте, " + name));
        binding.updated.setText(cached ? "Сохраненные данные, нет связи" : "Данные обновлены");
        binding.metrics.removeAllViews();
        Map<String, Object> stock = map(data.get("stock"));
        Map<String, Object> invoices = map(data.get("invoices"));
        addMetric("Активные заявки", number(data.get("activeRequests")), R.color.logoff_red);
        addMetric("Единиц на складе", number(stock.get("units")), R.color.logoff_black);
        addMetric("К оплате", money(invoices.get("debtRub")), R.color.logoff_warning);
        addMetric("Новых уведомлений", number(data.get("unreadNotifications")), R.color.logoff_success);
        if (app.state().isAdmin()) {
            Map<String, Object> queue = map(data.get("adminQueue"));
            addMetric("Очередь задач", number(queue.get("total")), R.color.logoff_red);
            addMetric("Приемка: открыто", number(data.get("receivingBoxes")), R.color.logoff_black);
        }
        binding.recent.removeAllViews();
        Object recent = data.get("recentRequests");
        if (recent instanceof List<?>) {
            for (Object item : (List<?>) recent) if (item instanceof Map<?, ?>) addRecent((Map<String, Object>) item);
        }
        if (binding.recent.getChildCount() == 0) addPlain(binding.recent, "Последних событий пока нет.", false);
    }

    private void addMetric(String label, String value, int accent) {
        LinearLayout card = new LinearLayout(requireContext());
        card.setOrientation(LinearLayout.VERTICAL);
        card.setPadding(dp(14), dp(13), dp(14), dp(13));
        card.setBackgroundResource(R.drawable.status_background);
        TextView title = new TextView(requireContext()); title.setText(label); title.setTextColor(getResources().getColor(R.color.logoff_text_muted, null)); title.setTextSize(13);
        TextView amount = new TextView(requireContext()); amount.setText(value); amount.setTextColor(getResources().getColor(accent, null)); amount.setTextSize(23); amount.setTypeface(null, android.graphics.Typeface.BOLD);
        card.addView(title); card.addView(amount);
        GridLayout.LayoutParams params = new GridLayout.LayoutParams();
        params.width = 0; params.columnSpec = GridLayout.spec(GridLayout.UNDEFINED, 1f); params.setMargins(dp(4), dp(4), dp(4), dp(4));
        binding.metrics.addView(card, params);
    }

    private void addRecent(Map<String, Object> item) {
        String title = AppState.string(item.get("title"));
        String status = AppState.string(item.get("status"));
        addPlain(binding.recent, title + (status.isEmpty() ? "" : "\n" + statusLabel(status)), true);
    }

    private void addPlain(LinearLayout parent, String text, boolean strong) {
        TextView view = new TextView(requireContext()); view.setText(text); view.setTextSize(15); view.setTextColor(getResources().getColor(R.color.logoff_black, null)); view.setPadding(dp(12), dp(12), dp(12), dp(12)); if (strong) view.setTypeface(null, android.graphics.Typeface.BOLD); parent.addView(view, new LinearLayout.LayoutParams(-1, -2));
    }

    @SuppressWarnings("unchecked") private Map<String, Object> map(Object value) { return value instanceof Map<?, ?> ? (Map<String, Object>) value : Collections.emptyMap(); }
    private String number(Object value) { return NumberFormat.getIntegerInstance(new Locale("ru", "RU")).format(value instanceof Number ? ((Number) value).longValue() : 0); }
    private String money(Object value) { return NumberFormat.getCurrencyInstance(new Locale("ru", "RU")).format(value instanceof Number ? ((Number) value).doubleValue() : 0); }
    private int dp(int value) { return Math.round(value * getResources().getDisplayMetrics().density); }
    private String statusLabel(String status) { return StatusLabels.label(status); }
}
