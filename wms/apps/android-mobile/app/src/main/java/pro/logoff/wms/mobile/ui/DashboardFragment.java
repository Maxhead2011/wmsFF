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
import java.util.Locale;
import java.util.Map;

import pro.logoff.wms.mobile.AppState;
import pro.logoff.wms.mobile.LogoffApplication;
import pro.logoff.wms.mobile.MainActivity;
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
        binding.updated.setText(cached ? "Сохраненные данные · обновляю…" : "Данные обновлены");
        binding.metrics.removeAllViews();
        Map<String, Object> stock = map(data.get("stock"));
        Map<String, Object> invoices = map(data.get("invoices"));
        Map<String, Object> estimates = map(data.get("estimates"));
        addMetric("Активные заявки", number(data.get("activeRequests")), R.color.logoff_red, () -> openList(ListFragment.REQUESTS));
        addMetric("Единиц на складе", number(stock.get("units")), R.color.logoff_black, () -> openModule("stock", "Остатки"));
        addMetric("К оплате", money(invoices.get("debtRub")), R.color.logoff_warning, () -> openList(ListFragment.INVOICES));
        addMetric("Новых уведомлений", number(data.get("unreadNotifications")), R.color.logoff_success, () -> openList(ListFragment.NOTIFICATIONS));
        addMetric("Хранение предварительно", money(estimates.get("storageRub")), R.color.logoff_warning, () -> openModule("stock", "Остатки и хранение"));
        addMetric("ПРР предварительно", money(estimates.get("pprRub")), R.color.logoff_red, () -> openList(ListFragment.RECEIPTS));
        if (app.state().isAdmin()) {
            Map<String, Object> queue = map(data.get("adminQueue"));
            addMetric("Очередь задач", number(queue.get("total")), R.color.logoff_red, () -> openModule(app.state().can("system:admin") ? "service" : "inventory", "Очередь задач"));
            addMetric("Приемка: открыто", number(data.get("receivingBoxes")), R.color.logoff_black, () -> openList(ListFragment.RECEIPTS));
        }
    }

    private void addMetric(String label, String value, int accent, Runnable action) {
        LinearLayout card = new LinearLayout(requireContext());
        card.setOrientation(LinearLayout.VERTICAL);
        card.setPadding(dp(14), dp(13), dp(14), dp(13));
        card.setBackgroundResource(R.drawable.status_background);
        card.setClickable(true);
        card.setFocusable(true);
        card.setOnClickListener(view -> action.run());
        android.util.TypedValue selectable = new android.util.TypedValue();
        requireContext().getTheme().resolveAttribute(android.R.attr.selectableItemBackground, selectable, true);
        card.setForeground(androidx.appcompat.content.res.AppCompatResources.getDrawable(requireContext(), selectable.resourceId));
        TextView title = new TextView(requireContext()); title.setText(label); title.setTextColor(getResources().getColor(R.color.logoff_text_muted, null)); title.setTextSize(13);
        TextView amount = new TextView(requireContext()); amount.setText(value); amount.setTextColor(getResources().getColor(accent, null)); amount.setTextSize(23); amount.setTypeface(null, android.graphics.Typeface.BOLD);
        card.addView(title); card.addView(amount);
        GridLayout.LayoutParams params = new GridLayout.LayoutParams();
        params.width = 0; params.columnSpec = GridLayout.spec(GridLayout.UNDEFINED, 1f); params.setMargins(dp(4), dp(4), dp(4), dp(4));
        binding.metrics.addView(card, params);
    }

    private void openList(String kind) {
        ((MainActivity) requireActivity()).showNative(ListFragment.newInstance(kind), listTitle(kind));
    }

    private void openModule(String module, String title) {
        ((MainActivity) requireActivity()).showNative(NativeModuleFragment.newInstance(module, title), title);
    }

    private String listTitle(String kind) {
        if (ListFragment.REQUESTS.equals(kind)) return "Заявки";
        if (ListFragment.INVOICES.equals(kind)) return "Финансы";
        if (ListFragment.NOTIFICATIONS.equals(kind)) return "Уведомления";
        return "Онлайн приемка";
    }

    @SuppressWarnings("unchecked") private Map<String, Object> map(Object value) { return value instanceof Map<?, ?> ? (Map<String, Object>) value : Collections.emptyMap(); }
    private String number(Object value) { return NumberFormat.getIntegerInstance(new Locale("ru", "RU")).format(value instanceof Number ? ((Number) value).longValue() : 0); }
    private String money(Object value) { return NumberFormat.getCurrencyInstance(new Locale("ru", "RU")).format(value instanceof Number ? ((Number) value).doubleValue() : 0); }
    private int dp(int value) { return Math.round(value * getResources().getDisplayMetrics().density); }
}
