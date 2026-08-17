import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
import { CheckCircle2, Edit3, PackageOpen, RefreshCw, RotateCcw, Search, Trash2, Unlock } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { addOnlineReceiptItem, closeAllOnlineReceiptBoxes, closeOnlineReceiptBox, deleteOnlineReceiptBox, deleteOnlineReceiptItem, fetchClients, fetchOnlineReceipts, fetchSkus, finishOnlineReceipt, openOnlineReceiptBox, restoreOnlineReceiptBox, updateOnlineReceiptItem, } from '../../lib/api';
import { ConfirmDialog } from '../common/ConfirmDialog';
import { useRememberedClientId, validRememberedClientId } from '../../lib/rememberedClient';
export function OnlineReceiptPanel({ fixedClientId, readOnly = false, session }) {
    const [clients, setClients] = useState([]);
    const [clientId, setClientId] = useRememberedClientId(session.user.id, { fixedClientId });
    const [overview, setOverview] = useState(null);
    const [selectedBoxKey, setSelectedBoxKey] = useState('');
    const [message, setMessage] = useState('');
    const [isLoading, setLoading] = useState(false);
    const [isConfirming, setConfirming] = useState(false);
    const [pendingConfirm, setPendingConfirm] = useState(null);
    const [boxCode, setBoxCode] = useState('');
    const [barcode, setBarcode] = useState('');
    const [quantity, setQuantity] = useState('1');
    const [kiz, setKiz] = useState('');
    const [skuOptions, setSkuOptions] = useState([]);
    const [editingId, setEditingId] = useState('');
    const [editQuantity, setEditQuantity] = useState('1');
    const [editKiz, setEditKiz] = useState('');
    const canManage = !readOnly && canUse(session.user, 'warehouse:write');
    const deletedBoxes = overview?.deletedBoxes ?? [];
    const openBoxes = overview?.boxes.filter((box) => box.status === 'receiving') ?? [];
    useEffect(() => {
        if (fixedClientId) {
            setClientId(fixedClientId);
            return;
        }
        let active = true;
        fetchClients(session.accessToken)
            .then((items) => {
            if (!active) {
                return;
            }
            setClients(items);
            setClientId((current) => validRememberedClientId(current, items));
        })
            .catch((caught) => {
            if (active) {
                setMessage(caught instanceof Error ? caught.message : 'Не удалось загрузить клиентов.');
            }
        });
        return () => {
            active = false;
        };
    }, [fixedClientId, session.accessToken]);
    useEffect(() => {
        if (!clientId) {
            setOverview(null);
            return;
        }
        void loadOverview();
        const timer = window.setInterval(() => void loadOverview(false), 15000);
        return () => window.clearInterval(timer);
    }, [clientId]);
    useEffect(() => {
        if (!clientId || barcode.trim().length < 3) {
            setSkuOptions([]);
            return;
        }
        let active = true;
        const timer = window.setTimeout(() => {
            fetchSkus(session.accessToken, { clientId, search: barcode.trim() })
                .then((items) => {
                if (active) {
                    setSkuOptions(items.slice(0, 20));
                }
            })
                .catch(() => {
                if (active) {
                    setSkuOptions([]);
                }
            });
        }, 250);
        return () => {
            active = false;
            window.clearTimeout(timer);
        };
    }, [barcode, clientId, session.accessToken]);
    const selectedBox = useMemo(() => {
        if (!overview?.boxes.length) {
            return null;
        }
        return overview.boxes.find((box) => box.key === selectedBoxKey) ?? overview.boxes[0];
    }, [overview, selectedBoxKey]);
    useEffect(() => {
        if (!overview?.boxes.length) {
            setSelectedBoxKey('');
            return;
        }
        setSelectedBoxKey((current) => (overview.boxes.some((box) => box.key === current) ? current : overview.boxes[0].key));
    }, [overview]);
    async function loadOverview(showSpinner = true) {
        if (!clientId) {
            return;
        }
        if (showSpinner) {
            setLoading(true);
        }
        setMessage('');
        try {
            const result = await fetchOnlineReceipts(session.accessToken, { clientId });
            setOverview(result);
            if (showSpinner) {
                setSelectedBoxKey(result.boxes[0]?.key ?? '');
            }
        }
        catch (caught) {
            setMessage(caught instanceof Error ? caught.message : 'Не удалось загрузить онлайн-приемку.');
        }
        finally {
            if (showSpinner) {
                setLoading(false);
            }
        }
    }
    async function runAction(action, success) {
        setMessage('');
        try {
            await action();
            setMessage(success);
            await loadOverview(false);
        }
        catch (caught) {
            setMessage(caught instanceof Error ? caught.message : 'Операция не выполнена.');
        }
    }
    async function runConfirmed() {
        if (!pendingConfirm) {
            return;
        }
        setConfirming(true);
        try {
            await runAction(pendingConfirm.action, pendingConfirm.success);
            setPendingConfirm(null);
        }
        finally {
            setConfirming(false);
        }
    }
    async function addItem() {
        const targetBox = selectedBox?.boxCode || boxCode.trim();
        if (!clientId || !targetBox || !barcode.trim()) {
            setMessage('Выберите клиента, короб и укажите ШК товара.');
            return;
        }
        await runAction(() => addOnlineReceiptItem(session.accessToken, {
            clientId,
            boxCode: targetBox,
            sourceDocument: selectedBox?.sourceDocument,
            barcode: barcode.trim(),
            quantity: Number(quantity) || 1,
            kiz: kiz.trim() || undefined,
        }), 'Товар добавлен в короб.');
        setBarcode('');
        setQuantity('1');
        setKiz('');
    }
    function startEdit(item) {
        setEditingId(item.movementId);
        setEditQuantity(String(item.quantity));
        setEditKiz(item.kiz ?? '');
    }
    async function saveEdit(item) {
        await runAction(() => updateOnlineReceiptItem(session.accessToken, item.movementId, {
            quantity: Number(editQuantity) || item.quantity,
            kiz: editKiz,
        }), 'Строка приемки изменена.');
        setEditingId('');
    }
    const totals = overview?.boxes.reduce((sum, box) => ({
        boxes: sum.boxes + 1,
        quantity: sum.quantity + box.totalQuantity,
        kiz: sum.kiz + box.kizCount,
        receiving: sum.receiving + (box.status === 'receiving' ? 1 : 0),
    }), { boxes: 0, quantity: 0, kiz: 0, receiving: 0 }) ?? { boxes: 0, quantity: 0, kiz: 0, receiving: 0 };
    return (_jsxs("div", { className: `online-receipts ${readOnly ? 'online-receipts--readonly' : ''}`, children: [_jsxs("div", { className: "online-receipts__toolbar", children: [!fixedClientId ? (_jsxs("label", { children: [_jsx("span", { children: "\u041A\u043B\u0438\u0435\u043D\u0442" }), _jsxs("select", { value: clientId, onChange: (event) => setClientId(event.target.value), children: [_jsx("option", { value: "", children: "\u0412\u044B\u0431\u0435\u0440\u0438\u0442\u0435 \u043A\u043B\u0438\u0435\u043D\u0442\u0430" }), clients.map((client) => (_jsx("option", { value: client.id, children: client.name }, client.id)))] })] })) : null, _jsxs("button", { className: "secondary-button", type: "button", onClick: () => void loadOverview(), disabled: !clientId || isLoading, children: [_jsx(RefreshCw, { size: 16, "aria-hidden": "true" }), _jsx("span", { children: isLoading ? 'Обновляю' : 'Обновить' })] }), canManage ? (_jsxs("button", { className: "secondary-button", type: "button", disabled: !clientId || openBoxes.length === 0, onClick: () => setPendingConfirm({
                            title: 'Закрыть все открытые короба?',
                            message: `Будут закрыты все открытые короба выбранного клиента: ${openBoxes.length}.`,
                            details: [
                                ...openBoxes.slice(0, 12).map((box) => `${box.boxCode} · ${box.totalQuantity} шт.`),
                                ...(openBoxes.length > 12 ? [`Еще ${openBoxes.length - 12} коробов`] : []),
                            ],
                            confirmLabel: 'Закрыть все',
                            action: () => closeAllOnlineReceiptBoxes(session.accessToken, {
                                clientId,
                                batchDate: overview?.currentBatchDate ?? undefined,
                                comment: 'Массовое закрытие открытых коробов из онлайн-приемки WMS.',
                            }),
                            success: `Открытые короба закрыты: ${openBoxes.length}.`,
                        }), children: [_jsx(CheckCircle2, { size: 16, "aria-hidden": "true" }), _jsx("span", { children: "\u0417\u0430\u043A\u0440\u044B\u0442\u044C \u043E\u0442\u043A\u0440\u044B\u0442\u044B\u0435" })] })) : null, canManage ? (_jsxs("button", { className: "primary-button", type: "button", disabled: !clientId || totals.boxes === 0, onClick: () => setPendingConfirm({
                            title: 'Завершить приемку?',
                            message: 'Система закроет открытые короба, проверит попадание данных в остатки и отправит клиенту уведомление о завершении приемки.',
                            details: [
                                `Коробов в списке: ${totals.boxes}`,
                                `Открытых коробов: ${totals.receiving}`,
                                `Единиц в остатках: ${totals.quantity}`,
                                `КИЗ: ${totals.kiz}`,
                            ],
                            confirmLabel: 'Завершить приемку',
                            action: () => finishOnlineReceipt(session.accessToken, {
                                clientId,
                                batchDate: overview?.currentBatchDate ?? undefined,
                                comment: 'Приемка завершена из онлайн-приемки WMS.',
                            }),
                            success: 'Приемка завершена. Клиенту отправлено уведомление, если Telegram включен.',
                        }), children: [_jsx(CheckCircle2, { size: 16, "aria-hidden": "true" }), _jsx("span", { children: "\u0417\u0430\u0432\u0435\u0440\u0448\u0438\u0442\u044C \u043F\u0440\u0438\u0435\u043C\u043A\u0443" })] })) : null] }), _jsxs("div", { className: "online-receipts__stats", children: [_jsx(Stat, { label: "\u041A\u043E\u0440\u043E\u0431\u043E\u0432", value: totals.boxes }), _jsx(Stat, { label: "\u0415\u0434\u0438\u043D\u0438\u0446", value: totals.quantity }), _jsx(Stat, { label: "\u041A\u0418\u0417", value: totals.kiz }), _jsx(Stat, { label: "\u041E\u0442\u043A\u0440\u044B\u0442\u043E", value: totals.receiving })] }), overview?.currentBatchDate ? (_jsxs("p", { className: "warehouse-inline", children: ["\u0422\u0435\u043A\u0443\u0449\u0430\u044F \u043F\u0440\u0438\u0435\u043C\u043A\u0430: ", formatBatchDate(overview.currentBatchDate), ". \u041F\u0440\u0438 \u043F\u043E\u044F\u0432\u043B\u0435\u043D\u0438\u0438 \u043A\u043E\u0440\u043E\u0431\u0430 \u0441 \u0434\u0440\u0443\u0433\u043E\u0439 \u0434\u0430\u0442\u043E\u0439 \u0441\u0447\u0435\u0442\u0447\u0438\u043A\u0438 \u0438 \u0441\u043F\u0438\u0441\u043E\u043A \u043D\u0430\u0447\u0438\u043D\u0430\u044E\u0442\u0441\u044F \u0437\u0430\u043D\u043E\u0432\u043E, \u0430 \u043F\u0440\u0435\u0434\u044B\u0434\u0443\u0449\u0430\u044F \u043F\u0440\u0438\u0435\u043C\u043A\u0430 \u043E\u0441\u0442\u0430\u0435\u0442\u0441\u044F \u0432 \u0440\u0430\u0437\u0434\u0435\u043B\u0435 \u00AB\u0424\u0430\u0439\u043B\u044B \u043F\u0440\u0438\u0435\u043C\u043A\u0438\u00BB."] })) : null, message ? _jsx("p", { className: "warehouse-inline", children: message }) : null, _jsxs("div", { className: "online-receipts__grid", children: [_jsxs("div", { className: "online-receipts__boxes", children: [_jsxs("div", { className: "warehouse-subheading", children: [_jsx("h3", { children: "\u041A\u043E\u0440\u043E\u0431\u0430 \u043F\u0440\u0438\u0435\u043C\u043A\u0438" }), _jsx("span", { children: overview?.generatedAt ? `обновлено ${formatDateTime(overview.generatedAt)}` : 'выберите клиента' })] }), canManage ? (_jsxs("div", { className: "online-receipts__new-box", children: [_jsx("input", { value: boxCode, onChange: (event) => setBoxCode(event.target.value), placeholder: "\u041D\u043E\u0432\u044B\u0439 \u043A\u043E\u0440\u043E\u0431" }), _jsxs("button", { className: "secondary-button", type: "button", disabled: !clientId || !boxCode.trim(), onClick: () => void runAction(() => openOnlineReceiptBox(session.accessToken, { clientId, boxCode: boxCode.trim() }), 'Короб открыт.'), children: [_jsx(PackageOpen, { size: 15, "aria-hidden": "true" }), _jsx("span", { children: "\u041E\u0442\u043A\u0440\u044B\u0442\u044C" })] })] })) : null, _jsx("div", { className: "online-receipts__box-list", children: overview?.boxes.length ? (overview.boxes.map((box) => (_jsxs("button", { className: `online-receipts__box-row ${selectedBox?.key === box.key ? 'is-selected' : ''}`, type: "button", onClick: () => setSelectedBoxKey(box.key), children: [_jsx("strong", { children: box.boxCode }), _jsxs("span", { children: [statusLabel(box.status), " \u00B7 ", box.totalQuantity, " \u0448\u0442 \u00B7 \u041A\u0418\u0417 ", box.kizCount] }), _jsxs("small", { children: [box.operator || 'оператор не указан', " \u00B7 ", box.deviceCode || 'ТСД не указан'] })] }, box.key)))) : (_jsx("p", { className: "warehouse-inline", children: "\u041F\u043E \u043A\u043B\u0438\u0435\u043D\u0442\u0443 \u043F\u043E\u043A\u0430 \u043D\u0435\u0442 \u043E\u043D\u043B\u0430\u0439\u043D-\u043F\u0440\u0438\u0435\u043C\u043E\u043A." })) }), canManage && deletedBoxes.length > 0 ? (_jsx(DeletedBoxesList, { boxes: deletedBoxes, onRestore: (box) => setPendingConfirm({
                                    title: 'Восстановить короб?',
                                    message: `Короб ${box.boxCode} вернется в остатки клиента вместе с товарами из сохраненного состава.`,
                                    details: [`Единиц: ${box.totalQuantity}`, `КИЗ: ${box.kizCount}`],
                                    confirmLabel: 'Восстановить',
                                    action: () => restoreOnlineReceiptBox(session.accessToken, {
                                        clientId,
                                        boxCode: box.boxCode,
                                        sourceDocument: box.sourceDocument,
                                    }),
                                    success: `Короб ${box.boxCode} восстановлен.`,
                                }) })) : null] }), _jsx("div", { className: "online-receipts__details", children: selectedBox ? (_jsx(BoxDetails, { box: selectedBox, barcode: barcode, quantity: quantity, kiz: kiz, skuOptions: skuOptions, editingId: editingId, editQuantity: editQuantity, editKiz: editKiz, canManage: canManage, onBarcodeChange: setBarcode, onQuantityChange: setQuantity, onKizChange: setKiz, onAddItem: () => void addItem(), onCloseBox: () => void runAction(() => closeOnlineReceiptBox(session.accessToken, {
                                clientId,
                                boxCode: selectedBox.boxCode,
                                sourceDocument: selectedBox.sourceDocument,
                            }), 'Короб закрыт.'), onOpenBox: () => void runAction(() => openOnlineReceiptBox(session.accessToken, {
                                clientId,
                                boxCode: selectedBox.boxCode,
                                sourceDocument: selectedBox.sourceDocument,
                            }), 'Короб открыт для добавления.'), onDeleteBox: () => setPendingConfirm({
                                title: 'Удалить короб?',
                                message: `Короб ${selectedBox.boxCode} будет убран из текущих остатков. Его можно будет восстановить из блока удаленных.`,
                                details: [`Единиц: ${selectedBox.totalQuantity}`, `КИЗ: ${selectedBox.kizCount}`],
                                confirmLabel: 'Удалить',
                                action: () => deleteOnlineReceiptBox(session.accessToken, {
                                    clientId,
                                    boxCode: selectedBox.boxCode,
                                    sourceDocument: selectedBox.sourceDocument,
                                }),
                                success: `Короб ${selectedBox.boxCode} удален из остатков.`,
                            }), onStartEdit: startEdit, onCancelEdit: () => setEditingId(''), onEditQuantityChange: setEditQuantity, onEditKizChange: setEditKiz, onSaveEdit: (item) => void saveEdit(item), onDeleteItem: (item) => setPendingConfirm({
                                title: 'Удалить строку приемки?',
                                message: `Позиция ${item.name} будет вычтена из короба ${selectedBox.boxCode}.`,
                                details: [`ШК: ${item.barcode || '-'}`, `Количество: ${item.quantity}`, `КИЗ: ${item.kiz || '-'}`],
                                confirmLabel: 'Удалить строку',
                                action: () => deleteOnlineReceiptItem(session.accessToken, item.movementId),
                                success: 'Строка приемки удалена.',
                            }) })) : (_jsx("p", { className: "warehouse-inline", children: "\u0412\u044B\u0431\u0435\u0440\u0438\u0442\u0435 \u043A\u043E\u0440\u043E\u0431 \u0441\u043B\u0435\u0432\u0430." })) })] }), pendingConfirm ? (_jsx(ConfirmDialog, { title: pendingConfirm.title, message: pendingConfirm.message, details: pendingConfirm.details, confirmLabel: pendingConfirm.confirmLabel, isBusy: isConfirming, onCancel: () => setPendingConfirm(null), onConfirm: () => void runConfirmed() })) : null] }));
}
function DeletedBoxesList({ boxes, onRestore }) {
    return (_jsxs("div", { className: "online-receipts__deleted", children: [_jsxs("div", { className: "warehouse-subheading", children: [_jsx("h3", { children: "\u0423\u0434\u0430\u043B\u0435\u043D\u043D\u044B\u0435 \u043A\u043E\u0440\u043E\u0431\u0430" }), _jsx("span", { children: "\u043C\u043E\u0436\u043D\u043E \u0432\u043E\u0441\u0441\u0442\u0430\u043D\u043E\u0432\u0438\u0442\u044C" })] }), _jsx("div", { className: "online-receipts__box-list", children: boxes.map((box) => (_jsxs("div", { className: "online-receipts__box-row online-receipts__box-row--deleted", children: [_jsxs("button", { type: "button", onClick: () => onRestore(box), children: [_jsx("strong", { children: box.boxCode }), _jsxs("span", { children: ["\u0443\u0434\u0430\u043B\u0435\u043D \u00B7 ", box.totalQuantity, " \u0448\u0442 \u00B7 \u041A\u0418\u0417 ", box.kizCount] }), _jsx("small", { children: box.deletedAt ? `удален ${formatDateTime(box.deletedAt)}` : 'дата удаления не указана' })] }), _jsx("button", { className: "icon-button", type: "button", onClick: () => onRestore(box), title: "\u0412\u043E\u0441\u0441\u0442\u0430\u043D\u043E\u0432\u0438\u0442\u044C \u043A\u043E\u0440\u043E\u0431", children: _jsx(RotateCcw, { size: 15, "aria-hidden": "true" }) })] }, `deleted-${box.key}`))) })] }));
}
function BoxDetails({ box, barcode, quantity, kiz, skuOptions, editingId, editQuantity, editKiz, canManage, onBarcodeChange, onQuantityChange, onKizChange, onAddItem, onCloseBox, onOpenBox, onDeleteBox, onStartEdit, onCancelEdit, onEditQuantityChange, onEditKizChange, onSaveEdit, onDeleteItem, }) {
    const displayedItems = onlineReceiptItemsForDisplay(box);
    return (_jsxs(_Fragment, { children: [_jsxs("div", { className: "online-receipts__detail-head", children: [_jsxs("div", { children: [_jsx("p", { className: "eyebrow", children: "\u041A\u043E\u0440\u043E\u0431" }), _jsx("h3", { children: box.boxCode }), _jsxs("span", { children: [statusLabel(box.status), " \u00B7 ", box.sourceDocuments?.length ? box.sourceDocuments.join(', ') : box.sourceDocument || 'документ не указан'] })] }), canManage ? (_jsxs("div", { className: "online-receipts__box-actions", children: [_jsxs("button", { className: "secondary-button", type: "button", onClick: onOpenBox, children: [_jsx(Unlock, { size: 15, "aria-hidden": "true" }), _jsx("span", { children: "\u041E\u0442\u043A\u0440\u044B\u0442\u044C" })] }), _jsxs("button", { className: "secondary-button", type: "button", onClick: onCloseBox, children: [_jsx(CheckCircle2, { size: 15, "aria-hidden": "true" }), _jsx("span", { children: "\u0417\u0430\u043A\u0440\u044B\u0442\u044C" })] }), _jsxs("button", { className: "danger-button", type: "button", onClick: onDeleteBox, children: [_jsx(Trash2, { size: 15, "aria-hidden": "true" }), _jsx("span", { children: "\u0423\u0434\u0430\u043B\u0438\u0442\u044C" })] })] })) : null] }), canManage ? (_jsxs("div", { className: "online-receipts__add-row", children: [_jsxs("label", { children: [_jsx("span", { children: "\u0428\u041A \u0442\u043E\u0432\u0430\u0440\u0430" }), _jsxs("div", { className: "online-receipts__search", children: [_jsx(Search, { size: 15, "aria-hidden": "true" }), _jsx("input", { list: "online-receipt-skus", value: barcode, onChange: (event) => onBarcodeChange(event.target.value), placeholder: "\u041D\u0430\u0447\u043D\u0438\u0442\u0435 \u0432\u0432\u043E\u0434\u0438\u0442\u044C \u0428\u041A \u0438\u043B\u0438 \u0442\u043E\u0432\u0430\u0440" })] }), _jsx("datalist", { id: "online-receipt-skus", children: skuOptions.map((sku) => (_jsx("option", { value: primaryBarcode(sku), children: [sku.name, sku.article, sku.color, sku.size].filter(Boolean).join(' · ') }, sku.id))) })] }), _jsxs("label", { children: [_jsx("span", { children: "\u041A\u043E\u043B-\u0432\u043E" }), _jsx("input", { type: "number", min: "1", value: quantity, onChange: (event) => onQuantityChange(event.target.value) })] }), _jsxs("label", { children: [_jsx("span", { children: "\u041A\u0418\u0417" }), _jsx("input", { value: kiz, onChange: (event) => onKizChange(event.target.value), placeholder: "\u0415\u0441\u043B\u0438 \u0435\u0441\u0442\u044C" })] }), _jsx("button", { className: "primary-button", type: "button", onClick: onAddItem, children: "\u0414\u043E\u0431\u0430\u0432\u0438\u0442\u044C" })] })) : null, _jsx("div", { className: "online-receipts__table-wrap", children: _jsxs("table", { className: "warehouse-drafts__table online-receipts__table", children: [_jsx("thead", { children: _jsxs("tr", { children: [_jsx("th", { children: "\u0428\u041A" }), _jsx("th", { children: "\u0422\u043E\u0432\u0430\u0440" }), _jsx("th", { children: "\u041A\u0418\u0417" }), _jsx("th", { children: "\u041A\u043E\u043B-\u0432\u043E" }), _jsx("th", { children: "\u041A\u0442\u043E / \u0422\u0421\u0414" }), _jsx("th", { children: "\u0412\u0440\u0435\u043C\u044F" }), canManage ? _jsx("th", { children: "\u0414\u0435\u0439\u0441\u0442\u0432\u0438\u044F" }) : null] }) }), _jsx("tbody", { children: displayedItems.length ? (displayedItems.map((item) => (_jsxs("tr", { className: item.hasError ? 'online-receipts__item-error' : undefined, children: [_jsx("td", { children: item.barcode || '-' }), _jsxs("td", { children: [_jsx("strong", { children: item.name }), _jsx("span", { children: [item.article, item.color, item.size].filter(Boolean).join(' · ') || '-' })] }), _jsx("td", { children: editingId === item.movementId ? (_jsx("input", { value: editKiz, onChange: (event) => onEditKizChange(event.target.value) })) : (_jsxs(_Fragment, { children: [item.kiz || '-', item.hasError ? (_jsxs(_Fragment, { children: [_jsxs("span", { className: "online-receipts__error-note", children: ["\u041E\u0448\u0438\u0431\u043A\u0430 \u043F\u0440\u0438\u0435\u043C\u043A\u0438", item.duplicateBoxCode ? ` · дубль в коробе ${item.duplicateBoxCode}` : ''] }), item.errorMessage ? _jsx("span", { className: "online-receipts__error-detail", children: item.errorMessage }) : null] })) : null] })) }), _jsx("td", { children: editingId === item.movementId ? (_jsx("input", { type: "number", min: "1", value: editQuantity, onChange: (event) => onEditQuantityChange(event.target.value) })) : (item.quantity) }), _jsxs("td", { children: [_jsx("strong", { children: item.operatorName || box.operator || '-' }), _jsx("span", { children: item.deviceCode || box.deviceCode || '-' })] }), _jsx("td", { children: formatDateTime(item.createdAt) }), canManage ? (_jsx("td", { children: item.movementId.startsWith('balance:') ? (_jsx("span", { children: "\u0424\u0430\u043A\u0442\u0438\u0447\u0435\u0441\u043A\u0438\u0439 \u043E\u0441\u0442\u0430\u0442\u043E\u043A" })) : editingId === item.movementId ? (_jsxs("div", { className: "online-receipts__row-actions", children: [_jsx("button", { className: "secondary-button", type: "button", onClick: () => onSaveEdit(item), children: "\u0421\u043E\u0445\u0440\u0430\u043D\u0438\u0442\u044C" }), _jsx("button", { className: "secondary-button", type: "button", onClick: onCancelEdit, children: "\u041E\u0442\u043C\u0435\u043D\u0430" })] })) : (_jsxs("div", { className: "online-receipts__row-actions", children: [_jsx("button", { className: "icon-button", type: "button", onClick: () => onStartEdit(item), title: "\u0418\u0437\u043C\u0435\u043D\u0438\u0442\u044C \u0441\u0442\u0440\u043E\u043A\u0443", children: _jsx(Edit3, { size: 15, "aria-hidden": "true" }) }), _jsx("button", { className: "icon-button danger-icon", type: "button", onClick: () => onDeleteItem(item), title: "\u0423\u0434\u0430\u043B\u0438\u0442\u044C \u0441\u0442\u0440\u043E\u043A\u0443", children: _jsx(Trash2, { size: 15, "aria-hidden": "true" }) })] })) })) : null] }, item.movementId)))) : (_jsx("tr", { children: _jsx("td", { colSpan: canManage ? 7 : 6, children: "\u0412 \u043A\u043E\u0440\u043E\u0431\u0435 \u043F\u043E\u043A\u0430 \u043D\u0435\u0442 \u0441\u0442\u0440\u043E\u043A \u043F\u0440\u0438\u0435\u043C\u043A\u0438." }) })) })] }) })] }));
}
function onlineReceiptItemsForDisplay(box) {
    const currentQuantity = box.currentBalances.reduce((sum, row) => sum + row.quantity, 0);
    const historyQuantity = box.items.reduce((sum, row) => sum + row.quantity, 0);
    if (box.currentBalances.length === 0 || (box.items.length > 0 && currentQuantity === historyQuantity)) {
        return box.items;
    }
    return box.currentBalances.flatMap((balance) => {
        const kizMarks = box.kizValues
            .filter((mark) => mark.skuId === balance.skuId && mark.status === balance.status)
            .sort((left, right) => left.value.localeCompare(right.value));
        const baseItem = {
            movementId: `balance:${balance.balanceId}`,
            skuId: balance.skuId,
            barcode: balance.barcode,
            name: balance.name,
            article: '',
            color: null,
            size: null,
            quantity: balance.quantity,
            kiz: null,
            kizId: null,
            hasError: false,
            errorMessage: null,
            duplicateBoxCode: null,
            status: balance.status,
            sourceDocument: box.sourceDocument,
            createdAt: box.lastSeenAt ?? box.firstSeenAt ?? new Date(0).toISOString(),
            operatorName: box.operator,
            deviceCode: box.deviceCode,
        };
        const markedItems = kizMarks.map((mark) => ({
            ...baseItem,
            movementId: `balance:${balance.balanceId}:kiz:${mark.id}`,
            quantity: 1,
            kiz: mark.value,
            kizId: mark.id,
        }));
        const quantityWithoutKiz = Math.max(0, balance.quantity - kizMarks.length);
        return quantityWithoutKiz > 0
            ? [...markedItems, { ...baseItem, quantity: quantityWithoutKiz }]
            : markedItems;
    });
}
function Stat({ label, value }) {
    return (_jsxs("div", { children: [_jsx("span", { children: label }), _jsx("strong", { children: value.toLocaleString('ru-RU') })] }));
}
function statusLabel(status) {
    const labels = {
        receiving: 'Открыт',
        active: 'Закрыт',
        deleted: 'Удален',
    };
    return labels[status] ?? status;
}
function formatDateTime(value) {
    if (!value) {
        return '-';
    }
    return new Intl.DateTimeFormat('ru-RU', {
        day: '2-digit',
        month: '2-digit',
        year: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
    }).format(new Date(value));
}
function formatBatchDate(value) {
    const [year, month, day] = value.split('-');
    return day && month && year ? `${day}.${month}.${year}` : value;
}
function primaryBarcode(sku) {
    return sku.barcodes.find((barcode) => barcode.isPrimary)?.value ?? sku.barcodes[0]?.value ?? '';
}
function canUse(user, permission) {
    return user.permissionCodes.includes('system:admin') || user.permissionCodes.includes(permission);
}
