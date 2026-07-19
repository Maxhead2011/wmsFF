package pro.logoff.wms.mobile.ui;

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

import com.google.android.material.dialog.MaterialAlertDialogBuilder;

import java.text.DateFormat;
import java.text.NumberFormat;
import java.util.ArrayList;
import java.util.Collections;
import java.util.Date;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;

import pro.logoff.wms.mobile.AppState;
import pro.logoff.wms.mobile.LogoffApplication;
import pro.logoff.wms.mobile.databinding.FragmentListBinding;
import pro.logoff.wms.mobile.network.DataCallback;

public class NativeModuleFragment extends Fragment {
    private static final String ARG_MODULE = "module";
    private static final String ARG_TITLE = "title";
    private final Handler debounce = new Handler(Looper.getMainLooper());
    private FragmentListBinding binding;
    private LogoffApplication app;
    private JsonRowAdapter adapter;
    private String module;
    private String title;

    public static NativeModuleFragment newInstance(String module, String title) {
        NativeModuleFragment fragment = new NativeModuleFragment();
        Bundle args = new Bundle();
        args.putString(ARG_MODULE, module);
        args.putString(ARG_TITLE, title);
        fragment.setArguments(args);
        return fragment;
    }

    @Nullable
    @Override
    public View onCreateView(@NonNull LayoutInflater inflater, @Nullable ViewGroup container, @Nullable Bundle state) {
        binding = FragmentListBinding.inflate(inflater, container, false);
        app = (LogoffApplication) requireActivity().getApplication();
        module = getArguments() == null ? "stock" : getArguments().getString(ARG_MODULE, "stock");
        title = getArguments() == null ? "Раздел" : getArguments().getString(ARG_TITLE, "Раздел");
        adapter = new JsonRowAdapter(this::showDetails);
        binding.list.setLayoutManager(new LinearLayoutManager(requireContext()));
        binding.list.setAdapter(adapter);
        binding.actionButton.setVisibility(View.GONE);
        binding.search.setHint(null);
        binding.searchLayout.setHint(searchHint(module));
        binding.swipe.setOnRefreshListener(this::load);
        binding.search.addTextChangedListener(new android.text.TextWatcher() {
            @Override public void beforeTextChanged(CharSequence value, int start, int count, int after) {}
            @Override public void onTextChanged(CharSequence value, int start, int before, int count) {
                debounce.removeCallbacksAndMessages(null);
                debounce.postDelayed(NativeModuleFragment.this::load, 350);
            }
            @Override public void afterTextChanged(android.text.Editable value) {}
        });
        load();
        return binding.getRoot();
    }

    private void load() {
        if (binding == null) return;
        binding.swipe.setRefreshing(true);
        String search = binding.search.getText() == null ? "" : binding.search.getText().toString().trim();
        app.repository().nativeModule(module, selectedClientId(), search, new DataCallback<>() {
            @Override public void onSuccess(Map<String, Object> value, boolean cached) {
                if (getActivity() == null) return;
                getActivity().runOnUiThread(() -> {
                    if (!isAdded() || binding == null) return;
                    render(value);
                    if (cached) Toast.makeText(requireContext(), "Показаны сохраненные данные", Toast.LENGTH_SHORT).show();
                });
            }

            @Override public void onError(String message) {
                if (getActivity() == null) return;
                getActivity().runOnUiThread(() -> {
                    if (!isAdded() || binding == null) return;
                    binding.swipe.setRefreshing(false);
                    Toast.makeText(requireContext(), message, Toast.LENGTH_LONG).show();
                });
            }
        });
    }

    public void refresh() { if (binding != null) load(); }

    private String selectedClientId() {
        if ("clients".equals(module) || "access".equals(module) || "print".equals(module)
                || "service".equals(module) || "own-companies".equals(module)) return null;
        return app.state().selectedClientId();
    }

    @SuppressWarnings("unchecked")
    private void render(Map<String, Object> page) {
        binding.swipe.setRefreshing(false);
        List<JsonRowAdapter.Row> rows = new ArrayList<>();
        Object raw = page.get("data");
        if (raw instanceof List<?>) {
            for (Object value : (List<?>) raw) {
                if (!(value instanceof Map<?, ?>)) continue;
                Map<String, Object> item = (Map<String, Object>) value;
                rows.add(new JsonRowAdapter.Row(
                        AppState.string(item.get("id")),
                        fallback(item.get("title"), "Без названия"),
                        fallback(item.get("subtitle"), ""),
                        fallback(item.get("status"), ""),
                        item
                ));
            }
        }
        adapter.submit(rows);
        binding.empty.setText("В разделе «" + title + "» пока нет данных");
        binding.empty.setVisibility(rows.isEmpty() ? View.VISIBLE : View.GONE);
    }

    @SuppressWarnings("unchecked")
    private void showDetails(JsonRowAdapter.Row row) {
        Map<String, Object> source = row.source() instanceof Map<?, ?> ? (Map<String, Object>) row.source() : Collections.emptyMap();
        Map<String, Object> details = source.get("details") instanceof Map<?, ?>
                ? (Map<String, Object>) source.get("details")
                : Collections.emptyMap();
        String message = detailText(module, row, details);
        new MaterialAlertDialogBuilder(requireContext())
                .setTitle(row.title())
                .setMessage(message)
                .setPositiveButton("Закрыть", null)
                .show();
    }

    private String detailText(String module, JsonRowAdapter.Row row, Map<String, Object> details) {
        List<String> lines = new ArrayList<>();
        if (!row.subtitle().isEmpty()) lines.add(row.subtitle());
        if (!row.status().isEmpty()) lines.add("Статус: " + StatusLabels.label(row.status()));

        LinkedHashMap<String, String> fields = new LinkedHashMap<>();
        if ("warehouse".equals(module)) {
            fields.put("Клиент", nested(details, "client", "name"));
            fields.put("Зона", first(nested(details, "zone", "name"), nested(details, "zone", "code")));
            fields.put("Паллета", nested(details, "pallet", "code"));
            fields.put("Количество", numberWithSuffix(details.get("quantity"), " шт."));
        } else if ("stock".equals(module)) {
            fields.put("Артикул", first(nested(details, "sku", "article"), nested(details, "sku", "internalSku")));
            fields.put("Короб", nested(details, "box", "code"));
            fields.put("Паллета", nested(details, "pallet", "code"));
            fields.put("Количество", numberWithSuffix(details.get("quantity"), " шт."));
        } else if ("catalog".equals(module)) {
            fields.put("Артикул", first(text(details.get("article")), text(details.get("internalSku"))));
            fields.put("Штрихкоды", barcodes(details.get("barcodes")));
            fields.put("Бренд", text(details.get("brand")));
            fields.put("Категория", text(details.get("category")));
            fields.put("Цвет", text(details.get("color")));
            fields.put("Размер", text(details.get("size")));
            fields.put("Вес", numberWithSuffix(details.get("weightGrams"), " г"));
            fields.put("Габариты", dimensions(details));
            fields.put("Объем", decimalWithSuffix(details.get("volumeLiters"), " л"));
            fields.put("Остаток", numberWithSuffix(details.get("quantity"), " шт."));
        } else if ("inventory".equals(module)) {
            fields.put("Комментарий", text(details.get("comment")));
            fields.put("Создал", text(details.get("createdByName")));
            fields.put("Начало", date(details.get("startedAt")));
            fields.put("Окончание", date(details.get("completedAt")));
            fields.put("Коробов с расхождениями", number(details.get("mismatchBoxes")));
        } else if ("turnover".equals(module)) {
            fields.put("Артикул", first(nested(details, "sku", "article"), nested(details, "sku", "internalSku")));
            fields.put("Короб", nested(details, "box", "code"));
            fields.put("Документ", text(details.get("sourceDocument")));
            fields.put("Комментарий", text(details.get("comment")));
            fields.put("Дата", date(details.get("createdAt")));
        } else if ("clients".equals(module) || "profile".equals(module)) {
            fields.put("Код", text(details.get("code")));
            fields.put("Юридическое имя", text(details.get("legalName")));
            fields.put("ИНН", text(details.get("inn")));
            fields.put("Телефон", text(details.get("phone")));
            fields.put("Email", text(details.get("email")));
        } else if ("access".equals(module)) {
            fields.put("Email", text(details.get("email")));
            fields.put("Создан", date(details.get("createdAt")));
            fields.put("Обновлен", date(details.get("updatedAt")));
        } else if ("logistics".equals(module)) {
            fields.put("Откуда", text(details.get("origin")));
            fields.put("Куда", text(details.get("destination")));
            fields.put("Коробов", number(details.get("boxes")));
            fields.put("Паллет", number(details.get("pallets")));
            fields.put("Желаемая дата", date(details.get("desiredShipDate")));
            fields.put("Плановая дата", date(details.get("plannedShipDate")));
            fields.put("Комментарий", text(details.get("comment")));
        } else if ("services".equals(module)) {
            fields.put("Цена", money(details.get("priceRub")));
            fields.put("Комментарий", text(details.get("comment")));
            fields.put("Налог", text(details.get("taxMode")));
        } else if ("imports".equals(module)) {
            fields.put("Загрузил", text(details.get("uploadedByName")));
            fields.put("Дата", date(details.get("createdAt")));
            fields.put("Количество", numberWithSuffix(details.get("quantity"), " шт."));
        } else if ("print".equals(module)) {
            fields.put("Принтер", text(details.get("printerCode")));
            fields.put("Тип этикетки", text(details.get("labelType")));
            fields.put("Создано", date(details.get("createdAt")));
            fields.put("Обработано", date(details.get("processedAt")));
        } else if ("service".equals(module)) {
            fields.put("ТСД", text(details.get("deviceId")));
            fields.put("Причина проверки", text(details.get("reviewReason")));
            fields.put("Сообщение", first(text(details.get("resolutionMessage")), text(details.get("serverMessage"))));
            fields.put("Создано", date(details.get("createdAt")));
        } else if ("own-companies".equals(module)) {
            fields.put("Полное название", text(details.get("fullName")));
            fields.put("ИНН", text(details.get("inn")));
            fields.put("КПП", text(details.get("kpp")));
            fields.put("Банк", text(details.get("bankName")));
            fields.put("Расчетный счет", text(details.get("bankAccount")));
        }

        for (Map.Entry<String, String> field : fields.entrySet()) {
            if (!field.getValue().isEmpty() && !containsLine(lines, field.getValue())) {
                lines.add(field.getKey() + ": " + field.getValue());
            }
        }
        if ("warehouse".equals(module)) appendBoxContents(lines, details.get("contents"));
        if ("catalog".equals(module)) appendProductBalances(lines, details.get("balances"));
        return String.join("\n\n", lines);
    }

    @SuppressWarnings("unchecked")
    private void appendBoxContents(List<String> lines, Object raw) {
        if (!(raw instanceof List<?>)) return;
        List<String> contents = new ArrayList<>();
        int index = 1;
        for (Object value : (List<?>) raw) {
            if (!(value instanceof Map<?, ?>)) continue;
            Map<String, Object> item = (Map<String, Object>) value;
            String name = fallback(item.get("name"), "Товар");
            String article = text(item.get("article"));
            String barcode = text(item.get("barcode"));
            String color = text(item.get("color"));
            String size = text(item.get("size"));
            String quantity = numberWithSuffix(item.get("quantity"), " шт.");
            String attributes = joinNonEmpty(" · ", article, barcode, color, size, quantity);
            contents.add(index + ". " + name + (attributes.isEmpty() ? "" : "\n" + attributes));
            index++;
        }
        if (!contents.isEmpty()) lines.add("Содержимое короба:\n\n" + String.join("\n\n", contents));
    }

    @SuppressWarnings("unchecked")
    private void appendProductBalances(List<String> lines, Object raw) {
        if (!(raw instanceof List<?>)) return;
        List<String> balances = new ArrayList<>();
        for (Object value : (List<?>) raw) {
            if (!(value instanceof Map<?, ?>)) continue;
            Map<String, Object> item = (Map<String, Object>) value;
            String place = first(nested(item, "box", "code"), nested(item, "pallet", "code"));
            if (place.isEmpty()) place = "Без короба";
            balances.add(place + " · " + numberWithSuffix(item.get("quantity"), " шт.") + " · " + StatusLabels.label(text(item.get("status"))));
        }
        if (!balances.isEmpty()) lines.add("Размещение:\n" + String.join("\n", balances));
    }

    private String searchHint(String module) {
        if ("warehouse".equals(module) || "inventory".equals(module)) return "Номер короба или название";
        if ("turnover".equals(module) || "stock".equals(module) || "catalog".equals(module)) return "ШК, артикул, товар или короб";
        if ("clients".equals(module) || "access".equals(module) || "profile".equals(module)) return "Имя, код, ИНН или email";
        if ("logistics".equals(module)) return "Город, клиент или рейс";
        if ("services".equals(module)) return "Услуга или клиент";
        if ("imports".equals(module)) return "Файл или пользователь";
        if ("print".equals(module)) return "Принтер, этикетка или статус";
        return "Поиск в разделе";
    }

    @Override public void onDestroyView() {
        debounce.removeCallbacksAndMessages(null);
        binding = null;
        super.onDestroyView();
    }

    @SuppressWarnings("unchecked")
    private String nested(Map<String, Object> value, String object, String key) {
        Object child = value.get(object);
        return child instanceof Map<?, ?> ? text(((Map<String, Object>) child).get(key)) : "";
    }
    private String fallback(Object value, String fallback) { String result = text(value); return result.isEmpty() ? fallback : result; }
    private String text(Object value) { return value == null || "null".equals(String.valueOf(value)) ? "" : String.valueOf(value).trim(); }
    private String first(String first, String second) { return first.isEmpty() ? second : first; }
    private String number(Object value) { return value instanceof Number ? NumberFormat.getIntegerInstance(new Locale("ru", "RU")).format(((Number) value).longValue()) : ""; }
    private String numberWithSuffix(Object value, String suffix) { String result = number(value); return result.isEmpty() ? "" : result + suffix; }
    private String money(Object value) { return value instanceof Number ? NumberFormat.getCurrencyInstance(new Locale("ru", "RU")).format(((Number) value).doubleValue()) : ""; }
    @SuppressWarnings("unchecked")
    private String barcodes(Object value) {
        if (!(value instanceof List<?>)) return "";
        List<String> result = new ArrayList<>();
        for (Object item : (List<?>) value) {
            if (item instanceof Map<?, ?>) {
                String barcode = text(((Map<String, Object>) item).get("value"));
                if (!barcode.isEmpty()) result.add(barcode);
            }
        }
        return String.join(", ", result);
    }
    private String dimensions(Map<String, Object> details) {
        String length = decimal(details.get("lengthCm"));
        String width = decimal(details.get("widthCm"));
        String height = decimal(details.get("heightCm"));
        if (length.isEmpty() && width.isEmpty() && height.isEmpty()) return "";
        return first(length, "0") + " × " + first(width, "0") + " × " + first(height, "0") + " см";
    }
    private String decimalWithSuffix(Object value, String suffix) { String result = decimal(value); return result.isEmpty() ? "" : result + suffix; }
    private String decimal(Object value) {
        if (value instanceof Number) return NumberFormat.getNumberInstance(new Locale("ru", "RU")).format(((Number) value).doubleValue());
        return text(value);
    }
    private String joinNonEmpty(String separator, String... values) {
        List<String> result = new ArrayList<>();
        for (String value : values) if (value != null && !value.isEmpty()) result.add(value);
        return String.join(separator, result);
    }
    private String date(Object value) {
        String raw = text(value);
        if (raw.isEmpty()) return "";
        try { return DateFormat.getDateTimeInstance(DateFormat.SHORT, DateFormat.SHORT, new Locale("ru", "RU")).format(new Date(java.time.Instant.parse(raw).toEpochMilli())); }
        catch (Exception ignored) { return raw; }
    }
    private boolean containsLine(List<String> lines, String value) {
        for (String line : lines) if (line.contains(value)) return true;
        return false;
    }
}
