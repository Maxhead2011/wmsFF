package pro.logoff.wms.mobile.ui;

import android.content.Intent;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.view.LayoutInflater;
import android.view.View;
import android.view.ViewGroup;
import android.widget.Toast;

import androidx.annotation.NonNull;
import androidx.annotation.Nullable;
import androidx.fragment.app.Fragment;
import androidx.recyclerview.widget.LinearLayoutManager;

import java.text.NumberFormat;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.Collections;
import java.util.List;
import java.util.Locale;
import java.util.Map;

import pro.logoff.wms.mobile.AppState;
import pro.logoff.wms.mobile.LogoffApplication;
import pro.logoff.wms.mobile.RequestFormActivity;
import pro.logoff.wms.mobile.databinding.FragmentListBinding;
import pro.logoff.wms.mobile.files.DocumentSaver;
import pro.logoff.wms.mobile.network.DataCallback;
import pro.logoff.wms.mobile.network.MobileRepository;
import retrofit2.Call;
import retrofit2.Callback;
import retrofit2.Response;

public class ListFragment extends Fragment {
    public static final String REQUESTS = "requests";
    public static final String RECEIPTS = "receipts";
    public static final String INVOICES = "invoices";
    public static final String NOTIFICATIONS = "notifications";
    private static final String ARG_KIND = "kind";
    private final Handler debounce = new Handler(Looper.getMainLooper());
    private FragmentListBinding binding;
    private LogoffApplication app;
    private JsonRowAdapter adapter;
    private String kind;

    public static ListFragment newInstance(String kind) {
        ListFragment fragment = new ListFragment(); Bundle args = new Bundle(); args.putString(ARG_KIND, kind); fragment.setArguments(args); return fragment;
    }

    @Nullable @Override public View onCreateView(@NonNull LayoutInflater inflater, @Nullable ViewGroup container, @Nullable Bundle state) {
        binding = FragmentListBinding.inflate(inflater, container, false);
        app = (LogoffApplication) requireActivity().getApplication();
        kind = getArguments() == null ? REQUESTS : getArguments().getString(ARG_KIND, REQUESTS);
        adapter = new JsonRowAdapter(this::onRowClick);
        binding.list.setLayoutManager(new LinearLayoutManager(requireContext()));
        binding.list.setAdapter(adapter);
        binding.swipe.setOnRefreshListener(this::load);
        binding.search.setHint(null);
        binding.searchLayout.setHint(searchHint());
        binding.search.addTextChangedListener(new android.text.TextWatcher() {
            @Override public void beforeTextChanged(CharSequence value, int start, int count, int after) {}
            @Override public void onTextChanged(CharSequence value, int start, int before, int count) { debounce.removeCallbacksAndMessages(null); debounce.postDelayed(ListFragment.this::load, 350); }
            @Override public void afterTextChanged(android.text.Editable value) {}
        });
        if (REQUESTS.equals(kind)) { binding.actionButton.setVisibility(View.VISIBLE); binding.actionButton.setOnClickListener(view -> startActivity(new Intent(requireContext(), RequestFormActivity.class))); }
        if (NOTIFICATIONS.equals(kind)) {
            binding.searchLayout.setVisibility(View.GONE);
            binding.actionButton.setVisibility(View.GONE);
            binding.bulkActionButton.setVisibility(View.VISIBLE);
            binding.bulkActionButton.setOnClickListener(view -> confirmMarkAllRead());
        }
        load();
        return binding.getRoot();
    }

    @Override public void onResume() { super.onResume(); if (binding != null) load(); }
    public void refresh() { if (binding != null) load(); }

    private void load() {
        binding.swipe.setRefreshing(true);
        String clientId = app.state().selectedClientId();
        String search = binding.search.getText() == null ? "" : binding.search.getText().toString();
        DataCallback<Map<String, Object>> callback = new DataCallback<>() {
            @Override public void onSuccess(Map<String, Object> value, boolean cached) {
                if (getActivity() == null) return;
                getActivity().runOnUiThread(() -> { if (isAdded() && binding != null) renderPage(value, cached); });
            }
            @Override public void onError(String message) { if (isAdded()) error(message); }
        };
        if (REQUESTS.equals(kind)) app.repository().requests(clientId, search, callback);
        else if (INVOICES.equals(kind)) app.repository().invoices(clientId, search, callback);
        else if (NOTIFICATIONS.equals(kind)) app.repository().notifications(clientId, callback);
        else loadReceipts(clientId);
    }

    private void loadReceipts(String clientId) {
        if (clientId == null || clientId.isEmpty()) { error("Выберите клиента."); return; }
        app.repository().api().onlineReceipts(clientId).enqueue(new Callback<>() {
            @Override public void onResponse(Call<Object> call, Response<Object> response) {
                if (!response.isSuccessful() || response.body() == null) { error(MobileRepository.errorMessage(response)); return; }
                if (getActivity() != null) getActivity().runOnUiThread(() -> { if (isAdded() && binding != null) renderReceipts(response.body()); });
            }
            @Override public void onFailure(Call<Object> call, Throwable failure) { error(MobileRepository.readable(failure)); }
        });
    }

    @SuppressWarnings("unchecked")
    private void renderPage(Map<String, Object> page, boolean cached) {
        binding.swipe.setRefreshing(false);
        Object raw = page.get("data");
        List<JsonRowAdapter.Row> rows = new ArrayList<>();
        if (raw instanceof List<?>) {
            for (Object item : (List<?>) raw) if (item instanceof Map<?, ?>) rows.add(toRow((Map<String, Object>) item));
        }
        adapter.submit(rows); binding.empty.setVisibility(rows.isEmpty() ? View.VISIBLE : View.GONE);
        if (NOTIFICATIONS.equals(kind) && requireActivity() instanceof pro.logoff.wms.mobile.MainActivity main) {
            int unread = 0;
            if (raw instanceof List<?>) {
                for (Object item : (List<?>) raw) {
                    if (item instanceof Map<?, ?> map && !Boolean.TRUE.equals(map.get("isRead"))) unread++;
                }
            }
            main.setNotificationCount(unread);
            binding.bulkActionButton.setEnabled(unread > 0);
            binding.bulkActionButton.setText(unread > 0
                    ? "Отметить все прочитанными · " + unread
                    : "Все уведомления прочитаны");
        }
        if (cached) Toast.makeText(requireContext(), "Сохраненные данные", Toast.LENGTH_SHORT).show();
    }

    private void confirmMarkAllRead() {
        new com.google.android.material.dialog.MaterialAlertDialogBuilder(requireContext())
                .setTitle("Прочитать все уведомления?")
                .setMessage("Все непрочитанные уведомления выбранного клиента будут отмечены прочитанными.")
                .setNegativeButton("Отмена", null)
                .setPositiveButton("Прочитать все", (dialog, which) -> markAllRead())
                .show();
    }

    private void markAllRead() {
        binding.bulkActionButton.setEnabled(false);
        Map<String, Object> body = new java.util.LinkedHashMap<>();
        String clientId = app.state().selectedClientId();
        if (clientId != null && !clientId.isBlank()) body.put("clientId", clientId);
        app.repository().api().markAllNotificationsRead(body).enqueue(new Callback<>() {
            @Override public void onResponse(Call<Map<String, Object>> call, Response<Map<String, Object>> response) {
                if (!response.isSuccessful()) {
                    error(MobileRepository.errorMessage(response));
                    binding.bulkActionButton.setEnabled(true);
                    return;
                }
                long updated = response.body() == null ? 0 : integer(response.body().get("updated"));
                if (requireActivity() instanceof pro.logoff.wms.mobile.MainActivity main) main.setNotificationCount(0);
                Toast.makeText(requireContext(), "Прочитано уведомлений: " + updated, Toast.LENGTH_SHORT).show();
                load();
            }
            @Override public void onFailure(Call<Map<String, Object>> call, Throwable failure) {
                binding.bulkActionButton.setEnabled(true);
                error(MobileRepository.readable(failure));
            }
        });
    }

    @SuppressWarnings("unchecked")
    private void renderReceipts(Object payload) {
        binding.swipe.setRefreshing(false);
        List<JsonRowAdapter.Row> rows = new ArrayList<>();
        if (payload instanceof Map<?, ?> map && map.get("boxes") instanceof List<?>) {
            for (Object item : (List<?>) map.get("boxes")) if (item instanceof Map<?, ?>) {
                Map<String, Object> box = (Map<String, Object>) item;
                String code = string(box.get("boxCode")); String status = string(box.get("status"));
                rows.add(new JsonRowAdapter.Row(code, code, "Товаров: " + integer(box.get("totalQuantity")) + " · КИЗ: " + integer(box.get("kizCount")) + "\nОператор: " + fallback(box.get("operator"), "не указан"), status, box));
            }
        }
        adapter.submit(rows); binding.empty.setVisibility(rows.isEmpty() ? View.VISIBLE : View.GONE);
    }

    @SuppressWarnings("unchecked")
    private JsonRowAdapter.Row toRow(Map<String, Object> item) {
        if (REQUESTS.equals(kind)) {
            Map<String, Object> client = item.get("client") instanceof Map<?, ?> ? (Map<String, Object>) item.get("client") : Collections.emptyMap();
            return new JsonRowAdapter.Row(string(item.get("id")), fallback(item.get("title"), "Заявка"), fallback(client.get("name"), "") + " · " + fallback(item.get("destinationCity"), "Город не указан") + "\nПозиций: " + integer(map(item.get("_count")).get("items")) + " · Единиц: " + integer(item.get("totalQuantity")), string(item.get("status")), item);
        }
        if (INVOICES.equals(kind)) {
            Map<String, Object> client = map(item.get("client"));
            return new JsonRowAdapter.Row(string(item.get("id")), "Счет № " + fallback(item.get("number"), "—"), fallback(client.get("name"), "") + "\nСумма: " + money(item.get("totalRub")) + " · Долг: " + money(item.get("debtRub")), string(item.get("status")), item);
        }
        return new JsonRowAdapter.Row(string(item.get("id")), fallback(item.get("title"), "Уведомление"), fallback(item.get("body"), ""), Boolean.TRUE.equals(item.get("isRead")) ? "Прочитано" : "Новое", item);
    }

    @SuppressWarnings("unchecked")
    private void onRowClick(JsonRowAdapter.Row row) {
        if (REQUESTS.equals(kind) && row.source() instanceof Map<?, ?>) {
            showRequestActions(row, (Map<String, Object>) row.source());
        } else if (NOTIFICATIONS.equals(kind) && row.source() instanceof Map<?, ?> source && !Boolean.TRUE.equals(((Map<String, Object>) source).get("isRead"))) {
            app.repository().api().markNotificationRead(row.id()).enqueue(new Callback<>() {
                @Override public void onResponse(Call<Map<String, Object>> call, Response<Map<String, Object>> response) {
                    if (requireActivity() instanceof pro.logoff.wms.mobile.MainActivity main) main.refreshNotificationBadge();
                    load();
                }
                @Override public void onFailure(Call<Map<String, Object>> call, Throwable error) { Toast.makeText(requireContext(), MobileRepository.readable(error), Toast.LENGTH_SHORT).show(); }
            });
        } else if (INVOICES.equals(kind)) {
            Map<String, Object> invoice = row.source() instanceof Map<?, ?> ? (Map<String, Object>) row.source() : Collections.emptyMap();
            String number = fallback(invoice.get("number"), row.id());
            boolean paid = "PAID".equals(string(invoice.get("status")));
            String[] actions = paid ? new String[]{"Скачать счет PDF", "Скачать акт PDF"} : new String[]{"Скачать счет PDF"};
            new com.google.android.material.dialog.MaterialAlertDialogBuilder(requireContext()).setTitle("Счет № " + number).setItems(actions, (dialog, which) -> downloadDocument(row.id(), number, which == 1)).setNegativeButton("Закрыть", null).show();
        } else {
            new com.google.android.material.dialog.MaterialAlertDialogBuilder(requireContext()).setTitle(row.title()).setMessage(row.subtitle()).setPositiveButton("Закрыть", null).show();
        }
    }

    private void showRequestActions(JsonRowAdapter.Row row, Map<String, Object> request) {
        String status = string(request.get("status"));
        boolean editable = app.state().isAdmin() || Arrays.asList("SUBMITTED", "IN_REVIEW", "APPROVED").contains(status);
        if (!editable) {
            new com.google.android.material.dialog.MaterialAlertDialogBuilder(requireContext()).setTitle(row.title()).setMessage(row.subtitle() + "\n\nСтатус: " + StatusLabels.label(status)).setPositiveButton("Закрыть", null).show();
            return;
        }
        String[] actions = new String[]{"Редактировать", "Отменить заявку", "Показать карточку"};
        new com.google.android.material.dialog.MaterialAlertDialogBuilder(requireContext()).setTitle(row.title()).setItems(actions, (dialog, which) -> {
            if (which == 0) {
                Intent intent = new Intent(requireContext(), RequestFormActivity.class); intent.putExtra("requestId", row.id()); intent.putExtra("title", string(request.get("title"))); intent.putExtra("city", string(request.get("destinationCity"))); intent.putExtra("comment", string(request.get("comment"))); startActivity(intent);
            } else if (which == 1) {
                new com.google.android.material.dialog.MaterialAlertDialogBuilder(requireContext()).setTitle("Отменить заявку?").setMessage("Заявка останется в истории со статусом «Отменена».").setNegativeButton("Нет", null).setPositiveButton("Отменить", (confirm, button) -> cancelRequest(row.id())).show();
            } else {
                new com.google.android.material.dialog.MaterialAlertDialogBuilder(requireContext())
                        .setTitle(row.title())
                        .setMessage(row.subtitle() + "\n\nСтатус: " + StatusLabels.label(status))
                        .setPositiveButton("Закрыть", null)
                        .show();
            }
        }).setNegativeButton("Закрыть", null).show();
    }

    private void cancelRequest(String id) {
        app.repository().api().cancelRequest(id, Collections.emptyMap()).enqueue(new Callback<>() {
            @Override public void onResponse(Call<Map<String, Object>> call, Response<Map<String, Object>> response) { if (response.isSuccessful()) { Toast.makeText(requireContext(), "Заявка отменена", Toast.LENGTH_SHORT).show(); load(); } else error(MobileRepository.errorMessage(response)); }
            @Override public void onFailure(Call<Map<String, Object>> call, Throwable failure) { error(MobileRepository.readable(failure)); }
        });
    }

    private void downloadDocument(String id, String number, boolean act) {
        Call<okhttp3.ResponseBody> call = act ? app.repository().api().actPdf(id) : app.repository().api().invoicePdf(id);
        call.enqueue(new Callback<>() {
            @Override public void onResponse(Call<okhttp3.ResponseBody> request, Response<okhttp3.ResponseBody> response) {
                if (!response.isSuccessful() || response.body() == null) { error(MobileRepository.errorMessage(response)); return; }
                DocumentSaver.save(requireContext().getApplicationContext(), (act ? "Акт_" : "Счет_") + number + ".pdf", response.body(), new DocumentSaver.Callback() {
                    @Override public void saved(android.net.Uri uri) { requireActivity().runOnUiThread(() -> Toast.makeText(requireContext(), "Файл сохранен в Загрузки/LOGOff WMS", Toast.LENGTH_LONG).show()); }
                    @Override public void failed(String message) { error(message); }
                });
            }
            @Override public void onFailure(Call<okhttp3.ResponseBody> request, Throwable failure) { error(MobileRepository.readable(failure)); }
        });
    }

    private void error(String message) {
        if (getActivity() == null) return;
        getActivity().runOnUiThread(() -> {
            if (!isAdded() || binding == null) return;
            binding.swipe.setRefreshing(false);
            Toast.makeText(getContext(), message, Toast.LENGTH_LONG).show();
        });
    }

    @Override public void onDestroyView() {
        binding = null;
        super.onDestroyView();
    }
    private String searchHint() { if (REQUESTS.equals(kind)) return "Заявка, город, товар или ШК"; if (INVOICES.equals(kind)) return "Номер счета или услуга"; if (RECEIPTS.equals(kind)) return "Короб, товар или КИЗ"; return "Уведомления"; }
    @SuppressWarnings("unchecked") private Map<String, Object> map(Object value) { return value instanceof Map<?, ?> ? (Map<String, Object>) value : Collections.emptyMap(); }
    private String string(Object value) { return value == null ? "" : String.valueOf(value); }
    private String fallback(Object value, String fallback) { String result = string(value); return result.trim().isEmpty() || "null".equals(result) ? fallback : result; }
    private long integer(Object value) { return value instanceof Number ? ((Number) value).longValue() : 0; }
    private String money(Object value) { return NumberFormat.getCurrencyInstance(new Locale("ru", "RU")).format(value instanceof Number ? ((Number) value).doubleValue() : 0); }
}
