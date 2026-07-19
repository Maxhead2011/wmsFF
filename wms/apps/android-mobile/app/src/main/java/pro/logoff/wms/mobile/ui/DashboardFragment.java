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
import androidx.core.content.ContextCompat;
import androidx.fragment.app.Fragment;

import com.google.android.material.card.MaterialCardView;

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
        ((MainActivity) requireActivity()).setNotificationCount((int) integer(data.get("unreadNotifications")));
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
        MaterialCardView card = new MaterialCardView(requireContext());
        card.setCardBackgroundColor(ContextCompat.getColor(requireContext(), R.color.logoff_card));
        card.setRadius(dp(20));
        card.setCardElevation(0);
        card.setStrokeWidth(dp(1));
        card.setStrokeColor(ContextCompat.getColor(requireContext(), R.color.logoff_border));
        card.setClickable(true);
        card.setFocusable(true);
        card.setOnClickListener(view -> action.run());
        android.util.TypedValue selectable = new android.util.TypedValue();
        requireContext().getTheme().resolveAttribute(android.R.attr.selectableItemBackground, selectable, true);
        card.setForeground(androidx.appcompat.content.res.AppCompatResources.getDrawable(requireContext(), selectable.resourceId));

        LinearLayout content = new LinearLayout(requireContext());
        content.setOrientation(LinearLayout.VERTICAL);
        content.setMinimumHeight(dp(126));
        content.setPadding(dp(16), dp(15), dp(14), dp(14));

        LinearLayout top = new LinearLayout(requireContext());
        top.setGravity(android.view.Gravity.CENTER_VERTICAL);
        TextView dot = new TextView(requireContext());
        dot.setText("●");
        dot.setTextColor(ContextCompat.getColor(requireContext(), accent));
        dot.setTextSize(13);
        TextView arrow = new TextView(requireContext());
        arrow.setText("↗");
        arrow.setGravity(android.view.Gravity.END);
        arrow.setTextColor(ContextCompat.getColor(requireContext(), R.color.logoff_text_muted));
        arrow.setTextSize(18);
        top.addView(dot, new LinearLayout.LayoutParams(0, -2, 1f));
        top.addView(arrow, new LinearLayout.LayoutParams(-2, -2));

        TextView amount = new TextView(requireContext());
        amount.setText(value);
        amount.setTextColor(ContextCompat.getColor(requireContext(), R.color.logoff_black));
        amount.setTextSize(22);
        amount.setTypeface(null, android.graphics.Typeface.BOLD);
        amount.setMaxLines(1);
        amount.setEllipsize(android.text.TextUtils.TruncateAt.END);
        LinearLayout.LayoutParams amountParams = new LinearLayout.LayoutParams(-1, -2);
        amountParams.topMargin = dp(10);

        TextView title = new TextView(requireContext());
        title.setText(label);
        title.setTextColor(ContextCompat.getColor(requireContext(), R.color.logoff_text_muted));
        title.setTextSize(12);
        title.setMaxLines(2);
        LinearLayout.LayoutParams titleParams = new LinearLayout.LayoutParams(-1, -2);
        titleParams.topMargin = dp(4);

        content.addView(top);
        content.addView(amount, amountParams);
        content.addView(title, titleParams);
        card.addView(content);
        GridLayout.LayoutParams params = new GridLayout.LayoutParams();
        params.width = 0;
        params.columnSpec = GridLayout.spec(GridLayout.UNDEFINED, 1f);
        params.setMargins(dp(5), dp(5), dp(5), dp(5));
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
    private long integer(Object value) { return value instanceof Number ? ((Number) value).longValue() : 0; }
    private String number(Object value) { return NumberFormat.getIntegerInstance(new Locale("ru", "RU")).format(value instanceof Number ? ((Number) value).longValue() : 0); }
    private String money(Object value) { return NumberFormat.getCurrencyInstance(new Locale("ru", "RU")).format(value instanceof Number ? ((Number) value).doubleValue() : 0); }
    private int dp(int value) { return Math.round(value * getResources().getDisplayMetrics().density); }
}
