import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
import { ArrowLeft, ArrowRightLeft, ChevronRight, ClipboardCheck, History, PackageCheck, PackagePlus, PackageSearch, RefreshCw, Truck, Warehouse } from 'lucide-react';
import { useEffect, useState } from 'react';
import { deleteSku, fetchClients, fetchSkus } from '../../lib/api';
import { BoxTransferForm } from './BoxTransferForm';
import { BoxManagementPanel } from './BoxManagementPanel';
import { OnlineReceiptPanel } from './OnlineReceiptPanel';
import { GoodsArrivalPanel } from './GoodsArrivalPanel';
import { ReceiptBatchesPanel } from './ReceiptBatchesPanel';
import { PickWavePanel } from './PickWavePanel';
import { StoragePanel } from './StoragePanel';
import { BoxIntegrityPanel } from './BoxIntegrityPanel';
import { ShipmentHistoryPanel } from './ShipmentHistoryPanel';
import './warehouse.css';
import { useRememberedClientId, validRememberedClientId } from '../../lib/rememberedClient';
export function WarehouseOpsPanel({ onOpenCatalog, session }) {
    const [activeTopic, setActiveTopic] = useState(null);
    if (!canUse(session.user, 'stock:write')) {
        return null;
    }
    return (_jsxs("div", { className: "warehouse-workspace", "aria-label": "\u0421\u043A\u043B\u0430\u0434 \u0438 \u043E\u043F\u0435\u0440\u0430\u0446\u0438\u0438", children: [!activeTopic ? _jsx(WarehouseTopicPicker, { onOpen: setActiveTopic }) : null, activeTopic ? (_jsxs("button", { className: "warehouse-topic-back", type: "button", onClick: () => setActiveTopic(null), children: [_jsx(ArrowLeft, { size: 16, "aria-hidden": "true" }), _jsx("span", { children: "\u0420\u0430\u0437\u0434\u0435\u043B\u044B \u0441\u043A\u043B\u0430\u0434\u0430" })] })) : null, activeTopic === 'online-receipts' ? _jsxs("section", { className: "warehouse-panel warehouse-panel--online-receipts", "aria-label": "\u041E\u043D\u043B\u0430\u0439\u043D \u043F\u0440\u0438\u0435\u043C\u043A\u0430", children: [_jsxs("div", { className: "section-heading warehouse-panel__heading", children: [_jsxs("div", { children: [_jsx("p", { className: "eyebrow", children: "\u0422\u0421\u0414 \u0438 \u043F\u0440\u0438\u0435\u043C\u043A\u0430" }), _jsx("h2", { children: "\u041E\u043D\u043B\u0430\u0439\u043D \u043F\u0440\u0438\u0435\u043C\u043A\u0430" })] }), _jsx(PackageCheck, { size: 20, "aria-hidden": "true" })] }), _jsx(OnlineReceiptPanel, { session: session })] }) : null, activeTopic === 'arrivals' ? _jsxs("section", { className: "warehouse-panel warehouse-panel--arrivals", "aria-label": "\u041F\u0440\u0438\u0445\u043E\u0434 \u0442\u043E\u0432\u0430\u0440\u0430", children: [_jsxs("div", { className: "section-heading warehouse-panel__heading", children: [_jsxs("div", { children: [_jsx("p", { className: "eyebrow", children: "\u041F\u0440\u0438\u0445\u043E\u0434 \u0438 \u041F\u041F\u0420" }), _jsx("h2", { children: "\u041F\u0440\u0438\u0445\u043E\u0434 \u0442\u043E\u0432\u0430\u0440\u0430" })] }), _jsx(Truck, { size: 20, "aria-hidden": "true" })] }), _jsx(GoodsArrivalPanel, { session: session })] }) : null, activeTopic === 'receipt-batches' ? _jsxs("section", { className: "warehouse-panel warehouse-panel--receipt-batches", "aria-label": "\u0424\u0430\u0439\u043B\u044B \u043F\u0440\u0438\u0435\u043C\u043A\u0438", children: [_jsxs("div", { className: "section-heading warehouse-panel__heading", children: [_jsxs("div", { children: [_jsx("p", { className: "eyebrow", children: "\u0414\u043E\u043A\u0443\u043C\u0435\u043D\u0442\u044B \u043F\u0440\u0438\u0435\u043C\u043A\u0438" }), _jsx("h2", { children: "\u0424\u0430\u0439\u043B\u044B \u043F\u0440\u0438\u0435\u043C\u043A\u0438" })] }), _jsx(PackageCheck, { size: 20, "aria-hidden": "true" })] }), _jsx(ReceiptBatchesPanel, { session: session })] }) : null, activeTopic === 'boxes' ? _jsxs("section", { className: "warehouse-panel warehouse-panel--boxes", "aria-label": "\u041A\u043E\u0440\u043E\u0431\u0430 \u043D\u0430 \u0441\u043A\u043B\u0430\u0434\u0435", children: [_jsxs("div", { className: "section-heading warehouse-panel__heading", children: [_jsxs("div", { children: [_jsx("p", { className: "eyebrow", children: "\u0425\u0440\u0430\u043D\u0435\u043D\u0438\u0435 \u0438 \u043E\u0441\u0442\u0430\u0442\u043A\u0438" }), _jsx("h2", { children: "\u041A\u043E\u0440\u043E\u0431\u0430" })] }), _jsx(PackageSearch, { size: 20, "aria-hidden": "true" })] }), _jsx(BoxManagementPanel, { session: session })] }) : null, activeTopic === 'integrity' ? _jsxs("section", { className: "warehouse-panel warehouse-panel--integrity", "aria-label": "\u041F\u0440\u043E\u0432\u0435\u0440\u043A\u0430 \u043A\u043E\u0440\u043E\u0431\u043E\u0432", children: [_jsxs("div", { className: "section-heading warehouse-panel__heading", children: [_jsxs("div", { children: [_jsx("p", { className: "eyebrow", children: "\u041A\u043E\u043D\u0442\u0440\u043E\u043B\u044C \u043E\u0441\u0442\u0430\u0442\u043A\u043E\u0432" }), _jsx("h2", { children: "\u041F\u0440\u043E\u0432\u0435\u0440\u043A\u0430 \u043A\u043E\u0440\u043E\u0431\u043E\u0432" })] }), _jsx(ClipboardCheck, { size: 20, "aria-hidden": "true" })] }), _jsx(BoxIntegrityPanel, { session: session })] }) : null, activeTopic === 'shipment-history' ? _jsxs("section", { className: "warehouse-panel warehouse-panel--shipment-history", "aria-label": "\u0418\u0441\u0442\u043E\u0440\u0438\u044F \u043E\u0442\u0433\u0440\u0443\u0436\u0435\u043D\u043D\u044B\u0445 \u041A\u0418\u0417", children: [_jsxs("div", { className: "section-heading warehouse-panel__heading", children: [_jsxs("div", { children: [_jsx("p", { className: "eyebrow", children: "\u0418\u0441\u0442\u043E\u0440\u0438\u044F" }), _jsx("h2", { children: "\u041E\u0442\u0433\u0440\u0443\u0436\u0435\u043D\u043D\u044B\u0435 \u0442\u043E\u0432\u0430\u0440\u044B \u0441 \u041A\u0418\u0417" })] }), _jsx(History, { size: 20, "aria-hidden": "true" })] }), _jsx(ShipmentHistoryPanel, { session: session })] }) : null, activeTopic === 'operations' ? _jsxs("section", { className: "warehouse-panel warehouse-panel--operations", "aria-label": "\u0421\u043A\u043B\u0430\u0434\u0441\u043A\u0438\u0435 \u043E\u043F\u0435\u0440\u0430\u0446\u0438\u0438", children: [_jsxs("div", { className: "section-heading warehouse-panel__heading", children: [_jsxs("div", { children: [_jsx("p", { className: "eyebrow", children: "\u041E\u043F\u0435\u0440\u0430\u0446\u0438\u0438 \u0441\u043A\u043B\u0430\u0434\u0430" }), _jsx("h2", { children: "\u041F\u0435\u0440\u0435\u043C\u0435\u0449\u0435\u043D\u0438\u044F \u0438 \u0441\u0431\u043E\u0440\u043A\u0430" })] }), _jsx(ArrowRightLeft, { size: 20, "aria-hidden": "true" })] }), _jsx(BoxTransferForm, { session: session }), _jsx(PickWavePanel, { session: session })] }) : null, activeTopic === 'drafts' ? _jsxs("section", { className: "warehouse-panel warehouse-panel--drafts", "aria-label": "\u041D\u043E\u0432\u044B\u0439 \u0442\u043E\u0432\u0430\u0440", children: [_jsxs("div", { className: "section-heading warehouse-panel__heading", children: [_jsxs("div", { children: [_jsx("p", { className: "eyebrow", children: "\u041D\u043E\u0432\u044B\u0439 \u0442\u043E\u0432\u0430\u0440" }), _jsx("h2", { children: "\u0427\u0435\u0440\u043D\u043E\u0432\u0438\u043A\u0438 \u043F\u043E\u0441\u043B\u0435 \u043F\u0440\u0438\u0435\u043C\u043A\u0438" })] }), _jsx(PackagePlus, { size: 20, "aria-hidden": "true" })] }), _jsx(NewProductsPanel, { session: session, onOpenCatalog: onOpenCatalog })] }) : null, activeTopic === 'storage' ? _jsxs("section", { className: "warehouse-panel warehouse-panel--storage", "aria-label": "\u0425\u0440\u0430\u043D\u0435\u043D\u0438\u0435", children: [_jsxs("div", { className: "section-heading warehouse-panel__heading", children: [_jsxs("div", { children: [_jsx("p", { className: "eyebrow", children: "\u0425\u0440\u0430\u043D\u0435\u043D\u0438\u0435" }), _jsx("h2", { children: "\u041B\u0438\u0442\u0440\u0430\u0436, \u0442\u0430\u0440\u0438\u0444\u044B \u0438 \u043D\u0430\u0447\u0438\u0441\u043B\u0435\u043D\u0438\u044F" })] }), _jsx(Warehouse, { size: 20, "aria-hidden": "true" })] }), _jsx(StoragePanel, { session: session })] }) : null] }));
}
function WarehouseTopicPicker({ onOpen }) {
    const topics = [
        { id: 'online-receipts', eyebrow: 'ТСД и приемка', title: 'Онлайн-приёмка', description: 'Проверяйте приёмку, которую ведут сотрудники на ТСД.', icon: _jsx(PackageCheck, { size: 23 }) },
        { id: 'arrivals', eyebrow: 'Приход и ППР', title: 'Приход товара', description: 'Создайте и ведите приход товаров на склад.', icon: _jsx(Truck, { size: 23 }) },
        { id: 'receipt-batches', eyebrow: 'Документы', title: 'Файлы приёмки', description: 'Загрузки и документы, связанные с поставками.', icon: _jsx(PackagePlus, { size: 23 }) },
        { id: 'boxes', eyebrow: 'Хранение', title: 'Короба', description: 'Найдите короб, его состав, ячейку и паллет-сорт.', icon: _jsx(PackageSearch, { size: 23 }) },
        { id: 'integrity', eyebrow: 'Контроль остатков', title: 'Проверка коробов', description: 'Найдите фантомные остатки и исправьте расхождения.', icon: _jsx(ClipboardCheck, { size: 23 }) },
        { id: 'shipment-history', eyebrow: 'История', title: 'Отгруженные КИЗ', description: 'Проверка отгруженных товаров, коробов и кодов маркировки.', icon: _jsx(History, { size: 23 }) },
        { id: 'operations', eyebrow: 'Операции склада', title: 'Перемещения и сборка', description: 'Перемещайте короба и формируйте задания на сборку.', icon: _jsx(ArrowRightLeft, { size: 23 }) },
        { id: 'drafts', eyebrow: 'Новый товар', title: 'Черновики приёмки', description: 'Заполните карточки новых товаров после приёмки.', icon: _jsx(PackagePlus, { size: 23 }) },
        { id: 'storage', eyebrow: 'Тарифы', title: 'Хранение', description: 'Литраж, тарифы и начисления за хранение.', icon: _jsx(Warehouse, { size: 23 }) },
    ];
    return (_jsxs("section", { className: "warehouse-topic-picker", "aria-label": "\u0420\u0430\u0437\u0434\u0435\u043B\u044B \u0441\u043A\u043B\u0430\u0434\u0430", children: [_jsxs("div", { className: "warehouse-topic-picker__heading", children: [_jsxs("div", { children: [_jsx("p", { className: "eyebrow", children: "\u0421\u043A\u043B\u0430\u0434 \u0438 \u043E\u043F\u0435\u0440\u0430\u0446\u0438\u0438" }), _jsx("h2", { children: "\u0412\u044B\u0431\u0435\u0440\u0438\u0442\u0435 \u0437\u0430\u0434\u0430\u0447\u0443" })] }), _jsx("span", { children: "\u041E\u043F\u0435\u0440\u0430\u0446\u0438\u0438 \u043E\u0442\u043A\u0440\u044B\u0432\u0430\u044E\u0442\u0441\u044F \u043E\u0442\u0434\u0435\u043B\u044C\u043D\u043E \u2014 \u0441\u043F\u0438\u0441\u043E\u043A \u043D\u0435 \u043C\u0435\u0448\u0430\u0435\u0442 \u0440\u0430\u0431\u043E\u0442\u0435." })] }), _jsx("div", { className: "warehouse-topic-grid", children: topics.map((topic) => (_jsxs("button", { className: `warehouse-topic-tile warehouse-topic-tile--${topic.id}`, type: "button", onClick: () => onOpen(topic.id), children: [_jsx("span", { className: "warehouse-topic-tile__icon", children: topic.icon }), _jsxs("span", { className: "warehouse-topic-tile__content", children: [_jsx("small", { children: topic.eyebrow }), _jsx("strong", { children: topic.title }), _jsx("span", { children: topic.description })] }), _jsx(ChevronRight, { size: 22, "aria-hidden": "true" })] }, topic.id))) })] }));
}
function NewProductsPanel({ onOpenCatalog, session }) {
    const [clients, setClients] = useState([]);
    const [selectedClientId, setSelectedClientId] = useRememberedClientId(session.user.id);
    const [drafts, setDrafts] = useState([]);
    const [selectedDraftIds, setSelectedDraftIds] = useState([]);
    const [isLoading, setLoading] = useState(false);
    const [isDeleting, setDeleting] = useState(false);
    const [message, setMessage] = useState('');
    useEffect(() => {
        let isActive = true;
        fetchClients(session.accessToken)
            .then((items) => {
            if (!isActive) {
                return;
            }
            setClients(items);
            setSelectedClientId((current) => validRememberedClientId(current, items));
        })
            .catch((caught) => {
            if (isActive) {
                setMessage(caught instanceof Error ? caught.message : 'Не удалось загрузить клиентов.');
            }
        });
        return () => {
            isActive = false;
        };
    }, [session.accessToken]);
    useEffect(() => {
        if (!selectedClientId) {
            setDrafts([]);
            setSelectedDraftIds([]);
            return;
        }
        void loadDrafts();
    }, [selectedClientId]);
    async function loadDrafts() {
        if (!selectedClientId) {
            return;
        }
        setLoading(true);
        setMessage('');
        try {
            const nextDrafts = await fetchSkus(session.accessToken, { clientId: selectedClientId, draftsOnly: true });
            setDrafts(nextDrafts);
            setSelectedDraftIds((current) => current.filter((id) => nextDrafts.some((draft) => draft.id === id)));
        }
        catch (caught) {
            setMessage(caught instanceof Error ? caught.message : 'Не удалось загрузить новые товары.');
        }
        finally {
            setLoading(false);
        }
    }
    async function deleteSelectedDrafts() {
        if (selectedDraftIds.length === 0) {
            return;
        }
        setDeleting(true);
        setMessage('');
        const errors = [];
        for (const id of selectedDraftIds) {
            try {
                await deleteSku(session.accessToken, id);
            }
            catch (caught) {
                const draft = drafts.find((item) => item.id === id);
                errors.push(`${draft?.name ?? id}: ${caught instanceof Error ? caught.message : 'не удалено'}`);
            }
        }
        setSelectedDraftIds([]);
        await loadDrafts();
        setMessage(errors.length ? `Удалены не все черновики: ${errors.slice(0, 3).join('; ')}` : 'Выбранные черновики удалены.');
        setDeleting(false);
    }
    return (_jsxs("div", { className: "warehouse-drafts", children: [_jsxs("div", { className: "warehouse-drafts__toolbar", children: [_jsxs("label", { children: [_jsx("span", { children: "\u041A\u043B\u0438\u0435\u043D\u0442" }), _jsxs("select", { value: selectedClientId, onChange: (event) => setSelectedClientId(event.target.value), children: [_jsx("option", { value: "", children: "\u0412\u044B\u0431\u0435\u0440\u0438\u0442\u0435 \u043A\u043B\u0438\u0435\u043D\u0442\u0430" }), clients.map((client) => (_jsx("option", { value: client.id, children: client.name }, client.id)))] })] }), _jsxs("button", { className: "secondary-button", type: "button", onClick: () => void loadDrafts(), disabled: !selectedClientId || isLoading, children: [_jsx(RefreshCw, { size: 16, "aria-hidden": "true" }), _jsx("span", { children: isLoading ? 'Обновляю' : 'Обновить' })] }), onOpenCatalog ? (_jsxs("button", { className: "primary-button", type: "button", onClick: onOpenCatalog, children: [_jsx(PackagePlus, { size: 16, "aria-hidden": "true" }), _jsx("span", { children: "\u0417\u0430\u043F\u043E\u043B\u043D\u0438\u0442\u044C \u0432 \u043A\u0430\u0442\u0430\u043B\u043E\u0433\u0435" })] })) : null, _jsxs("button", { className: "danger-button", type: "button", onClick: () => void deleteSelectedDrafts(), disabled: selectedDraftIds.length === 0 || isDeleting, children: ["\u0423\u0434\u0430\u043B\u0438\u0442\u044C \u0432\u044B\u0431\u0440\u0430\u043D\u043D\u044B\u0435 (", selectedDraftIds.length, ")"] })] }), message ? _jsx("p", { className: "form-error", children: message }) : null, drafts.length > 0 ? (_jsxs(_Fragment, { children: [_jsxs("label", { className: "warehouse-comment", children: [_jsx("span", { children: "\u0412\u044B\u0431\u0440\u0430\u0442\u044C \u0447\u0435\u0440\u043D\u043E\u0432\u0438\u043A\u0438 \u0434\u043B\u044F \u0443\u0434\u0430\u043B\u0435\u043D\u0438\u044F" }), _jsx("select", { multiple: true, size: Math.min(8, Math.max(3, drafts.length)), value: selectedDraftIds, onChange: (event) => setSelectedDraftIds(Array.from(event.currentTarget.selectedOptions, (option) => option.value)), children: drafts.map((sku) => (_jsxs("option", { value: sku.id, children: [primaryBarcode(sku) || sku.internalSku, " - ", sku.name] }, sku.id))) })] }), _jsx("div", { className: "warehouse-drafts__table-wrap", children: _jsxs("table", { className: "warehouse-drafts__table", children: [_jsx("thead", { children: _jsxs("tr", { children: [_jsx("th", { children: "\u0428\u041A" }), _jsx("th", { children: "\u041D\u0430\u0437\u0432\u0430\u043D\u0438\u0435" }), _jsx("th", { children: "\u0410\u0440\u0442\u0438\u043A\u0443\u043B" }), _jsx("th", { children: "\u0426\u0432\u0435\u0442 / \u0440\u0430\u0437\u043C\u0435\u0440" }), _jsx("th", { children: "\u0418\u0441\u0442\u043E\u0447\u043D\u0438\u043A" })] }) }), _jsx("tbody", { children: drafts.map((sku) => (_jsxs("tr", { children: [_jsx("td", { children: primaryBarcode(sku) || '-' }), _jsxs("td", { children: [_jsx("strong", { children: sku.name }), _jsx("span", { children: sku.internalSku })] }), _jsx("td", { children: sku.article || '-' }), _jsx("td", { children: [sku.color, sku.size].filter(Boolean).join(' / ') || '-' }), _jsx("td", { children: sku.draftSource || 'приемка' })] }, sku.id))) })] }) })] })) : (_jsx("p", { className: "warehouse-inline", children: selectedClientId ? 'Новых товаров без карточки у клиента нет.' : 'Выберите клиента.' }))] }));
}
function canUse(user, permission) {
    return user.permissionCodes.includes('system:admin') || user.permissionCodes.includes(permission);
}
function primaryBarcode(sku) {
    return sku.barcodes.find((barcode) => barcode.isPrimary)?.value ?? sku.barcodes[0]?.value ?? '';
}
