package pro.logoff.wms.mobile.ui;

import android.graphics.Typeface;
import android.os.Bundle;
import android.text.Editable;
import android.text.InputType;
import android.text.TextWatcher;
import android.view.Gravity;
import android.view.LayoutInflater;
import android.view.View;
import android.view.ViewGroup;
import android.widget.ArrayAdapter;
import android.widget.CheckBox;
import android.widget.EditText;
import android.widget.GridLayout;
import android.widget.LinearLayout;
import android.widget.Spinner;
import android.widget.TextView;
import android.widget.Toast;

import androidx.annotation.NonNull;
import androidx.annotation.Nullable;
import androidx.core.content.ContextCompat;
import androidx.fragment.app.Fragment;

import com.google.android.material.button.MaterialButton;
import com.google.android.material.card.MaterialCardView;
import com.google.android.material.dialog.MaterialAlertDialogBuilder;

import java.text.NumberFormat;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;

import pro.logoff.wms.mobile.AppState;
import pro.logoff.wms.mobile.LogoffApplication;
import pro.logoff.wms.mobile.MainActivity;
import pro.logoff.wms.mobile.R;
import pro.logoff.wms.mobile.databinding.FragmentFbsBinding;
import pro.logoff.wms.mobile.files.DocumentSaver;
import pro.logoff.wms.mobile.network.MobileRepository;
import okhttp3.ResponseBody;
import retrofit2.Call;
import retrofit2.Callback;
import retrofit2.Response;

public class FbsFragment extends Fragment {
    private static final String ACTIVE = "active";
    private static final String SHIPPED = "shipped";
    private static final String COST = "cost";
    private static final String ARCHIVE = "archive";
    private static final String CALCULATOR = "calculator";
    private static final String PRICING = "pricing";
    private static final int CALCULATOR_MAX_QUANTITY = 3000;
    private static final int CALCULATOR_ITEMS_PER_BOX = 14;
    private static final int CALCULATOR_BOXES_PER_PALLET = 16;

    private FragmentFbsBinding binding;
    private LogoffApplication app;
    private String section = ACTIVE;
    private Map<String, Object> orderData = Collections.emptyMap();
    private List<Map<String, Object>> activeClients = Collections.emptyList();
    private final Map<String, Map<String, Object>> selectedOrders = new LinkedHashMap<>();
    private Map<String, Object> settingsData = Collections.emptyMap();
    private List<Map<String, Object>> calculatorTariffSets = Collections.emptyList();
    private Map<String, Object> calculatorTariffDetail = Collections.emptyMap();
    private List<String> calculatorDestinations = Collections.emptyList();
    private String calculatorTariffId = "";
    private boolean loadingOrders;
    private boolean loadingActiveClients;
    private boolean orderActionRunning;
    private boolean loadingSettings;
    private boolean loadingCalculator;
    private PricingForm pricingForm;
    private CalculatorForm calculatorForm;

    public static FbsFragment newInstance() {
        return new FbsFragment();
    }

    @Nullable
    @Override
    public View onCreateView(
            @NonNull LayoutInflater inflater,
            @Nullable ViewGroup container,
            @Nullable Bundle state
    ) {
        binding = FragmentFbsBinding.inflate(inflater, container, false);
        app = (LogoffApplication) requireActivity().getApplication();
        binding.swipe.setColorSchemeResources(R.color.logoff_red);
        binding.swipe.setOnRefreshListener(() -> refresh(true));
        binding.search.addTextChangedListener(new TextWatcher() {
            @Override public void beforeTextChanged(CharSequence value, int start, int count, int after) {}
            @Override public void onTextChanged(CharSequence value, int start, int before, int count) {
                if (isOrderSection()) renderOrders();
            }
            @Override public void afterTextChanged(Editable value) {}
        });
        renderSections();
        refresh(false);
        return binding.getRoot();
    }

    public void refresh() {
        orderData = Collections.emptyMap();
        activeClients = Collections.emptyList();
        selectedOrders.clear();
        settingsData = Collections.emptyMap();
        calculatorTariffSets = Collections.emptyList();
        calculatorTariffDetail = Collections.emptyMap();
        calculatorDestinations = Collections.emptyList();
        calculatorTariffId = "";
        refresh(false);
    }

    private void refresh(boolean force) {
        loadOrders(force);
        loadActiveClients(force);
        if (PRICING.equals(section) && canManagePricing()) loadSettings(force);
        if (CALCULATOR.equals(section) && calculatorEnabled()) loadCalculatorOptions(force);
    }

    private void loadOrders(boolean force) {
        String clientId = app.state().selectedClientId();
        if (clientId == null || clientId.isBlank()) {
            showEmpty("Сначала выберите клиента.");
            binding.swipe.setRefreshing(false);
            return;
        }
        loadingOrders = true;
        updateLoading();
        app.repository().api().fbsOrders(clientId, force ? 1 : null).enqueue(new Callback<>() {
            @Override
            public void onResponse(Call<Map<String, Object>> call, Response<Map<String, Object>> response) {
                if (!isAdded() || binding == null) return;
                loadingOrders = false;
                if (response.isSuccessful() && response.body() != null) {
                    orderData = response.body();
                    pruneSelectedOrders();
                    renderSections();
                    if (isOrderSection()) renderOrders();
                } else if (isOrderSection()) {
                    showEmpty(readableError(response));
                }
                updateLoading();
            }

            @Override
            public void onFailure(Call<Map<String, Object>> call, Throwable error) {
                if (!isAdded() || binding == null) return;
                loadingOrders = false;
                if (isOrderSection()) showEmpty(MobileRepository.readable(error));
                updateLoading();
            }
        });
    }

    private void loadActiveClients(boolean force) {
        if (!force && !activeClients.isEmpty()) return;
        loadingActiveClients = true;
        updateLoading();
        app.repository().api().fbsActiveClients().enqueue(new Callback<>() {
            @Override
            public void onResponse(
                    Call<List<Map<String, Object>>> call,
                    Response<List<Map<String, Object>>> response
            ) {
                if (!isAdded() || binding == null) return;
                loadingActiveClients = false;
                if (response.isSuccessful() && response.body() != null) {
                    activeClients = response.body();
                    if (ACTIVE.equals(section) && !orderData.isEmpty()) renderOrders();
                }
                updateLoading();
            }

            @Override
            public void onFailure(Call<List<Map<String, Object>>> call, Throwable error) {
                if (!isAdded() || binding == null) return;
                loadingActiveClients = false;
                updateLoading();
            }
        });
    }

    private void loadSettings(boolean force) {
        if (!canManagePricing()) return;
        String clientId = app.state().selectedClientId();
        if (clientId == null || clientId.isBlank()) {
            showEmpty("Сначала выберите клиента.");
            return;
        }
        if (!force && !settingsData.isEmpty()) {
            renderPricing();
            return;
        }
        loadingSettings = true;
        updateLoading();
        app.repository().api().fbsBillingSettings(clientId).enqueue(new Callback<>() {
            @Override
            public void onResponse(Call<Map<String, Object>> call, Response<Map<String, Object>> response) {
                if (!isAdded() || binding == null) return;
                loadingSettings = false;
                if (response.isSuccessful() && response.body() != null) {
                    settingsData = response.body();
                    if (PRICING.equals(section)) renderPricing();
                } else if (PRICING.equals(section)) {
                    showEmpty(readableError(response));
                }
                updateLoading();
            }

            @Override
            public void onFailure(Call<Map<String, Object>> call, Throwable error) {
                if (!isAdded() || binding == null) return;
                loadingSettings = false;
                if (PRICING.equals(section)) showEmpty(MobileRepository.readable(error));
                updateLoading();
            }
        });
    }

    private void loadCalculatorOptions(boolean force) {
        if (!calculatorEnabled()) return;
        if (canManagePricing()) {
            if (!force && !calculatorTariffSets.isEmpty()) {
                if (calculatorTariffDetail.isEmpty() && !calculatorTariffId.isBlank()) {
                    loadCalculatorTariff(calculatorTariffId);
                } else {
                    renderCalculator();
                }
                return;
            }
            loadingCalculator = true;
            updateLoading();
            app.repository().api().logisticsTariffSets().enqueue(new Callback<>() {
                @Override
                public void onResponse(
                        Call<List<Map<String, Object>>> call,
                        Response<List<Map<String, Object>>> response
                ) {
                    if (!isAdded() || binding == null) return;
                    if (response.isSuccessful() && response.body() != null) {
                        calculatorTariffSets = response.body();
                        boolean selectedExists = false;
                        for (Map<String, Object> tariff : calculatorTariffSets) {
                            if (calculatorTariffId.equals(AppState.string(tariff.get("id")))) {
                                selectedExists = true;
                                break;
                            }
                        }
                        if (!selectedExists) {
                            calculatorTariffId = calculatorTariffSets.isEmpty()
                                    ? "" : AppState.string(calculatorTariffSets.get(0).get("id"));
                        }
                        if (calculatorTariffId.isBlank()) {
                            loadingCalculator = false;
                            if (CALCULATOR.equals(section)) showEmpty("Тарифы логистики пока не настроены.");
                            updateLoading();
                        } else {
                            loadCalculatorTariff(calculatorTariffId);
                        }
                    } else {
                        loadingCalculator = false;
                        if (CALCULATOR.equals(section)) showEmpty(readableError(response));
                        updateLoading();
                    }
                }

                @Override
                public void onFailure(Call<List<Map<String, Object>>> call, Throwable error) {
                    if (!isAdded() || binding == null) return;
                    loadingCalculator = false;
                    if (CALCULATOR.equals(section)) showEmpty(MobileRepository.readable(error));
                    updateLoading();
                }
            });
            return;
        }

        if (!force && !calculatorDestinations.isEmpty()) {
            renderCalculator();
            return;
        }
        loadingCalculator = true;
        updateLoading();
        app.repository().api().fbsCalculatorDestinations().enqueue(new Callback<>() {
            @Override
            public void onResponse(Call<Map<String, Object>> call, Response<Map<String, Object>> response) {
                if (!isAdded() || binding == null) return;
                loadingCalculator = false;
                if (response.isSuccessful() && response.body() != null) {
                    calculatorDestinations = strings(response.body().get("destinations"));
                    if (CALCULATOR.equals(section)) renderCalculator();
                } else if (CALCULATOR.equals(section)) {
                    showEmpty(readableError(response));
                }
                updateLoading();
            }

            @Override
            public void onFailure(Call<Map<String, Object>> call, Throwable error) {
                if (!isAdded() || binding == null) return;
                loadingCalculator = false;
                if (CALCULATOR.equals(section)) showEmpty(MobileRepository.readable(error));
                updateLoading();
            }
        });
    }

    private void loadCalculatorTariff(String tariffId) {
        if (tariffId == null || tariffId.isBlank()) return;
        calculatorTariffId = tariffId;
        calculatorTariffDetail = Collections.emptyMap();
        loadingCalculator = true;
        updateLoading();
        app.repository().api().logisticsTariffSet(tariffId).enqueue(new Callback<>() {
            @Override
            public void onResponse(Call<Map<String, Object>> call, Response<Map<String, Object>> response) {
                if (!isAdded() || binding == null || !calculatorTariffId.equals(tariffId)) return;
                loadingCalculator = false;
                if (response.isSuccessful() && response.body() != null) {
                    calculatorTariffDetail = response.body();
                    calculatorDestinations = buildCalculatorDestinations(calculatorTariffDetail);
                    if (CALCULATOR.equals(section)) renderCalculator();
                } else if (CALCULATOR.equals(section)) {
                    showEmpty(readableError(response));
                }
                updateLoading();
            }

            @Override
            public void onFailure(Call<Map<String, Object>> call, Throwable error) {
                if (!isAdded() || binding == null || !calculatorTariffId.equals(tariffId)) return;
                loadingCalculator = false;
                if (CALCULATOR.equals(section)) showEmpty(MobileRepository.readable(error));
                updateLoading();
            }
        });
    }

    private void renderSections() {
        if (binding == null) return;
        binding.sections.removeAllViews();
        Map<String, Object> counts = map(orderData.get("counts"));
        addSectionCard("Активные заказы", count(counts.get("active")), ACTIVE, R.color.logoff_red, false);
        addSectionCard("Отгруженные", count(counts.get("shipped")), SHIPPED, R.color.logoff_success, false);
        addSectionCard("Стоимость обработки", "Расчёт", COST, R.color.logoff_warning, false);
        addSectionCard("Архив", count(counts.get("archive")), ARCHIVE, R.color.logoff_black, false);
        if (calculatorEnabled()) {
            addSectionCard(
                    "Калькулятор FBS",
                    canManagePricing() ? "Город и тариф WMS" : "Стоимость с налогом",
                    CALCULATOR,
                    R.color.logoff_success,
                    false
            );
        }
        if (canManagePricing()) {
            addSectionCard(
                    "Назначение стоимости обработки",
                    "Тарифы выбранного клиента",
                    PRICING,
                    R.color.logoff_blue,
                    true
            );
        }
    }

    private void addSectionCard(
            String title,
            String subtitle,
            String key,
            int accentColor,
            boolean wide
    ) {
        boolean selected = key.equals(section);
        MaterialCardView card = new MaterialCardView(requireContext());
        card.setCardBackgroundColor(ContextCompat.getColor(requireContext(),
                selected ? R.color.logoff_red_soft : R.color.logoff_card));
        card.setRadius(dp(20));
        card.setCardElevation(0);
        card.setStrokeWidth(dp(selected ? 2 : 1));
        card.setStrokeColor(ContextCompat.getColor(requireContext(),
                selected ? R.color.logoff_red : R.color.logoff_border));
        card.setClickable(true);
        card.setFocusable(true);

        LinearLayout content = new LinearLayout(requireContext());
        content.setOrientation(LinearLayout.VERTICAL);
        content.setGravity(Gravity.CENTER_VERTICAL);
        content.setMinimumHeight(dp(wide ? 86 : 104));
        content.setPadding(dp(16), dp(15), dp(14), dp(14));

        TextView dot = text("●", 12, accentColor, Typeface.BOLD);
        TextView heading = text(title, wide ? 15 : 14, R.color.logoff_black, Typeface.BOLD);
        heading.setMaxLines(2);
        TextView detail = text(subtitle, 12, R.color.logoff_text_muted, Typeface.NORMAL);
        LinearLayout.LayoutParams headingParams = new LinearLayout.LayoutParams(-1, -2);
        headingParams.topMargin = dp(5);
        LinearLayout.LayoutParams detailParams = new LinearLayout.LayoutParams(-1, -2);
        detailParams.topMargin = dp(4);
        content.addView(dot);
        content.addView(heading, headingParams);
        content.addView(detail, detailParams);
        card.addView(content);
        card.setOnClickListener(view -> selectSection(key));

        GridLayout.LayoutParams params = new GridLayout.LayoutParams();
        params.width = 0;
        params.columnSpec = GridLayout.spec(GridLayout.UNDEFINED, wide ? 2 : 1, wide ? 2f : 1f);
        params.setMargins(dp(5), dp(5), dp(5), dp(5));
        binding.sections.addView(card, params);
    }

    private void selectSection(String next) {
        section = next;
        pricingForm = null;
        calculatorForm = null;
        renderSections();
        binding.searchLayout.setVisibility(isOrderSection() ? View.VISIBLE : View.GONE);
        if (PRICING.equals(section)) loadSettings(false);
        else if (CALCULATOR.equals(section)) loadCalculatorOptions(false);
        else renderOrders();
    }

    private void renderOrders() {
        if (binding == null || !isOrderSection()) return;
        binding.content.removeAllViews();
        binding.empty.setVisibility(View.GONE);
        binding.heroTitle.setText(titleForSection());
        Map<String, Object> client = map(orderData.get("client"));
        String clientLabel = joinNonBlank(
                AppState.string(client.get("code")),
                AppState.string(client.get("name"))
        );
        binding.heroSubtitle.setText(clientLabel.isBlank()
                ? "Заказы, отгрузки и стоимость обработки"
                : clientLabel);

        if (orderData.isEmpty()) {
            if (!loadingOrders) showEmpty("Данные FBS пока не загружены.");
            return;
        }
        boolean connected = Boolean.TRUE.equals(orderData.get("connected"));
        List<Map<String, Object>> orders = maps(orderData.get("orders"));
        String query = AppState.string(binding.search.getText()).trim().toLowerCase(new Locale("ru", "RU"));
        List<Map<String, Object>> visible = new ArrayList<>();
        String category = COST.equals(section) ? SHIPPED : section;
        for (Map<String, Object> order : orders) {
            if (!category.equals(AppState.string(order.get("category")))) continue;
            if (!query.isBlank() && !searchText(order).contains(query)) continue;
            visible.add(order);
        }

        addOrdersSummary(visible.size(), connected);
        if (ACTIVE.equals(section)) addActiveClientShortcuts();
        if (!connected && visible.isEmpty()) {
            addConnectionPrompt();
            return;
        }
        if (visible.isEmpty()) {
            showEmpty(query.isBlank()
                    ? "В этом разделе пока нет заказов."
                    : "По вашему запросу ничего не найдено.");
            return;
        }
        if (ACTIVE.equals(section)) addOrderActions(visible);
        for (Map<String, Object> order : visible) addOrderCard(order);
    }

    private void addOrdersSummary(int size, boolean connected) {
        LinearLayout summary = new LinearLayout(requireContext());
        summary.setGravity(Gravity.CENTER_VERTICAL);
        summary.setPadding(dp(4), 0, dp(4), dp(8));
        TextView title = text(titleForSection(), 19, R.color.logoff_black, Typeface.BOLD);
        TextView badge = text(connected ? size + " шт." : "API не подключён", 12,
                connected ? R.color.logoff_success : R.color.logoff_warning, Typeface.BOLD);
        badge.setGravity(Gravity.END);
        summary.addView(title, new LinearLayout.LayoutParams(0, -2, 1f));
        summary.addView(badge, new LinearLayout.LayoutParams(-2, -2));
        binding.content.addView(summary);
    }

    private void addActiveClientShortcuts() {
        if (app.state().clients().size() <= 1 || activeClients.isEmpty()) return;
        MaterialCardView card = baseCard();
        LinearLayout content = cardContent();
        content.addView(text("Клиенты с активными заказами", 15, R.color.logoff_black, Typeface.BOLD));
        TextView note = text("Нажмите на клиента, чтобы сразу открыть его FBS-заказы.", 12,
                R.color.logoff_text_muted, Typeface.NORMAL);
        LinearLayout.LayoutParams noteParams = new LinearLayout.LayoutParams(-1, -2);
        noteParams.topMargin = dp(5);
        noteParams.bottomMargin = dp(8);
        content.addView(note, noteParams);

        for (Map<String, Object> row : activeClients) {
            Map<String, Object> client = map(row.get("client"));
            String clientId = AppState.string(client.get("id"));
            if (clientId.isBlank()) continue;
            String label = firstNonBlank(AppState.string(client.get("name")), "Клиент")
                    + " · " + count(row.get("activeOrders"));
            MaterialButton button = outlinedButton(label);
            if (clientId.equals(app.state().selectedClientId())) {
                button.setStrokeColorResource(R.color.logoff_red);
                button.setTextColor(ContextCompat.getColor(requireContext(), R.color.logoff_red));
            }
            button.setOnClickListener(view ->
                    ((MainActivity) requireActivity()).selectClientFromModule(clientId));
            LinearLayout.LayoutParams params = new LinearLayout.LayoutParams(-1, dp(46));
            params.topMargin = dp(6);
            content.addView(button, params);
        }
        card.addView(content);
        binding.content.addView(card, cardParams());
    }

    private void addOrderActions(List<Map<String, Object>> visibleOrders) {
        MaterialCardView card = baseCard();
        card.setStrokeColor(ContextCompat.getColor(requireContext(), R.color.logoff_blue));
        LinearLayout content = cardContent();
        content.addView(text("Инструменты FBS", 16, R.color.logoff_black, Typeface.BOLD));

        int selectedCount = selectedOrders.size();
        TextView selected = text(
                selectedCount == 0
                        ? "Выберите заказы для сборки, заявки или массового скачивания."
                        : "Выбрано заказов: " + selectedCount,
                12,
                R.color.logoff_text_muted,
                Typeface.NORMAL
        );
        LinearLayout.LayoutParams selectedParams = new LinearLayout.LayoutParams(-1, -2);
        selectedParams.topMargin = dp(5);
        content.addView(selected, selectedParams);

        boolean allVisibleSelected = !visibleOrders.isEmpty();
        for (Map<String, Object> order : visibleOrders) {
            if (!selectedOrders.containsKey(orderKey(order))) {
                allVisibleSelected = false;
                break;
            }
        }
        MaterialButton selectAll = outlinedButton(allVisibleSelected ? "Снять выбор" : "Выбрать все показанные");
        selectAll.setEnabled(!orderActionRunning);
        boolean finalAllVisibleSelected = allVisibleSelected;
        selectAll.setOnClickListener(view -> {
            for (Map<String, Object> order : visibleOrders) {
                if (finalAllVisibleSelected) selectedOrders.remove(orderKey(order));
                else selectedOrders.put(orderKey(order), order);
            }
            renderOrders();
        });
        addActionButton(content, selectAll);

        if (selectedCount > 0) {
            List<Map<String, Object>> selectedValues = new ArrayList<>(selectedOrders.values());
            List<Map<String, Object>> assembly = filterOrders(selectedValues, "assemble");
            List<Map<String, Object>> requests = filterOrders(selectedValues, "request");
            List<Map<String, Object>> stickers = filterOrders(selectedValues, "stickers");
            List<Map<String, Object>> cargo = filterOrders(selectedValues, "cargo");

            MaterialButton assemble = primaryButton("Собрать (" + assembly.size() + ")");
            assemble.setEnabled(!orderActionRunning && !assembly.isEmpty());
            assemble.setOnClickListener(view -> confirmAssemble(assembly));
            addActionButton(content, assemble);

            MaterialButton request = outlinedButton("Создать заявку (" + requests.size() + ")");
            request.setEnabled(!orderActionRunning && !requests.isEmpty());
            request.setOnClickListener(view -> confirmCreateRequest(requests));
            addActionButton(content, request);

            MaterialButton stickersButton = outlinedButton("Скачать ШК (" + stickers.size() + ")");
            stickersButton.setEnabled(!orderActionRunning && !stickers.isEmpty());
            stickersButton.setOnClickListener(view -> downloadOrderStickers(stickers));
            addActionButton(content, stickersButton);

            if (requiresCargoPlaces()) {
                MaterialButton cargoButton = outlinedButton("QR грузомест (" + cargo.size() + ")");
                cargoButton.setEnabled(!orderActionRunning && !cargo.isEmpty());
                cargoButton.setOnClickListener(view -> downloadCargoPlaceStickers(cargo));
                addActionButton(content, cargoButton);
            }
        }

        Map<String, Object> deliveryPlan = map(orderData.get("deliveryPlan"));
        int itemsPerCargoPlace = Math.max(1, (int) Math.round(numberValue(deliveryPlan.get("itemsPerCargoPlace"))));
        TextView cargoHint = text(
                requiresCargoPlaces()
                        ? "Сдача в ПВЗ: одно грузоместо на каждые " + itemsPerCargoPlace
                                + " единиц. QR общий для всей поставки."
                        : "Сдача в сортировочный центр: грузоместа WB не создаются.",
                11,
                R.color.logoff_text_muted,
                Typeface.BOLD
        );
        LinearLayout.LayoutParams hintParams = new LinearLayout.LayoutParams(-1, -2);
        hintParams.topMargin = dp(10);
        content.addView(cargoHint, hintParams);
        card.addView(content);
        binding.content.addView(card, cardParams());
    }

    private void addActionButton(LinearLayout content, MaterialButton button) {
        LinearLayout.LayoutParams params = new LinearLayout.LayoutParams(-1, dp(48));
        params.topMargin = dp(8);
        content.addView(button, params);
    }

    private void addConnectionPrompt() {
        MaterialCardView card = baseCard();
        LinearLayout content = cardContent();
        content.addView(text("Подключите API маркетплейса", 18, R.color.logoff_black, Typeface.BOLD));
        TextView note = text(
                "После подключения Wildberries или Ozon приложение начнёт получать FBS-заказы и их статусы.",
                13,
                R.color.logoff_text_muted,
                Typeface.NORMAL
        );
        LinearLayout.LayoutParams noteParams = new LinearLayout.LayoutParams(-1, -2);
        noteParams.topMargin = dp(7);
        content.addView(note, noteParams);
        MaterialButton button = primaryButton("Подключить API");
        LinearLayout.LayoutParams buttonParams = new LinearLayout.LayoutParams(-1, dp(52));
        buttonParams.topMargin = dp(16);
        content.addView(button, buttonParams);
        button.setOnClickListener(view -> showConnectionDialog());
        card.addView(content);
        binding.content.addView(card, cardParams());
    }

    private void showConnectionDialog() {
        LinearLayout form = new LinearLayout(requireContext());
        form.setOrientation(LinearLayout.VERTICAL);
        form.setPadding(dp(4), dp(8), dp(4), 0);

        Spinner marketplace = spinner(Arrays.asList("Wildberries", "Ozon"));
        EditText account = field("Название кабинета", "", InputType.TYPE_CLASS_TEXT);
        EditText seller = field("Client-Id Ozon", "", InputType.TYPE_CLASS_TEXT);
        EditText key = field("API-ключ", "",
                InputType.TYPE_CLASS_TEXT | InputType.TYPE_TEXT_VARIATION_PASSWORD);
        seller.setVisibility(View.GONE);
        marketplace.setOnItemSelectedListener(new SimpleItemSelectedListener(position ->
                seller.setVisibility(position == 1 ? View.VISIBLE : View.GONE)));

        form.addView(label("Маркетплейс"));
        form.addView(marketplace, fieldParams());
        form.addView(account, fieldParams());
        form.addView(seller, fieldParams());
        form.addView(key, fieldParams());

        androidx.appcompat.app.AlertDialog dialog = new MaterialAlertDialogBuilder(requireContext())
                .setTitle("Подключение FBS")
                .setView(form)
                .setNegativeButton("Отмена", null)
                .setPositiveButton("Подключить", null)
                .create();
        dialog.setOnShowListener(ignored -> dialog.getButton(androidx.appcompat.app.AlertDialog.BUTTON_POSITIVE)
                .setOnClickListener(view -> {
                    String apiKey = AppState.string(key.getText()).trim();
                    String sellerId = AppState.string(seller.getText()).trim();
                    if (apiKey.length() < 8) {
                        key.setError("Введите API-ключ");
                        return;
                    }
                    if (marketplace.getSelectedItemPosition() == 1 && sellerId.isBlank()) {
                        seller.setError("Введите Client-Id");
                        return;
                    }
                    Map<String, Object> body = new LinkedHashMap<>();
                    body.put("clientId", app.state().selectedClientId());
                    body.put("marketplace", marketplace.getSelectedItemPosition() == 1 ? "OZON" : "WILDBERRIES");
                    body.put("accountName", AppState.string(account.getText()).trim());
                    body.put("apiKey", apiKey);
                    if (!sellerId.isBlank()) body.put("sellerId", sellerId);
                    dialog.getButton(androidx.appcompat.app.AlertDialog.BUTTON_POSITIVE).setEnabled(false);
                    app.repository().api().createFbsConnection(body).enqueue(new Callback<>() {
                        @Override
                        public void onResponse(Call<Map<String, Object>> call, Response<Map<String, Object>> response) {
                            if (!isAdded()) return;
                            if (response.isSuccessful()) {
                                dialog.dismiss();
                                Toast.makeText(requireContext(), "API подключён", Toast.LENGTH_LONG).show();
                                loadOrders(true);
                            } else {
                                dialog.getButton(androidx.appcompat.app.AlertDialog.BUTTON_POSITIVE).setEnabled(true);
                                Toast.makeText(requireContext(), readableError(response), Toast.LENGTH_LONG).show();
                            }
                        }

                        @Override
                        public void onFailure(Call<Map<String, Object>> call, Throwable error) {
                            if (!isAdded()) return;
                            dialog.getButton(androidx.appcompat.app.AlertDialog.BUTTON_POSITIVE).setEnabled(true);
                            Toast.makeText(requireContext(), MobileRepository.readable(error), Toast.LENGTH_LONG).show();
                        }
                    });
                }));
        dialog.show();
    }

    private void addOrderCard(Map<String, Object> order) {
        MaterialCardView card = baseCard();
        Map<String, Object> product = map(order.get("product"));
        Map<String, Object> billing = map(order.get("billing"));
        boolean paid = "PAID".equals(AppState.string(billing.get("invoiceStatus")));
        if (paid || SHIPPED.equals(section)) {
            card.setStrokeColor(ContextCompat.getColor(requireContext(), R.color.logoff_success));
        }
        LinearLayout content = cardContent();

        LinearLayout top = new LinearLayout(requireContext());
        top.setGravity(Gravity.CENTER_VERTICAL);
        if (ACTIVE.equals(section)) {
            CheckBox selection = new CheckBox(requireContext());
            selection.setContentDescription("Выбрать FBS-заказ");
            selection.setChecked(selectedOrders.containsKey(orderKey(order)));
            selection.setOnCheckedChangeListener((button, checked) -> {
                if (checked) selectedOrders.put(orderKey(order), order);
                else selectedOrders.remove(orderKey(order));
                renderOrders();
            });
            top.addView(selection, new LinearLayout.LayoutParams(dp(44), dp(44)));
        }
        String orderNumber = firstNonBlank(
                AppState.string(order.get("orderUid")),
                AppState.string(order.get("id"))
        );
        TextView number = text("Заказ " + orderNumber, 16, R.color.logoff_black, Typeface.BOLD);
        number.setMaxLines(2);
        TextView marketplace = text(marketplaceLabel(order.get("marketplace")), 12,
                R.color.logoff_red, Typeface.BOLD);
        marketplace.setGravity(Gravity.END);
        top.addView(number, new LinearLayout.LayoutParams(0, -2, 1f));
        top.addView(marketplace, new LinearLayout.LayoutParams(-2, -2));
        content.addView(top);

        String productName = firstNonBlank(
                AppState.string(product.get("name")),
                AppState.string(order.get("article")),
                "Товар не сопоставлен"
        );
        TextView productView = text(productName, 15, R.color.logoff_black, Typeface.BOLD);
        LinearLayout.LayoutParams productParams = new LinearLayout.LayoutParams(-1, -2);
        productParams.topMargin = dp(12);
        content.addView(productView, productParams);

        String article = firstNonBlank(
                AppState.string(product.get("article")),
                AppState.string(product.get("clientSku")),
                AppState.string(product.get("internalSku")),
                AppState.string(order.get("article"))
        );
        String info = (!article.isBlank() ? "Артикул: " + article + " · " : "")
                + count(order.get("itemCount")) + " ед.";
        TextView infoView = text(info, 13, R.color.logoff_text_muted, Typeface.NORMAL);
        LinearLayout.LayoutParams infoParams = new LinearLayout.LayoutParams(-1, -2);
        infoParams.topMargin = dp(5);
        content.addView(infoView, infoParams);

        List<Map<String, Object>> boxes = maps(order.get("storageBoxes"));
        if (!boxes.isEmpty()) {
            List<String> boxLabels = new ArrayList<>();
            for (Map<String, Object> box : boxes) {
                boxLabels.add(AppState.string(box.get("code")) + " · " + count(box.get("quantity")) + " ед.");
            }
            TextView boxesView = text("Короба: " + String.join(", ", boxLabels), 13,
                    R.color.logoff_blue, Typeface.BOLD);
            LinearLayout.LayoutParams boxParams = new LinearLayout.LayoutParams(-1, -2);
            boxParams.topMargin = dp(10);
            content.addView(boxesView, boxParams);
        }

        TextView status = text(
                firstNonBlank(AppState.string(order.get("statusLabel")), "Статус уточняется"),
                12,
                SHIPPED.equals(AppState.string(order.get("category")))
                        ? R.color.logoff_success : R.color.logoff_warning,
                Typeface.BOLD
        );
        LinearLayout.LayoutParams statusParams = new LinearLayout.LayoutParams(-1, -2);
        statusParams.topMargin = dp(11);
        content.addView(status, statusParams);

        addOrderDocumentActions(content, order);

        if (COST.equals(section)) addBillingBreakdown(content, billing);
        card.addView(content);
        card.setOnClickListener(view -> showOrderDetails(order));
        binding.content.addView(card, cardParams());
    }

    private void addOrderDocumentActions(LinearLayout content, Map<String, Object> order) {
        View divider = new View(requireContext());
        divider.setBackgroundColor(ContextCompat.getColor(requireContext(), R.color.logoff_border));
        LinearLayout.LayoutParams dividerParams = new LinearLayout.LayoutParams(-1, dp(1));
        dividerParams.topMargin = dp(13);
        dividerParams.bottomMargin = dp(5);
        content.addView(divider, dividerParams);

        MaterialButton sticker = outlinedButton("Скачать ШК заказа");
        boolean stickerAvailable = isEligible(order, "stickers");
        sticker.setEnabled(stickerAvailable && !orderActionRunning);
        sticker.setOnClickListener(view -> downloadOrderStickers(Collections.singletonList(order)));
        if (!stickerAvailable) {
            sticker.setContentDescription("ШК станет доступен после перевода заказа в сборку");
        }
        addActionButton(content, sticker);

        if (requiresCargoPlaces()) {
            MaterialButton cargo = outlinedButton("QR грузомест поставки");
            boolean cargoAvailable = isEligible(order, "cargo");
            cargo.setEnabled(cargoAvailable && !orderActionRunning);
            cargo.setOnClickListener(view -> downloadCargoPlaceStickers(Collections.singletonList(order)));
            if (!cargoAvailable) {
                cargo.setContentDescription("QR появится после создания поставки и грузомест");
            }
            addActionButton(content, cargo);
        } else {
            TextView noCargo = text("Без грузомест: сдача в сортировочный центр", 11,
                    R.color.logoff_text_muted, Typeface.BOLD);
            LinearLayout.LayoutParams params = new LinearLayout.LayoutParams(-1, -2);
            params.topMargin = dp(8);
            content.addView(noCargo, params);
        }
    }

    private void addBillingBreakdown(LinearLayout content, Map<String, Object> billing) {
        if (billing.isEmpty()) {
            TextView pending = text("Начисление формируется автоматически", 13,
                    R.color.logoff_warning, Typeface.BOLD);
            LinearLayout.LayoutParams params = new LinearLayout.LayoutParams(-1, -2);
            params.topMargin = dp(12);
            content.addView(pending, params);
            return;
        }
        Map<String, Object> breakdown = map(billing.get("breakdown"));
        View divider = new View(requireContext());
        divider.setBackgroundColor(ContextCompat.getColor(requireContext(), R.color.logoff_border));
        LinearLayout.LayoutParams dividerParams = new LinearLayout.LayoutParams(-1, dp(1));
        dividerParams.topMargin = dp(14);
        dividerParams.bottomMargin = dp(12);
        content.addView(divider, dividerParams);
        addPriceLine(content, "Обработка FBS", breakdown.get("fbsProcessingRub"));
        addPriceLine(content, "Дополнительные услуги", breakdown.get("additionalServicesRub"));
        addPriceLine(content, "Доставка", breakdown.get("deliveryRub"));
        addPriceLine(content, "Формирование коробов", breakdown.get("boxFormationRub"));
        addPriceLine(content, "Короба", breakdown.get("boxMaterialRub"));
        if (numberValue(breakdown.get("palletRub")) > 0) {
            String palletLabel = numberValue(breakdown.get("palletCount")) > 0
                    ? "Паллеты · " + count(breakdown.get("palletCount")) + " шт."
                    : "Паллеты";
            addPriceLine(content, palletLabel, breakdown.get("palletRub"));
        }
        addPriceLine(content, "Итого", billing.get("totalRub"), true);
        String invoice = AppState.string(billing.get("invoiceNumber"));
        if (!invoice.isBlank()) {
            TextView invoiceView = text(
                    "Счёт " + invoice + ("PAID".equals(AppState.string(billing.get("invoiceStatus")))
                            ? " · оплачен" : ""),
                    12,
                    "PAID".equals(AppState.string(billing.get("invoiceStatus")))
                            ? R.color.logoff_success : R.color.logoff_text_muted,
                    Typeface.BOLD
            );
            LinearLayout.LayoutParams params = new LinearLayout.LayoutParams(-1, -2);
            params.topMargin = dp(8);
            content.addView(invoiceView, params);
        }
    }

    private void addPriceLine(LinearLayout content, String name, Object value) {
        addPriceLine(content, name, value, false);
    }

    private void addPriceLine(LinearLayout content, String name, Object value, boolean total) {
        LinearLayout row = new LinearLayout(requireContext());
        row.setGravity(Gravity.CENTER_VERTICAL);
        TextView label = text(name, total ? 14 : 13, R.color.logoff_text_muted,
                total ? Typeface.BOLD : Typeface.NORMAL);
        TextView amount = text(money(value), total ? 16 : 13,
                total ? R.color.logoff_black : R.color.logoff_text_muted, Typeface.BOLD);
        amount.setGravity(Gravity.END);
        row.addView(label, new LinearLayout.LayoutParams(0, -2, 1f));
        row.addView(amount, new LinearLayout.LayoutParams(-2, -2));
        LinearLayout.LayoutParams params = new LinearLayout.LayoutParams(-1, -2);
        params.topMargin = dp(total ? 8 : 3);
        content.addView(row, params);
    }

    private void showOrderDetails(Map<String, Object> order) {
        Map<String, Object> product = map(order.get("product"));
        List<String> lines = new ArrayList<>();
        lines.add("Статус: " + firstNonBlank(AppState.string(order.get("statusLabel")), "не указан"));
        lines.add("Маркетплейс: " + marketplaceLabel(order.get("marketplace")));
        lines.add("Товар: " + firstNonBlank(AppState.string(product.get("name")), "не сопоставлен"));
        lines.add("Артикул: " + firstNonBlank(
                AppState.string(product.get("article")),
                AppState.string(order.get("article")),
                "не указан"
        ));
        List<String> barcodes = strings(order.get("barcodes"));
        if (!barcodes.isEmpty()) lines.add("ШК: " + String.join(", ", barcodes));
        List<Map<String, Object>> boxes = maps(order.get("storageBoxes"));
        if (!boxes.isEmpty()) {
            List<String> values = new ArrayList<>();
            for (Map<String, Object> box : boxes) values.add(
                    AppState.string(box.get("code")) + " (" + count(box.get("quantity")) + " ед.)"
            );
            lines.add("Короба: " + String.join(", ", values));
        }
        lines.add("Количество: " + count(order.get("itemCount")) + " ед.");
        new MaterialAlertDialogBuilder(requireContext())
                .setTitle("Заказ " + firstNonBlank(
                        AppState.string(order.get("orderUid")),
                        AppState.string(order.get("id"))
                ))
                .setMessage(String.join("\n\n", lines))
                .setPositiveButton("Закрыть", null)
                .show();
    }

    private void confirmAssemble(List<Map<String, Object>> orders) {
        if (orders.isEmpty()) return;
        new MaterialAlertDialogBuilder(requireContext())
                .setTitle("Перевести заказы в сборку?")
                .setMessage("Wildberries создаст поставку, добавит " + orders.size()
                        + " заказ(а/ов) и при сдаче через ПВЗ создаст грузоместа по 14 единиц.")
                .setNegativeButton("Отмена", null)
                .setPositiveButton("Собрать", (dialog, which) -> assembleOrders(orders))
                .show();
    }

    private void assembleOrders(List<Map<String, Object>> orders) {
        beginOrderAction();
        app.repository().api().assembleFbsOrders(selectionPayload(orders)).enqueue(new Callback<>() {
            @Override
            public void onResponse(Call<Map<String, Object>> call, Response<Map<String, Object>> response) {
                if (!isAdded() || binding == null) return;
                if (!response.isSuccessful() || response.body() == null) {
                    failOrderAction(readableError(response));
                    return;
                }
                Map<String, Object> result = response.body();
                int cargoPlaces = 0;
                for (Map<String, Object> supply : maps(result.get("supplies"))) {
                    cargoPlaces += (int) Math.round(numberValue(supply.get("cargoPlaceCount")));
                }
                applyOrderActionResult(result, "Заказы переведены в сборку: "
                        + count(result.get("assembled")) + ". Грузомест создано: " + cargoPlaces + ".");
            }

            @Override
            public void onFailure(Call<Map<String, Object>> call, Throwable error) {
                failOrderAction(MobileRepository.readable(error));
            }
        });
    }

    private void confirmCreateRequest(List<Map<String, Object>> orders) {
        if (orders.isEmpty()) return;
        new MaterialAlertDialogBuilder(requireContext())
                .setTitle("Создать складскую заявку?")
                .setMessage("В одну заявку войдут выбранные FBS-заказы: " + orders.size() + ".")
                .setNegativeButton("Отмена", null)
                .setPositiveButton("Создать", (dialog, which) -> createRequest(orders))
                .show();
    }

    private void createRequest(List<Map<String, Object>> orders) {
        beginOrderAction();
        app.repository().api().createFbsRequest(selectionPayload(orders)).enqueue(new Callback<>() {
            @Override
            public void onResponse(Call<Map<String, Object>> call, Response<Map<String, Object>> response) {
                if (!isAdded() || binding == null) return;
                if (!response.isSuccessful() || response.body() == null) {
                    failOrderAction(readableError(response));
                    return;
                }
                Map<String, Object> result = response.body();
                Map<String, Object> request = map(result.get("request"));
                String number = AppState.string(request.get("number"));
                applyOrderActionResult(result, "Создана заявка"
                        + (number.isBlank() ? "" : " №" + number)
                        + ": " + count(result.get("linkedOrders")) + " FBS-заказ(а/ов)." );
            }

            @Override
            public void onFailure(Call<Map<String, Object>> call, Throwable error) {
                failOrderAction(MobileRepository.readable(error));
            }
        });
    }

    private void downloadOrderStickers(List<Map<String, Object>> orders) {
        if (orders.isEmpty()) return;
        beginOrderAction();
        String suffix = orders.size() == 1
                ? AppState.string(orders.get(0).get("id"))
                : String.valueOf(orders.size()) + "_заказов";
        saveFbsPdf(
                app.repository().api().fbsOrderStickers(selectionPayload(orders)),
                "FBS_WB_ШК_" + suffix + ".pdf",
                "ШК заказов сохранены в Загрузки/LOGOff WMS"
        );
    }

    private void downloadCargoPlaceStickers(List<Map<String, Object>> orders) {
        if (orders.isEmpty()) return;
        beginOrderAction();
        String supply = orders.size() == 1
                ? AppState.string(orders.get(0).get("supplyId"))
                : String.valueOf(orders.size()) + "_заказов";
        saveFbsPdf(
                app.repository().api().fbsCargoPlaceStickers(selectionPayload(orders)),
                "FBS_WB_QR_грузомест_" + firstNonBlank(supply, "поставки") + ".pdf",
                "QR грузомест сохранены в Загрузки/LOGOff WMS"
        );
    }

    private void saveFbsPdf(Call<ResponseBody> call, String fileName, String successMessage) {
        call.enqueue(new Callback<>() {
            @Override
            public void onResponse(Call<ResponseBody> request, Response<ResponseBody> response) {
                if (!isAdded() || binding == null) return;
                if (!response.isSuccessful() || response.body() == null) {
                    failOrderAction(readableError(response));
                    return;
                }
                DocumentSaver.save(
                        requireContext().getApplicationContext(),
                        fileName,
                        response.body(),
                        new DocumentSaver.Callback() {
                            @Override public void saved(android.net.Uri uri) {
                                if (getActivity() == null) return;
                                requireActivity().runOnUiThread(() -> {
                                    finishOrderAction();
                                    if (isAdded()) Toast.makeText(requireContext(), successMessage, Toast.LENGTH_LONG).show();
                                });
                            }

                            @Override public void failed(String message) {
                                failOrderAction(message);
                            }
                        }
                );
            }

            @Override
            public void onFailure(Call<ResponseBody> request, Throwable error) {
                failOrderAction(MobileRepository.readable(error));
            }
        });
    }

    private void beginOrderAction() {
        orderActionRunning = true;
        if (binding != null && isOrderSection()) renderOrders();
    }

    private void finishOrderAction() {
        orderActionRunning = false;
        if (binding != null && isOrderSection()) renderOrders();
    }

    private void failOrderAction(String message) {
        if (getActivity() == null) return;
        requireActivity().runOnUiThread(() -> {
            if (!isAdded() || binding == null) return;
            finishOrderAction();
            Toast.makeText(requireContext(), cleanError(message), Toast.LENGTH_LONG).show();
        });
    }

    private void applyOrderActionResult(Map<String, Object> result, String message) {
        Map<String, Object> refreshed = map(result.get("orders"));
        if (!refreshed.isEmpty()) orderData = refreshed;
        selectedOrders.clear();
        orderActionRunning = false;
        renderSections();
        renderOrders();
        loadActiveClients(true);
        Toast.makeText(requireContext(), message, Toast.LENGTH_LONG).show();
    }

    private Map<String, Object> selectionPayload(List<Map<String, Object>> orders) {
        Map<String, Object> body = new LinkedHashMap<>();
        body.put("clientId", app.state().selectedClientId());
        List<Map<String, Object>> values = new ArrayList<>();
        for (Map<String, Object> order : orders) {
            Map<String, Object> value = new LinkedHashMap<>();
            value.put("connectionId", AppState.string(order.get("connectionId")));
            value.put("id", AppState.string(order.get("id")));
            values.add(value);
        }
        body.put("orders", values);
        return body;
    }

    private List<Map<String, Object>> filterOrders(List<Map<String, Object>> orders, String action) {
        List<Map<String, Object>> result = new ArrayList<>();
        for (Map<String, Object> order : orders) {
            if (isEligible(order, action)) result.add(order);
        }
        return result;
    }

    private boolean isEligible(Map<String, Object> order, String action) {
        boolean wildberries = "WILDBERRIES".equals(AppState.string(order.get("marketplace")));
        String supplierStatus = AppState.string(order.get("supplierStatus"));
        if ("assemble".equals(action)) return wildberries && "new".equals(supplierStatus);
        if ("stickers".equals(action)) {
            return wildberries && ("confirm".equals(supplierStatus) || "complete".equals(supplierStatus));
        }
        if ("cargo".equals(action)) {
            return requiresCargoPlaces() && wildberries && "confirm".equals(supplierStatus)
                    && !AppState.string(order.get("supplyId")).isBlank();
        }
        if ("request".equals(action)) {
            Map<String, Object> request = map(order.get("request"));
            return ACTIVE.equals(AppState.string(order.get("category")))
                    && (request.isEmpty() || "CANCELLED".equals(AppState.string(request.get("status"))));
        }
        return false;
    }

    private boolean requiresCargoPlaces() {
        return Boolean.TRUE.equals(map(orderData.get("deliveryPlan")).get("requiresCargoPlaces"));
    }

    private String orderKey(Map<String, Object> order) {
        return AppState.string(order.get("connectionId")) + ":" + AppState.string(order.get("id"));
    }

    private void pruneSelectedOrders() {
        Map<String, Map<String, Object>> fresh = new LinkedHashMap<>();
        for (Map<String, Object> order : maps(orderData.get("orders"))) {
            fresh.put(orderKey(order), order);
        }
        List<String> stale = new ArrayList<>();
        for (String key : selectedOrders.keySet()) {
            Map<String, Object> current = fresh.get(key);
            if (current == null) stale.add(key);
            else selectedOrders.put(key, current);
        }
        for (String key : stale) selectedOrders.remove(key);
    }

    private void renderCalculator() {
        if (binding == null || !CALCULATOR.equals(section)) return;
        binding.content.removeAllViews();
        binding.empty.setVisibility(View.GONE);
        binding.heroTitle.setText("Калькулятор FBS");
        binding.heroSubtitle.setText(canManagePricing()
                ? "Расчёт по городам и тарифам логистики WMS"
                : "Предварительная стоимость с налогом");

        if (loadingCalculator && calculatorDestinations.isEmpty()) return;
        if (calculatorDestinations.isEmpty()) {
            showEmpty("Для калькулятора пока нет доступных городов.");
            return;
        }

        calculatorForm = new CalculatorForm();
        MaterialCardView card = pricingCard("₽", "Рассчитайте партию FBS",
                canManagePricing()
                        ? "Выберите тариф и город. Приложение покажет услуги, логистику и налог."
                        : "Выберите город и количество товаров. Будет показана только итоговая стоимость с налогом.");
        LinearLayout body = (LinearLayout) card.getChildAt(0);
        calculatorForm.quantity = addLabeledField(body, "Количество товаров, ед.", "", true);
        calculatorForm.quantity.setHint("От 1 до 3000");

        if (canManagePricing()) {
            calculatorForm.tariffIds = new ArrayList<>();
            List<String> tariffLabels = new ArrayList<>();
            for (Map<String, Object> tariff : calculatorTariffSets) {
                calculatorForm.tariffIds.add(AppState.string(tariff.get("id")));
                tariffLabels.add(firstNonBlank(AppState.string(tariff.get("name")), "Тариф WMS"));
            }
            body.addView(sectionLabel("Набор тарифов логистики"));
            calculatorForm.tariff = spinner(tariffLabels);
            calculatorForm.tariff.setSelection(indexOf(calculatorForm.tariffIds, calculatorTariffId));
            body.addView(calculatorForm.tariff, fieldParams());
        }

        body.addView(sectionLabel("Город доставки"));
        calculatorForm.destinations = new ArrayList<>(calculatorDestinations);
        calculatorForm.destination = spinner(calculatorForm.destinations);
        body.addView(calculatorForm.destination, fieldParams());

        MaterialButton calculate = primaryButton("Рассчитать стоимость");
        calculatorForm.calculate = calculate;
        LinearLayout.LayoutParams buttonParams = new LinearLayout.LayoutParams(-1, dp(54));
        buttonParams.topMargin = dp(17);
        body.addView(calculate, buttonParams);

        calculatorForm.result = new LinearLayout(requireContext());
        calculatorForm.result.setOrientation(LinearLayout.VERTICAL);
        LinearLayout.LayoutParams resultParams = new LinearLayout.LayoutParams(-1, -2);
        resultParams.topMargin = dp(16);
        body.addView(calculatorForm.result, resultParams);
        binding.content.addView(card, cardParams());

        calculate.setOnClickListener(view -> calculateFbs());
        if (calculatorForm.tariff != null) {
            calculatorForm.tariff.setOnItemSelectedListener(new SimpleItemSelectedListener(position -> {
                if (calculatorForm == null || position < 0
                        || position >= calculatorForm.tariffIds.size()) return;
                String selectedId = calculatorForm.tariffIds.get(position);
                if (!selectedId.equals(calculatorTariffId)) loadCalculatorTariff(selectedId);
            }));
        }
    }

    private void calculateFbs() {
        if (calculatorForm == null) return;
        String quantityText = AppState.string(calculatorForm.quantity.getText()).trim();
        int quantity;
        try {
            quantity = Integer.parseInt(quantityText);
        } catch (NumberFormatException ignored) {
            calculatorForm.quantity.setError("Введите целое количество от 1 до 3000");
            return;
        }
        if (quantity < 1 || quantity > CALCULATOR_MAX_QUANTITY) {
            calculatorForm.quantity.setError("Введите целое количество от 1 до 3000");
            return;
        }
        int destinationIndex = calculatorForm.destination.getSelectedItemPosition();
        if (destinationIndex < 0 || destinationIndex >= calculatorForm.destinations.size()) {
            Toast.makeText(requireContext(), "Выберите город доставки", Toast.LENGTH_LONG).show();
            return;
        }
        String destination = calculatorForm.destinations.get(destinationIndex);
        calculatorForm.calculate.setEnabled(false);
        calculatorForm.calculate.setText("Рассчитываю…");
        calculatorForm.result.removeAllViews();

        if (!canManagePricing()) {
            Map<String, Object> body = new LinkedHashMap<>();
            body.put("quantity", quantity);
            body.put("destination", destination);
            app.repository().api().fbsCalculatorQuote(body).enqueue(new Callback<>() {
                @Override
                public void onResponse(Call<Map<String, Object>> call, Response<Map<String, Object>> response) {
                    finishCalculatorLoading();
                    if (!isAdded() || binding == null || calculatorForm == null) return;
                    if (response.isSuccessful() && response.body() != null) {
                        Map<String, Object> quote = response.body();
                        if (Boolean.TRUE.equals(quote.get("requiresManualReview"))
                                || quote.get("totalWithTax") == null) {
                            showCalculatorError("Для выбранного города стоимость требует ручного расчёта.");
                            return;
                        }
                        renderClientCalculatorResult(
                                firstNonBlank(AppState.string(quote.get("destination")), destination),
                                numberValue(quote.get("totalWithTax"))
                        );
                    } else {
                        showCalculatorError(readableError(response));
                    }
                }

                @Override
                public void onFailure(Call<Map<String, Object>> call, Throwable error) {
                    finishCalculatorLoading();
                    showCalculatorError(MobileRepository.readable(error));
                }
            });
            return;
        }

        CalculatorCosts costs = calculatorCosts(quantity);
        Double specialDelivery = specialDeliveryPrice(quantity, destination, costs.boxes);
        if (specialDelivery != null) {
            finishCalculatorLoading();
            renderAdminCalculatorResult(quantity, destination, "Специальный тариф FBS",
                    costs, specialDelivery, quantity > 1000
                            ? (int) Math.ceil(costs.boxes / (double) CALCULATOR_BOXES_PER_PALLET) : 0);
            return;
        }
        Map<String, Object> body = new LinkedHashMap<>();
        body.put("tariffSetId", calculatorTariffId);
        body.put("destination", destination);
        body.put("boxes", costs.boxes);
        app.repository().api().logisticsQuote(body).enqueue(new Callback<>() {
            @Override
            public void onResponse(Call<Map<String, Object>> call, Response<Map<String, Object>> response) {
                finishCalculatorLoading();
                if (!isAdded() || binding == null || calculatorForm == null) return;
                if (!response.isSuccessful() || response.body() == null) {
                    showCalculatorError(readableError(response));
                    return;
                }
                Map<String, Object> quote = response.body();
                if (Boolean.TRUE.equals(quote.get("requiresManualReview"))
                        || quote.get("estimatedTotalRub") == null) {
                    showCalculatorError("Для выбранного города тариф требует ручного расчёта логистики.");
                    return;
                }
                Map<String, Object> route = map(quote.get("route"));
                Map<String, Object> tariffSet = map(quote.get("tariffSet"));
                Map<String, Object> input = map(quote.get("input"));
                renderAdminCalculatorResult(
                        quantity,
                        firstNonBlank(AppState.string(route.get("destination")), destination),
                        firstNonBlank(AppState.string(tariffSet.get("name")), "Тариф WMS"),
                        costs,
                        numberValue(quote.get("estimatedTotalRub")),
                        (int) Math.round(numberValue(input.get("pallets")))
                );
            }

            @Override
            public void onFailure(Call<Map<String, Object>> call, Throwable error) {
                finishCalculatorLoading();
                showCalculatorError(MobileRepository.readable(error));
            }
        });
    }

    private void renderClientCalculatorResult(String destination, double totalWithTax) {
        if (calculatorForm == null) return;
        LinearLayout result = calculatorForm.result;
        result.removeAllViews();
        result.setPadding(dp(16), dp(15), dp(16), dp(15));
        result.setBackgroundResource(R.drawable.status_background_success);
        result.addView(text(destination, 13, R.color.logoff_success, Typeface.BOLD));
        TextView label = text("Стоимость с налогом", 13, R.color.logoff_text_muted, Typeface.NORMAL);
        LinearLayout.LayoutParams labelParams = new LinearLayout.LayoutParams(-1, -2);
        labelParams.topMargin = dp(6);
        result.addView(label, labelParams);
        TextView total = text(money(totalWithTax), 27, R.color.logoff_black, Typeface.BOLD);
        LinearLayout.LayoutParams totalParams = new LinearLayout.LayoutParams(-1, -2);
        totalParams.topMargin = dp(3);
        result.addView(total, totalParams);
    }

    private void renderAdminCalculatorResult(
            int quantity,
            String destination,
            String tariffName,
            CalculatorCosts costs,
            double delivery,
            int pallets
    ) {
        if (calculatorForm == null) return;
        LinearLayout result = calculatorForm.result;
        result.removeAllViews();
        result.setPadding(dp(16), dp(15), dp(16), dp(15));
        result.setBackgroundResource(R.drawable.bg_empty_state);
        result.addView(text(destination, 18, R.color.logoff_black, Typeface.BOLD));
        TextView tariff = text(tariffName + " · " + quantity + " ед. · " + costs.boxes + " кор."
                        + (pallets > 0 ? " · " + pallets + " пал." : ""),
                12, R.color.logoff_text_muted, Typeface.NORMAL);
        LinearLayout.LayoutParams tariffParams = new LinearLayout.LayoutParams(-1, -2);
        tariffParams.topMargin = dp(4);
        tariffParams.bottomMargin = dp(8);
        result.addView(tariff, tariffParams);
        addPriceLine(result, "Обработка", costs.processing);
        addPriceLine(result, "Стикеры", costs.stickers);
        addPriceLine(result, "Короба", costs.boxMaterials);
        addPriceLine(result, "Формирование коробов", costs.boxAssembly);
        addPriceLine(result, "Услуги с наценкой 50%", costs.servicesWithMarkup);
        addPriceLine(result, "Логистика без налога", delivery);
        double deliveryWithTax = addCalculatorTax(delivery);
        addPriceLine(result, "Налог на логистику", deliveryWithTax - delivery);
        addPriceLine(result, "Итого с налогом",
                addCalculatorTax(costs.servicesWithMarkup + delivery), true);
    }

    private void finishCalculatorLoading() {
        if (!isAdded() || calculatorForm == null) return;
        calculatorForm.calculate.setEnabled(true);
        calculatorForm.calculate.setText("Рассчитать стоимость");
    }

    private void showCalculatorError(String message) {
        if (!isAdded() || calculatorForm == null) return;
        calculatorForm.result.removeAllViews();
        calculatorForm.result.setPadding(dp(14), dp(12), dp(14), dp(12));
        calculatorForm.result.setBackgroundResource(R.drawable.bg_empty_state);
        calculatorForm.result.addView(text(cleanError(message), 13, R.color.logoff_red, Typeface.BOLD));
    }

    private CalculatorCosts calculatorCosts(int quantity) {
        int boxes = (int) Math.ceil(quantity / (double) CALCULATOR_ITEMS_PER_BOX);
        double processing = quantity * 10d;
        double stickers = quantity * 3d;
        double boxMaterials = boxes * 100d;
        double boxAssembly = boxes * 40d;
        return new CalculatorCosts(boxes, processing, stickers, boxMaterials, boxAssembly,
                (processing + stickers + boxMaterials + boxAssembly) * 1.5d);
    }

    private Double specialDeliveryPrice(int quantity, String destination, int boxes) {
        String normalized = normalizePoint(destination).replace('ё', 'е');
        boolean vnukovo = normalized.contains("внуково");
        boolean kavkaz = normalized.contains("кавказ");
        if (!vnukovo && !kavkaz) return null;
        if (quantity <= 1000) return vnukovo ? 1500d : 3000d;
        int pallets = (int) Math.ceil(boxes / (double) CALCULATOR_BOXES_PER_PALLET);
        if (vnukovo) return pallets * (pallets <= 2 ? 1500d : 1200d);
        double perPallet = pallets == 1 ? 3500d
                : pallets == 2 ? 3000d
                : pallets == 3 ? 2800d
                : pallets == 4 ? 2500d
                : pallets == 5 ? 2300d
                : pallets == 6 ? 2200d : 2000d;
        return pallets * perPallet;
    }

    private double addCalculatorTax(double value) {
        return value / 94d * 100d;
    }

    private List<String> buildCalculatorDestinations(Map<String, Object> tariff) {
        List<Map<String, Object>> directions = maps(tariff.get("directions"));
        List<Map<String, Object>> source = new ArrayList<>();
        for (Map<String, Object> direction : directions) {
            String origin = normalizePoint(AppState.string(direction.get("origin")));
            if ("москва".equals(origin) || "moscow".equals(origin)) source.add(direction);
        }
        if (source.isEmpty()) source = directions;
        Map<String, String> unique = new LinkedHashMap<>();
        for (Map<String, Object> direction : source) {
            String city = AppState.string(direction.get("destination")).trim();
            if (!city.isBlank()) unique.put(normalizePoint(city), city);
        }
        unique.put(normalizePoint("Внуково"), "Внуково");
        unique.put(normalizePoint("Кавказский Бульвар"), "Кавказский Бульвар");
        List<String> result = new ArrayList<>(unique.values());
        result.sort(String::compareToIgnoreCase);
        return result;
    }

    private String normalizePoint(String value) {
        return value.toLowerCase(new Locale("ru", "RU"))
                .replaceAll("\\s*,\\s*", ", ")
                .replaceAll("\\s+", " ")
                .trim();
    }

    private void renderPricing() {
        if (binding == null || !PRICING.equals(section)) return;
        binding.content.removeAllViews();
        binding.empty.setVisibility(View.GONE);
        binding.heroTitle.setText("Стоимость обработки FBS");
        Map<String, Object> client = map(settingsData.get("client"));
        binding.heroSubtitle.setText(joinNonBlank(
                AppState.string(client.get("code")),
                AppState.string(client.get("name"))
        ));
        if (settingsData.isEmpty()) {
            if (!loadingSettings) showEmpty("Настройки пока не загружены.");
            return;
        }

        Map<String, Object> settings = map(settingsData.get("settings"));
        List<Map<String, Object>> services = activeServices(settingsData.get("serviceOptions"));
        pricingForm = new PricingForm();

        addPricingIntro(client);
        addProcessingSection(settings, services);
        addDeliverySection(settings);
        addBoxesSection(settings, services);
        addPalletSection(settings, services);
        addPreviewSection(services);

        TextView excluded = text(
                firstNonBlank(AppState.string(settingsData.get("excludedRule")), "Паллеты в FBS не начисляются."),
                12,
                R.color.logoff_text_muted,
                Typeface.NORMAL
        );
        LinearLayout.LayoutParams excludedParams = new LinearLayout.LayoutParams(-1, -2);
        excludedParams.topMargin = dp(8);
        binding.content.addView(excluded, excludedParams);

        MaterialButton save = primaryButton("Сохранить стоимость обработки");
        LinearLayout.LayoutParams saveParams = new LinearLayout.LayoutParams(-1, dp(56));
        saveParams.topMargin = dp(16);
        binding.content.addView(save, saveParams);
        save.setOnClickListener(view -> saveSettings(save, services));
        attachPreviewListeners();
        updatePreview(services);
    }

    private void addPricingIntro(Map<String, Object> client) {
        MaterialCardView card = baseCard();
        card.setCardBackgroundColor(ContextCompat.getColor(requireContext(), R.color.logoff_blue_soft));
        LinearLayout content = cardContent();
        content.addView(text(
                joinNonBlank(AppState.string(client.get("code")), AppState.string(client.get("name"))),
                17,
                R.color.logoff_black,
                Typeface.BOLD
        ));
        TextView note = text(
                "Настройки применяются к новым и ещё не выставленным начислениям. Паллеты можно включить отдельно.",
                13,
                R.color.logoff_text_muted,
                Typeface.NORMAL
        );
        LinearLayout.LayoutParams params = new LinearLayout.LayoutParams(-1, -2);
        params.topMargin = dp(6);
        content.addView(note, params);
        card.addView(content);
        binding.content.addView(card, cardParams());
    }

    private void addProcessingSection(Map<String, Object> settings, List<Map<String, Object>> services) {
        MaterialCardView card = pricingCard("01", "Обработка каждой единицы",
                "Базовая цена FBS и дополнительные услуги клиента.");
        LinearLayout body = (LinearLayout) card.getChildAt(0);
        pricingForm.processing = addLabeledField(body, "Обработка FBS за единицу, ₽",
                decimal(settings.get("fbsProcessingPriceRub")), false);

        List<Map<String, Object>> selections = maps(settings.get("additionalServices"));
        String formationId = AppState.string(settings.get("boxFormationServiceId"));
        String materialId = AppState.string(settings.get("boxMaterialServiceId"));
        body.addView(sectionLabel("Дополнительные услуги клиента"));
        for (Map<String, Object> service : services) {
            String id = AppState.string(service.get("id"));
            String code = AppState.string(service.get("code"));
            if (id.equals(formationId) || id.equals(materialId)
                    || Boolean.TRUE.equals(service.get("isPallet"))
                    || "BOX_ASSEMBLY".equals(code) || "BOX_60_40_40".equals(code)) continue;
            Map<String, Object> selected = findById(selections, "serviceId", id);
            addAdditionalService(body, service, selected);
        }
        binding.content.addView(card, cardParams());
    }

    private void addDeliverySection(Map<String, Object> settings) {
        MaterialCardView card = pricingCard("02", "Доставка партии FBS",
                "Базовый выезд включает заданное количество единиц, затем цена растёт блоками.");
        LinearLayout body = (LinearLayout) card.getChildAt(0);
        body.addView(sectionLabel("Маршрут по умолчанию"));
        pricingForm.route = spinner(Arrays.asList("Ближайший ПВЗ", "СЦ Внуково"));
        pricingForm.route.setSelection("VNUKOVO_SORTING_CENTER".equals(
                AppState.string(settings.get("defaultDeliveryDestination"))) ? 1 : 0);
        body.addView(pricingForm.route, fieldParams());
        pricingForm.pickupPrice = addLabeledField(body, "Базовый выезд на ПВЗ, ₽",
                decimal(settings.get("pickupPointBasePriceRub")), false);
        pricingForm.vnukovoPrice = addLabeledField(body, "Базовый выезд в СЦ Внуково, ₽",
                decimal(settings.get("vnukovoBasePriceRub")), false);
        pricingForm.baseItems = addLabeledField(body, "Единиц входит в базовый выезд",
                integerText(settings.get("baseIncludedItems")), true);
        pricingForm.blockItems = addLabeledField(body, "Размер следующего блока, ед.",
                integerText(settings.get("extraBlockItems")), true);
        pricingForm.blockPrice = addLabeledField(body, "Доплата за каждый блок, ₽",
                decimal(settings.get("extraBlockPriceRub")), false);
        binding.content.addView(card, cardParams());
    }

    private void addBoxesSection(Map<String, Object> settings, List<Map<String, Object>> services) {
        MaterialCardView card = pricingCard("03", "Формирование и стоимость коробов",
                "Количество коробов считается автоматически по средней вместимости.");
        LinearLayout body = (LinearLayout) card.getChildAt(0);
        pricingForm.capacity = addLabeledField(body, "Средняя вместимость короба, ед.",
                integerText(settings.get("boxCapacityItems")), true);

        List<String> serviceLabels = new ArrayList<>();
        pricingForm.serviceIds = new ArrayList<>();
        serviceLabels.add("Не начислять");
        pricingForm.serviceIds.add("");
        for (Map<String, Object> service : services) {
            if (Boolean.TRUE.equals(service.get("isPallet"))) continue;
            serviceLabels.add(AppState.string(service.get("name")) + " · " + money(service.get("priceRub")));
            pricingForm.serviceIds.add(AppState.string(service.get("id")));
        }

        body.addView(sectionLabel("Услуга формирования короба"));
        pricingForm.formation = spinner(serviceLabels);
        pricingForm.formation.setSelection(indexOf(pricingForm.serviceIds,
                AppState.string(settings.get("boxFormationServiceId"))));
        body.addView(pricingForm.formation, fieldParams());

        body.addView(sectionLabel("Стоимость самого короба"));
        pricingForm.material = spinner(serviceLabels);
        pricingForm.material.setSelection(indexOf(pricingForm.serviceIds,
                AppState.string(settings.get("boxMaterialServiceId"))));
        body.addView(pricingForm.material, fieldParams());
        binding.content.addView(card, cardParams());
    }

    private void addPalletSection(Map<String, Object> settings, List<Map<String, Object>> services) {
        MaterialCardView card = pricingCard("04", "Паллеты FBS",
                "При включении паллеты начисляются по количеству сформированных коробов.");
        LinearLayout body = (LinearLayout) card.getChildAt(0);
        pricingForm.palletsEnabled = new CheckBox(requireContext());
        pricingForm.palletsEnabled.setText("Начислять паллеты в FBS");
        pricingForm.palletsEnabled.setTextColor(ContextCompat.getColor(requireContext(), R.color.logoff_black));
        pricingForm.palletsEnabled.setTextSize(14);
        pricingForm.palletsEnabled.setChecked(Boolean.TRUE.equals(settings.get("palletsEnabled")));
        LinearLayout.LayoutParams checkParams = new LinearLayout.LayoutParams(-1, -2);
        checkParams.topMargin = dp(12);
        body.addView(pricingForm.palletsEnabled, checkParams);
        pricingForm.boxesPerPallet = addLabeledField(body, "Коробов на одной паллете",
                integerText(settings.get("boxesPerPallet")), true);

        List<String> palletLabels = new ArrayList<>();
        pricingForm.palletServiceIds = new ArrayList<>();
        palletLabels.add("Выберите паллетную услугу");
        pricingForm.palletServiceIds.add("");
        for (Map<String, Object> service : services) {
            if (!Boolean.TRUE.equals(service.get("isPallet"))) continue;
            palletLabels.add(AppState.string(service.get("name")) + " · " + money(service.get("priceRub")));
            pricingForm.palletServiceIds.add(AppState.string(service.get("id")));
        }
        body.addView(sectionLabel("Паллетная услуга"));
        pricingForm.palletService = spinner(palletLabels);
        pricingForm.palletService.setSelection(indexOf(pricingForm.palletServiceIds,
                AppState.string(settings.get("palletServiceId"))));
        body.addView(pricingForm.palletService, fieldParams());
        pricingForm.palletsEnabled.setOnCheckedChangeListener((button, checked) -> {
            pricingForm.boxesPerPallet.setEnabled(checked);
            pricingForm.palletService.setEnabled(checked);
            updatePreview(pricingForm.services);
        });
        pricingForm.boxesPerPallet.setEnabled(pricingForm.palletsEnabled.isChecked());
        pricingForm.palletService.setEnabled(pricingForm.palletsEnabled.isChecked());
        binding.content.addView(card, cardParams());
    }

    private void addAdditionalService(
            LinearLayout body,
            Map<String, Object> service,
            Map<String, Object> selected
    ) {
        MaterialCardView card = new MaterialCardView(requireContext());
        card.setCardBackgroundColor(ContextCompat.getColor(requireContext(), R.color.logoff_surface));
        card.setRadius(dp(16));
        card.setCardElevation(0);
        card.setStrokeWidth(dp(1));
        card.setStrokeColor(ContextCompat.getColor(requireContext(), R.color.logoff_border));

        LinearLayout row = new LinearLayout(requireContext());
        row.setGravity(Gravity.CENTER_VERTICAL);
        row.setPadding(dp(12), dp(10), dp(10), dp(10));
        CheckBox check = new CheckBox(requireContext());
        check.setChecked(!selected.isEmpty());
        check.setText(AppState.string(service.get("name")) + "\n" + money(service.get("priceRub")) + " за ед.");
        check.setTextColor(ContextCompat.getColor(requireContext(), R.color.logoff_black));
        check.setTextSize(13);
        EditText multiplier = field("", selected.isEmpty() ? "1" : decimal(selected.get("quantityMultiplier")),
                InputType.TYPE_CLASS_NUMBER | InputType.TYPE_NUMBER_FLAG_DECIMAL);
        multiplier.setGravity(Gravity.CENTER);
        multiplier.setVisibility(check.isChecked() ? View.VISIBLE : View.GONE);
        check.setOnCheckedChangeListener((button, checked) -> {
            multiplier.setVisibility(checked ? View.VISIBLE : View.GONE);
            if (pricingForm != null) updatePreview(pricingForm.services);
        });
        row.addView(check, new LinearLayout.LayoutParams(0, -2, 1f));
        row.addView(multiplier, new LinearLayout.LayoutParams(dp(72), dp(50)));
        card.addView(row);
        LinearLayout.LayoutParams params = new LinearLayout.LayoutParams(-1, -2);
        params.topMargin = dp(7);
        body.addView(card, params);
        pricingForm.additional.put(AppState.string(service.get("id")),
                new AdditionalSelection(check, multiplier));
    }

    private void addPreviewSection(List<Map<String, Object>> services) {
        pricingForm.services = services;
        MaterialCardView card = pricingCard("₽", "Предварительный расчёт",
                "Пример начисления партии при текущих параметрах.");
        pricingForm.preview = (LinearLayout) card.getChildAt(0);
        binding.content.addView(card, cardParams());
    }

    private void attachPreviewListeners() {
        if (pricingForm == null) return;
        TextWatcher watcher = new TextWatcher() {
            @Override public void beforeTextChanged(CharSequence value, int start, int count, int after) {}
            @Override public void onTextChanged(CharSequence value, int start, int before, int count) {
                if (pricingForm != null) updatePreview(pricingForm.services);
            }
            @Override public void afterTextChanged(Editable value) {}
        };
        for (EditText field : Arrays.asList(
                pricingForm.processing,
                pricingForm.pickupPrice,
                pricingForm.vnukovoPrice,
                pricingForm.baseItems,
                pricingForm.blockItems,
                pricingForm.blockPrice,
                pricingForm.capacity,
                pricingForm.boxesPerPallet
        )) field.addTextChangedListener(watcher);
        for (AdditionalSelection selection : pricingForm.additional.values()) {
            selection.multiplier.addTextChangedListener(watcher);
        }
        pricingForm.route.setOnItemSelectedListener(new SimpleItemSelectedListener(
                position -> updatePreview(pricingForm.services)));
        pricingForm.formation.setOnItemSelectedListener(new SimpleItemSelectedListener(
                position -> updatePreview(pricingForm.services)));
        pricingForm.material.setOnItemSelectedListener(new SimpleItemSelectedListener(
                position -> updatePreview(pricingForm.services)));
        pricingForm.palletService.setOnItemSelectedListener(new SimpleItemSelectedListener(
                position -> updatePreview(pricingForm.services)));
    }

    private void updatePreview(List<Map<String, Object>> services) {
        if (pricingForm == null || pricingForm.preview == null) return;
        LinearLayout preview = pricingForm.preview;
        while (preview.getChildCount() > 1) preview.removeViewAt(1);
        int capacity = positiveInt(pricingForm.capacity, 16);
        List<Integer> amounts = new ArrayList<>(Arrays.asList(5, 10));
        if (!amounts.contains(capacity)) amounts.add(capacity);
        for (int items : amounts) {
            double processing = nonNegative(pricingForm.processing)
                    + additionalUnitPrice(services);
            int baseItems = positiveInt(pricingForm.baseItems, 5);
            int blockItems = positiveInt(pricingForm.blockItems, 5);
            int extraBlocks = (int) Math.ceil(Math.max(0, items - baseItems) / (double) blockItems);
            double delivery = (pricingForm.route.getSelectedItemPosition() == 1
                    ? nonNegative(pricingForm.vnukovoPrice)
                    : nonNegative(pricingForm.pickupPrice))
                    + extraBlocks * nonNegative(pricingForm.blockPrice);
            int boxes = (int) Math.ceil(items / (double) Math.max(1, capacity));
            double boxPrice = servicePrice(services, selectedServiceId(pricingForm.formation))
                    + servicePrice(services, selectedServiceId(pricingForm.material));
            int pallets = pricingForm.palletsEnabled.isChecked()
                    ? (int) Math.ceil(boxes / (double) positiveInt(pricingForm.boxesPerPallet, 16)) : 0;
            double palletPrice = servicePrice(services, selectedPalletServiceId());
            double total = processing * items + delivery + boxes * boxPrice + pallets * palletPrice;

            LinearLayout row = new LinearLayout(requireContext());
            row.setGravity(Gravity.CENTER_VERTICAL);
            row.setPadding(0, dp(8), 0, 0);
            TextView description = text(items + " ед. · " + boxes + " кор."
                            + (pallets > 0 ? " · " + pallets + " пал." : ""), 13,
                    R.color.logoff_text_muted, Typeface.NORMAL);
            TextView totalView = text(money(total), 15, R.color.logoff_black, Typeface.BOLD);
            totalView.setGravity(Gravity.END);
            row.addView(description, new LinearLayout.LayoutParams(0, -2, 1f));
            row.addView(totalView, new LinearLayout.LayoutParams(-2, -2));
            preview.addView(row);
        }
    }

    private void saveSettings(MaterialButton save, List<Map<String, Object>> services) {
        if (pricingForm == null) return;
        String formationId = selectedServiceId(pricingForm.formation);
        String materialId = selectedServiceId(pricingForm.material);
        String palletServiceId = selectedPalletServiceId();
        if (pricingForm.palletsEnabled.isChecked() && palletServiceId.isBlank()) {
            Toast.makeText(requireContext(), "Выберите паллетную услугу", Toast.LENGTH_LONG).show();
            return;
        }
        List<Map<String, Object>> additional = new ArrayList<>();
        for (Map.Entry<String, AdditionalSelection> entry : pricingForm.additional.entrySet()) {
            if (!entry.getValue().check.isChecked()) continue;
            if (entry.getKey().equals(formationId) || entry.getKey().equals(materialId)
                    || entry.getKey().equals(palletServiceId)) continue;
            Map<String, Object> selection = new LinkedHashMap<>();
            selection.put("serviceId", entry.getKey());
            selection.put("quantityMultiplier", positiveDouble(entry.getValue().multiplier, 1));
            additional.add(selection);
        }

        Map<String, Object> body = new LinkedHashMap<>();
        body.put("defaultDeliveryDestination",
                pricingForm.route.getSelectedItemPosition() == 1
                        ? "VNUKOVO_SORTING_CENTER" : "PICKUP_POINT");
        body.put("pickupPointBasePriceRub", nonNegative(pricingForm.pickupPrice));
        body.put("vnukovoBasePriceRub", nonNegative(pricingForm.vnukovoPrice));
        body.put("baseIncludedItems", positiveInt(pricingForm.baseItems, 1));
        body.put("extraBlockItems", positiveInt(pricingForm.blockItems, 1));
        body.put("extraBlockPriceRub", nonNegative(pricingForm.blockPrice));
        body.put("boxCapacityItems", positiveInt(pricingForm.capacity, 1));
        body.put("fbsProcessingPriceRub", nonNegative(pricingForm.processing));
        body.put("boxFormationServiceId", formationId.isBlank() ? null : formationId);
        body.put("boxMaterialServiceId", materialId.isBlank() ? null : materialId);
        body.put("palletsEnabled", pricingForm.palletsEnabled.isChecked());
        body.put("boxesPerPallet", positiveInt(pricingForm.boxesPerPallet, 16));
        body.put("palletServiceId", palletServiceId.isBlank() ? null : palletServiceId);
        body.put("additionalServices", additional);

        save.setEnabled(false);
        save.setText("Сохраняю…");
        app.repository().api().updateFbsBillingSettings(
                app.state().selectedClientId(),
                body
        ).enqueue(new Callback<>() {
            @Override
            public void onResponse(Call<Map<String, Object>> call, Response<Map<String, Object>> response) {
                if (!isAdded() || binding == null) return;
                save.setEnabled(true);
                save.setText("Сохранить стоимость обработки");
                if (response.isSuccessful() && response.body() != null) {
                    settingsData = response.body();
                    Toast.makeText(requireContext(),
                            "Стоимость FBS сохранена. Черновые начисления будут пересчитаны.",
                            Toast.LENGTH_LONG).show();
                    renderPricing();
                    loadOrders(true);
                } else {
                    Toast.makeText(requireContext(), readableError(response), Toast.LENGTH_LONG).show();
                }
            }

            @Override
            public void onFailure(Call<Map<String, Object>> call, Throwable error) {
                if (!isAdded() || binding == null) return;
                save.setEnabled(true);
                save.setText("Сохранить стоимость обработки");
                Toast.makeText(requireContext(), MobileRepository.readable(error), Toast.LENGTH_LONG).show();
            }
        });
    }

    private MaterialCardView pricingCard(String marker, String title, String description) {
        MaterialCardView card = baseCard();
        LinearLayout content = cardContent();
        LinearLayout header = new LinearLayout(requireContext());
        header.setGravity(Gravity.TOP);
        TextView index = text(marker, 13, R.color.logoff_red, Typeface.BOLD);
        index.setGravity(Gravity.CENTER);
        index.setBackgroundColor(ContextCompat.getColor(requireContext(), R.color.logoff_red_soft));
        LinearLayout labels = new LinearLayout(requireContext());
        labels.setOrientation(LinearLayout.VERTICAL);
        labels.addView(text(title, 17, R.color.logoff_black, Typeface.BOLD));
        TextView note = text(description, 12, R.color.logoff_text_muted, Typeface.NORMAL);
        LinearLayout.LayoutParams noteParams = new LinearLayout.LayoutParams(-1, -2);
        noteParams.topMargin = dp(4);
        labels.addView(note, noteParams);
        header.addView(index, new LinearLayout.LayoutParams(dp(38), dp(38)));
        LinearLayout.LayoutParams labelParams = new LinearLayout.LayoutParams(0, -2, 1f);
        labelParams.leftMargin = dp(12);
        header.addView(labels, labelParams);
        content.addView(header);
        card.addView(content);
        return card;
    }

    private EditText addLabeledField(
            LinearLayout parent,
            String label,
            String value,
            boolean integer
    ) {
        parent.addView(sectionLabel(label));
        EditText input = field("", value, integer
                ? InputType.TYPE_CLASS_NUMBER
                : InputType.TYPE_CLASS_NUMBER | InputType.TYPE_NUMBER_FLAG_DECIMAL);
        parent.addView(input, fieldParams());
        return input;
    }

    private TextView sectionLabel(String value) {
        TextView label = text(value, 12, R.color.logoff_text_muted, Typeface.BOLD);
        LinearLayout.LayoutParams params = new LinearLayout.LayoutParams(-1, -2);
        params.topMargin = dp(15);
        label.setLayoutParams(params);
        return label;
    }

    private MaterialCardView baseCard() {
        MaterialCardView card = new MaterialCardView(requireContext());
        card.setCardBackgroundColor(ContextCompat.getColor(requireContext(), R.color.logoff_card));
        card.setRadius(dp(20));
        card.setCardElevation(0);
        card.setStrokeWidth(dp(1));
        card.setStrokeColor(ContextCompat.getColor(requireContext(), R.color.logoff_border));
        return card;
    }

    private LinearLayout cardContent() {
        LinearLayout content = new LinearLayout(requireContext());
        content.setOrientation(LinearLayout.VERTICAL);
        content.setPadding(dp(18), dp(17), dp(18), dp(17));
        return content;
    }

    private LinearLayout.LayoutParams cardParams() {
        LinearLayout.LayoutParams params = new LinearLayout.LayoutParams(-1, -2);
        params.bottomMargin = dp(10);
        return params;
    }

    private LinearLayout.LayoutParams fieldParams() {
        LinearLayout.LayoutParams params = new LinearLayout.LayoutParams(-1, dp(54));
        params.topMargin = dp(7);
        return params;
    }

    private EditText field(String hint, String value, int inputType) {
        EditText field = new EditText(requireContext());
        field.setHint(hint);
        field.setText(value);
        field.setInputType(inputType);
        field.setSingleLine(true);
        field.setTextColor(ContextCompat.getColor(requireContext(), R.color.logoff_black));
        field.setHintTextColor(ContextCompat.getColor(requireContext(), R.color.logoff_text_muted));
        field.setBackgroundResource(R.drawable.bg_empty_state);
        field.setPadding(dp(14), 0, dp(14), 0);
        field.setTextSize(14);
        return field;
    }

    private Spinner spinner(List<String> labels) {
        Spinner spinner = new Spinner(requireContext(), Spinner.MODE_DROPDOWN);
        ArrayAdapter<String> adapter = new ArrayAdapter<>(
                requireContext(),
                android.R.layout.simple_spinner_item,
                labels
        );
        adapter.setDropDownViewResource(android.R.layout.simple_spinner_dropdown_item);
        spinner.setAdapter(adapter);
        spinner.setBackgroundResource(R.drawable.bg_empty_state);
        spinner.setPadding(dp(12), 0, dp(12), 0);
        return spinner;
    }

    private MaterialButton primaryButton(String title) {
        MaterialButton button = new MaterialButton(requireContext());
        button.setText(title);
        button.setAllCaps(false);
        button.setTextColor(ContextCompat.getColor(requireContext(), R.color.logoff_white));
        button.setTextSize(14);
        button.setTypeface(null, Typeface.BOLD);
        button.setBackgroundColor(ContextCompat.getColor(requireContext(), R.color.logoff_red));
        button.setCornerRadius(dp(18));
        return button;
    }

    private MaterialButton outlinedButton(String title) {
        MaterialButton button = new MaterialButton(
                requireContext(),
                null,
                com.google.android.material.R.attr.materialButtonOutlinedStyle
        );
        button.setText(title);
        button.setAllCaps(false);
        button.setTextColor(ContextCompat.getColor(requireContext(), R.color.logoff_black));
        button.setTextSize(13);
        button.setTypeface(null, Typeface.BOLD);
        button.setStrokeColorResource(R.color.logoff_border);
        button.setStrokeWidth(dp(1));
        button.setCornerRadius(dp(16));
        button.setInsetTop(0);
        button.setInsetBottom(0);
        return button;
    }

    private TextView label(String value) {
        return text(value, 12, R.color.logoff_text_muted, Typeface.BOLD);
    }

    private TextView text(String value, int size, int color, int style) {
        TextView view = new TextView(requireContext());
        view.setText(value);
        view.setTextSize(size);
        view.setTextColor(ContextCompat.getColor(requireContext(), color));
        view.setTypeface(null, style);
        return view;
    }

    private void showEmpty(String value) {
        if (binding == null) return;
        binding.content.removeAllViews();
        binding.empty.setText(cleanError(value));
        binding.empty.setVisibility(View.VISIBLE);
    }

    private void updateLoading() {
        if (binding == null) return;
        boolean loading = loadingOrders
                || loadingActiveClients
                || orderActionRunning
                || (PRICING.equals(section) && loadingSettings)
                || (CALCULATOR.equals(section) && loadingCalculator);
        binding.progress.setVisibility(loading && binding.content.getChildCount() == 0 ? View.VISIBLE : View.GONE);
        binding.swipe.setRefreshing(loading);
    }

    private boolean canManagePricing() {
        return app != null && app.state().isAdmin() && app.state().can("billing:write");
    }

    private boolean calculatorEnabled() {
        return canManagePricing() || (app != null
                && Boolean.TRUE.equals(app.state().selectedClient().get("fbsCalculatorEnabled")));
    }

    private boolean isOrderSection() {
        return ACTIVE.equals(section) || SHIPPED.equals(section)
                || COST.equals(section) || ARCHIVE.equals(section);
    }

    private String titleForSection() {
        if (SHIPPED.equals(section)) return "Отгруженные";
        if (COST.equals(section)) return "Стоимость обработки FBS";
        if (ARCHIVE.equals(section)) return "Архив FBS";
        return "Активные заказы FBS";
    }

    private String searchText(Map<String, Object> order) {
        Map<String, Object> product = map(order.get("product"));
        List<String> values = new ArrayList<>();
        for (String key : Arrays.asList("id", "orderUid", "article", "nmId", "chrtId", "statusLabel",
                "supplierStatus", "wbStatus", "accountName", "marketplace")) {
            values.add(AppState.string(order.get(key)));
        }
        for (String key : Arrays.asList("name", "internalSku", "clientSku", "article")) {
            values.add(AppState.string(product.get(key)));
        }
        values.addAll(strings(order.get("barcodes")));
        for (Map<String, Object> box : maps(order.get("storageBoxes"))) {
            values.add(AppState.string(box.get("code")));
        }
        return String.join(" ", values).toLowerCase(new Locale("ru", "RU"));
    }

    private String selectedServiceId(Spinner spinner) {
        if (pricingForm == null || pricingForm.serviceIds == null) return "";
        int index = spinner.getSelectedItemPosition();
        return index >= 0 && index < pricingForm.serviceIds.size()
                ? pricingForm.serviceIds.get(index) : "";
    }

    private String selectedPalletServiceId() {
        if (pricingForm == null || pricingForm.palletService == null
                || pricingForm.palletServiceIds == null) return "";
        int index = pricingForm.palletService.getSelectedItemPosition();
        return index >= 0 && index < pricingForm.palletServiceIds.size()
                ? pricingForm.palletServiceIds.get(index) : "";
    }

    private double additionalUnitPrice(List<Map<String, Object>> services) {
        if (pricingForm == null) return 0;
        double total = 0;
        for (Map.Entry<String, AdditionalSelection> entry : pricingForm.additional.entrySet()) {
            if (!entry.getValue().check.isChecked()) continue;
            total += servicePrice(services, entry.getKey())
                    * Math.max(0.001, nonNegative(entry.getValue().multiplier));
        }
        return total;
    }

    private double servicePrice(List<Map<String, Object>> services, String id) {
        for (Map<String, Object> service : services) {
            if (id.equals(AppState.string(service.get("id")))) return numberValue(service.get("priceRub"));
        }
        return 0;
    }

    private int positiveInt(EditText field, int fallback) {
        try {
            return Math.max(1, (int) Math.round(Double.parseDouble(
                    AppState.string(field.getText()).replace(',', '.'))));
        } catch (NumberFormatException ignored) {
            return fallback;
        }
    }

    private double nonNegative(EditText field) {
        try {
            return Math.max(0, Double.parseDouble(
                    AppState.string(field.getText()).replace(',', '.')));
        } catch (NumberFormatException ignored) {
            return 0;
        }
    }

    private double positiveDouble(EditText field, double fallback) {
        try {
            return Math.max(0.001, Double.parseDouble(
                    AppState.string(field.getText()).replace(',', '.')));
        } catch (NumberFormatException ignored) {
            return fallback;
        }
    }

    private String readableError(Response<?> response) {
        return cleanError(MobileRepository.errorMessage(response));
    }

    private String cleanError(String value) {
        String text = value == null ? "" : value;
        if (text.contains("\"message\"")) {
            int start = text.indexOf("\"message\"");
            int colon = text.indexOf(':', start);
            int quote = text.indexOf('"', colon + 1);
            int end = quote >= 0 ? text.indexOf('"', quote + 1) : -1;
            if (quote >= 0 && end > quote) return text.substring(quote + 1, end);
        }
        return text.isBlank() ? "Не удалось получить данные FBS." : text;
    }

    private String marketplaceLabel(Object value) {
        return "OZON".equals(AppState.string(value)) ? "Ozon" : "Wildberries";
    }

    private String count(Object value) {
        return NumberFormat.getIntegerInstance(new Locale("ru", "RU"))
                .format(value instanceof Number ? ((Number) value).longValue() : 0);
    }

    private String money(Object value) {
        return money(numberValue(value));
    }

    private String money(double value) {
        return NumberFormat.getCurrencyInstance(new Locale("ru", "RU")).format(value);
    }

    private double numberValue(Object value) {
        if (value instanceof Number) return ((Number) value).doubleValue();
        try {
            return Double.parseDouble(AppState.string(value).replace(',', '.'));
        } catch (NumberFormatException ignored) {
            return 0;
        }
    }

    private String decimal(Object value) {
        double number = numberValue(value);
        return number == Math.rint(number)
                ? String.valueOf((long) number)
                : String.valueOf(number);
    }

    private String integerText(Object value) {
        return String.valueOf(Math.max(1, Math.round(numberValue(value))));
    }

    private int indexOf(List<String> values, String value) {
        int index = values.indexOf(value);
        return Math.max(0, index);
    }

    private List<Map<String, Object>> activeServices(Object value) {
        List<Map<String, Object>> result = new ArrayList<>();
        for (Map<String, Object> service : maps(value)) {
            if (Boolean.TRUE.equals(service.get("isActive"))) result.add(service);
        }
        return result;
    }

    private Map<String, Object> findById(
            List<Map<String, Object>> values,
            String key,
            String id
    ) {
        for (Map<String, Object> value : values) {
            if (id.equals(AppState.string(value.get(key)))) return value;
        }
        return Collections.emptyMap();
    }

    private String firstNonBlank(String... values) {
        for (String value : values) if (value != null && !value.isBlank()) return value;
        return "";
    }

    private String joinNonBlank(String first, String second) {
        if (first.isBlank()) return second;
        if (second.isBlank()) return first;
        return first + " · " + second;
    }

    @SuppressWarnings("unchecked")
    private Map<String, Object> map(Object value) {
        return value instanceof Map<?, ?> ? (Map<String, Object>) value : Collections.emptyMap();
    }

    @SuppressWarnings("unchecked")
    private List<Map<String, Object>> maps(Object value) {
        if (!(value instanceof List<?>)) return Collections.emptyList();
        List<Map<String, Object>> result = new ArrayList<>();
        for (Object item : (List<?>) value) {
            if (item instanceof Map<?, ?>) result.add((Map<String, Object>) item);
        }
        return result;
    }

    private List<String> strings(Object value) {
        if (!(value instanceof List<?>)) return Collections.emptyList();
        List<String> result = new ArrayList<>();
        for (Object item : (List<?>) value) {
            String text = AppState.string(item);
            if (!text.isBlank()) result.add(text);
        }
        return result;
    }

    private int dp(int value) {
        return Math.round(value * getResources().getDisplayMetrics().density);
    }

    @Override
    public void onDestroyView() {
        binding = null;
        pricingForm = null;
        calculatorForm = null;
        super.onDestroyView();
    }

    private static class PricingForm {
        EditText processing;
        EditText pickupPrice;
        EditText vnukovoPrice;
        EditText baseItems;
        EditText blockItems;
        EditText blockPrice;
        EditText capacity;
        EditText boxesPerPallet;
        CheckBox palletsEnabled;
        Spinner route;
        Spinner formation;
        Spinner material;
        Spinner palletService;
        LinearLayout preview;
        List<String> serviceIds;
        List<String> palletServiceIds;
        List<Map<String, Object>> services = Collections.emptyList();
        Map<String, AdditionalSelection> additional = new LinkedHashMap<>();
    }

    private static class CalculatorForm {
        EditText quantity;
        Spinner tariff;
        Spinner destination;
        MaterialButton calculate;
        LinearLayout result;
        List<String> tariffIds = Collections.emptyList();
        List<String> destinations = Collections.emptyList();
    }

    private static class CalculatorCosts {
        final int boxes;
        final double processing;
        final double stickers;
        final double boxMaterials;
        final double boxAssembly;
        final double servicesWithMarkup;

        CalculatorCosts(
                int boxes,
                double processing,
                double stickers,
                double boxMaterials,
                double boxAssembly,
                double servicesWithMarkup
        ) {
            this.boxes = boxes;
            this.processing = processing;
            this.stickers = stickers;
            this.boxMaterials = boxMaterials;
            this.boxAssembly = boxAssembly;
            this.servicesWithMarkup = servicesWithMarkup;
        }
    }

    private static class AdditionalSelection {
        final CheckBox check;
        final EditText multiplier;

        AdditionalSelection(CheckBox check, EditText multiplier) {
            this.check = check;
            this.multiplier = multiplier;
        }
    }

    private interface SelectionCallback {
        void selected(int position);
    }

    private static class SimpleItemSelectedListener
            implements android.widget.AdapterView.OnItemSelectedListener {
        private final SelectionCallback callback;

        SimpleItemSelectedListener(SelectionCallback callback) {
            this.callback = callback;
        }

        @Override
        public void onItemSelected(
                android.widget.AdapterView<?> parent,
                View view,
                int position,
                long id
        ) {
            callback.selected(position);
        }

        @Override public void onNothingSelected(android.widget.AdapterView<?> parent) {}
    }
}
