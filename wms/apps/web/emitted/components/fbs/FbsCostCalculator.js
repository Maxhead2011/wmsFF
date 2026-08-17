import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
import { Boxes, Calculator, PackageCheck, Percent, Sticker, Truck } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { fetchFbsCalculatorDestinations, fetchLogisticsTariffSet, fetchLogisticsTariffSets, quoteFbsCalculator, quoteLogistics, } from '../../lib/api';
const MAX_QUANTITY = 3000;
const ITEMS_PER_BOX = 14;
const BOXES_PER_PALLET = 16;
const SPECIAL_DESTINATIONS = ['Внуково', 'Кавказский Бульвар'];
const moneyFormatter = new Intl.NumberFormat('ru-RU', {
    style: 'currency',
    currency: 'RUB',
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
});
export function FbsCostCalculator({ session, isAdmin }) {
    const [quantityValue, setQuantityValue] = useState('');
    const [result, setResult] = useState(null);
    const [error, setError] = useState('');
    const [tariffSets, setTariffSets] = useState([]);
    const [tariffSetId, setTariffSetId] = useState('');
    const [tariffDetail, setTariffDetail] = useState(null);
    const [clientDestinations, setClientDestinations] = useState([]);
    const [destination, setDestination] = useState('');
    const [isLoadingTariffs, setLoadingTariffs] = useState(false);
    const [isCalculating, setCalculating] = useState(false);
    useEffect(() => {
        if (isAdmin)
            return;
        let active = true;
        setLoadingTariffs(true);
        void fetchFbsCalculatorDestinations(session.accessToken)
            .then(({ destinations }) => {
            if (!active)
                return;
            setClientDestinations(destinations);
            setDestination((current) => current || destinations[0] || '');
        })
            .catch((caught) => {
            if (!active)
                return;
            setError(caught instanceof Error ? caught.message : 'Не удалось загрузить список городов.');
        })
            .finally(() => {
            if (active)
                setLoadingTariffs(false);
        });
        return () => {
            active = false;
        };
    }, [isAdmin, session.accessToken]);
    useEffect(() => {
        if (!isAdmin)
            return;
        let active = true;
        setLoadingTariffs(true);
        void fetchLogisticsTariffSets(session.accessToken)
            .then((rows) => {
            if (!active)
                return;
            setTariffSets(rows);
            setTariffSetId((current) => current || rows[0]?.id || '');
        })
            .catch((caught) => {
            if (!active)
                return;
            setError(caught instanceof Error ? caught.message : 'Не удалось загрузить тарифы логистики.');
        })
            .finally(() => {
            if (active)
                setLoadingTariffs(false);
        });
        return () => {
            active = false;
        };
    }, [isAdmin, session.accessToken]);
    useEffect(() => {
        if (!isAdmin || !tariffSetId) {
            setTariffDetail(null);
            setDestination('');
            return;
        }
        let active = true;
        setLoadingTariffs(true);
        setResult(null);
        void fetchLogisticsTariffSet(session.accessToken, tariffSetId)
            .then((detail) => {
            if (!active)
                return;
            setTariffDetail(detail);
            const options = buildDestinationOptions(detail);
            setDestination((current) => options.some((option) => normalizeLogisticsPoint(option) === normalizeLogisticsPoint(current))
                ? current
                : options[0] || '');
        })
            .catch((caught) => {
            if (!active)
                return;
            setTariffDetail(null);
            setDestination('');
            setError(caught instanceof Error ? caught.message : 'Не удалось загрузить города из тарифа.');
        })
            .finally(() => {
            if (active)
                setLoadingTariffs(false);
        });
        return () => {
            active = false;
        };
    }, [isAdmin, session.accessToken, tariffSetId]);
    const destinationOptions = useMemo(() => (isAdmin ? buildDestinationOptions(tariffDetail) : clientDestinations), [clientDestinations, isAdmin, tariffDetail]);
    async function calculate(event) {
        event.preventDefault();
        const quantity = Number(quantityValue.trim());
        if (quantityValue.trim() === '' ||
            !Number.isInteger(quantity) ||
            quantity < 1 ||
            quantity > MAX_QUANTITY) {
            setError('Введите целое количество товаров от 1 до 3 000.');
            setResult(null);
            return;
        }
        if (!destination) {
            setError('Выберите город доставки.');
            setResult(null);
            return;
        }
        if (!isAdmin) {
            setCalculating(true);
            setError('');
            setResult(null);
            try {
                const calculation = await quoteFbsCalculator(session.accessToken, { quantity, destination });
                if (calculation.totalWithTax == null || calculation.requiresManualReview) {
                    throw new Error('Для выбранного города стоимость требует ручного расчёта.');
                }
                setResult({
                    mode: 'client',
                    destination: calculation.destination,
                    totalWithTax: calculation.totalWithTax,
                });
            }
            catch (caught) {
                setError(caught instanceof Error ? caught.message : 'Не удалось рассчитать выбранный город.');
            }
            finally {
                setCalculating(false);
            }
            return;
        }
        if (!tariffSetId) {
            setError('Выберите набор тарифов логистики.');
            setResult(null);
            return;
        }
        setCalculating(true);
        setError('');
        setResult(null);
        try {
            const services = calculateServices(quantity);
            const specialCalculation = calculateSpecialDirection(quantity, destination, services);
            if (specialCalculation) {
                setResult({
                    mode: 'admin',
                    quantity,
                    services,
                    calculation: specialCalculation,
                    destination,
                    tariffName: 'Специальный тариф FBS',
                });
                return;
            }
            const logistics = await quoteLogistics(session.accessToken, {
                tariffSetId,
                destination,
                boxes: services.boxesCount,
            });
            if (logistics.estimatedTotalRub == null) {
                throw new Error('Для выбранного города тариф требует ручного расчёта логистики.');
            }
            setResult({
                mode: 'admin',
                quantity,
                services,
                calculation: calculateQuotedDirection(services, logistics),
                destination: logistics.route.destination,
                tariffName: logistics.tariffSet.name,
            });
        }
        catch (caught) {
            setError(caught instanceof Error ? caught.message : 'Не удалось рассчитать выбранный город.');
        }
        finally {
            setCalculating(false);
        }
    }
    function updateQuantity(value) {
        setQuantityValue(value);
        setError('');
        setResult(null);
    }
    return (_jsxs("div", { className: `fbs-calculator${isAdmin ? ' fbs-calculator--admin' : ' fbs-calculator--client'}`, children: [_jsxs("section", { className: "fbs-calculator__input-card", children: [_jsxs("div", { className: "fbs-calculator__intro", children: [_jsx("span", { children: _jsx(Calculator, { size: 25, "aria-hidden": "true" }) }), _jsxs("div", { children: [_jsx("p", { className: "eyebrow", children: "\u041F\u0440\u0435\u0434\u0432\u0430\u0440\u0438\u0442\u0435\u043B\u044C\u043D\u0430\u044F \u0441\u0442\u043E\u0438\u043C\u043E\u0441\u0442\u044C" }), _jsx("h4", { children: "\u0420\u0430\u0441\u0441\u0447\u0438\u0442\u0430\u0439\u0442\u0435 \u043F\u0430\u0440\u0442\u0438\u044E FBS" }), _jsx("p", { children: isAdmin
                                            ? 'Выберите город из действующих тарифов WMS — логистика автоматически войдёт в расчёт.'
                                            : 'Укажите количество товаров. В результате будет показана только итоговая стоимость с налогом.' })] })] }), _jsxs("form", { className: `fbs-calculator__form${isAdmin ? ' fbs-calculator__form--admin' : ' fbs-calculator__form--client'}`, onSubmit: calculate, noValidate: true, children: [_jsxs("label", { htmlFor: "fbs-calculator-quantity", children: [_jsx("span", { children: "\u041A\u043E\u043B\u0438\u0447\u0435\u0441\u0442\u0432\u043E \u0442\u043E\u0432\u0430\u0440\u043E\u0432, \u0435\u0434." }), _jsx("input", { id: "fbs-calculator-quantity", type: "number", min: "1", max: MAX_QUANTITY, step: "1", inputMode: "numeric", value: quantityValue, onChange: (event) => updateQuantity(event.target.value), placeholder: "\u041E\u0442 1 \u0434\u043E 3000", required: true })] }), isAdmin ? (_jsx(_Fragment, { children: _jsxs("label", { htmlFor: "fbs-calculator-tariff", children: [_jsx("span", { children: "\u041D\u0430\u0431\u043E\u0440 \u0442\u0430\u0440\u0438\u0444\u043E\u0432 \u043B\u043E\u0433\u0438\u0441\u0442\u0438\u043A\u0438" }), _jsxs("select", { id: "fbs-calculator-tariff", value: tariffSetId, onChange: (event) => {
                                                setTariffSetId(event.target.value);
                                                setResult(null);
                                                setError('');
                                            }, disabled: isLoadingTariffs, required: true, children: [_jsx("option", { value: "", children: "\u0412\u044B\u0431\u0435\u0440\u0438\u0442\u0435 \u0442\u0430\u0440\u0438\u0444" }), tariffSets.map((tariff) => (_jsx("option", { value: tariff.id, children: tariff.name }, tariff.id)))] })] }) })) : null, _jsxs("label", { htmlFor: "fbs-calculator-city", children: [_jsx("span", { children: "\u0413\u043E\u0440\u043E\u0434 \u0434\u043E\u0441\u0442\u0430\u0432\u043A\u0438" }), _jsxs("select", { id: "fbs-calculator-city", value: destination, onChange: (event) => {
                                            setDestination(event.target.value);
                                            setResult(null);
                                            setError('');
                                        }, disabled: isLoadingTariffs || destinationOptions.length === 0, required: true, children: [_jsx("option", { value: "", children: "\u0412\u044B\u0431\u0435\u0440\u0438\u0442\u0435 \u0433\u043E\u0440\u043E\u0434" }), destinationOptions.map((city) => (_jsx("option", { value: city, children: city }, normalizeLogisticsPoint(city))))] })] }), _jsxs("button", { type: "submit", disabled: isCalculating || (isAdmin && isLoadingTariffs), children: [_jsx(Calculator, { size: 18, "aria-hidden": "true" }), isCalculating ? 'Рассчитываю' : 'Рассчитать стоимость'] })] }), error ? _jsx("p", { className: "fbs-calculator__error", role: "alert", children: error }) : null, isAdmin ? (_jsxs("div", { className: "fbs-calculator__rules", children: [_jsx(CalculationRule, { icon: PackageCheck, label: "\u041E\u0431\u0440\u0430\u0431\u043E\u0442\u043A\u0430", value: "10 \u20BD / \u0435\u0434." }), _jsx(CalculationRule, { icon: Sticker, label: "\u0421\u0442\u0438\u043A\u0435\u0440", value: "3 \u20BD / \u0435\u0434." }), _jsx(CalculationRule, { icon: Boxes, label: "\u0412\u043C\u0435\u0441\u0442\u0438\u043C\u043E\u0441\u0442\u044C", value: "14 \u0435\u0434. / \u043A\u043E\u0440\u043E\u0431" }), _jsx(CalculationRule, { icon: Percent, label: "\u041D\u0430\u0446\u0435\u043D\u043A\u0430", value: "50%" })] })) : null] }), result?.mode === 'client' ? (_jsx("section", { className: "fbs-calculator__client-results", "aria-live": "polite", children: _jsx(ClientTotal, { name: result.destination, value: result.totalWithTax }) })) : result?.mode === 'admin' ? (_jsxs("section", { className: "fbs-calculator__results", "aria-live": "polite", children: [_jsxs("div", { className: "fbs-calculator__summary", children: [_jsxs("div", { children: [_jsx("span", { children: "\u0422\u043E\u0432\u0430\u0440\u043E\u0432" }), _jsx("strong", { children: formatNumber(result.quantity) })] }), _jsxs("div", { children: [_jsx("span", { children: "\u041A\u043E\u0440\u043E\u0431\u043E\u0432" }), _jsx("strong", { children: formatNumber(result.services.boxesCount) })] }), _jsxs("div", { children: [_jsx("span", { children: "\u0422\u0430\u0440\u0438\u0444 WMS" }), _jsx("strong", { children: result.tariffName })] })] }), _jsx("div", { className: "fbs-calculator__directions fbs-calculator__directions--single", children: _jsx(DirectionResult, { name: result.destination, tone: "blue", calculation: result.calculation }) }), _jsxs("details", { className: "fbs-calculator__breakdown", children: [_jsx("summary", { children: "\u041F\u043E\u043A\u0430\u0437\u0430\u0442\u044C \u0440\u0430\u0441\u0447\u0451\u0442 \u0443\u0441\u043B\u0443\u0433" }), _jsxs("div", { children: [_jsx(BreakdownRow, { label: `Обработка · ${formatNumber(result.quantity)} ед.`, value: result.services.processingCost }), _jsx(BreakdownRow, { label: `Стикеры · ${formatNumber(result.quantity)} ед.`, value: result.services.stickersCost }), _jsx(BreakdownRow, { label: `Короба · ${formatNumber(result.services.boxesCount)} шт.`, value: result.services.boxesCost }), _jsx(BreakdownRow, { label: `Формирование коробов · ${formatNumber(result.services.boxesCount)} шт.`, value: result.services.assemblyCost }), _jsx(BreakdownRow, { label: "\u0423\u0441\u043B\u0443\u0433\u0438 \u0434\u043E \u043D\u0430\u0446\u0435\u043D\u043A\u0438", value: result.services.servicesCost }), _jsx(BreakdownRow, { label: "\u0423\u0441\u043B\u0443\u0433\u0438 \u0441 \u043D\u0430\u0446\u0435\u043D\u043A\u043E\u0439 50%", value: result.services.servicesWithMarkup, total: true })] })] })] })) : (_jsxs("section", { className: "fbs-calculator__placeholder", children: [_jsx("span", { children: _jsx(Truck, { size: 30, "aria-hidden": "true" }) }), _jsxs("div", { children: [_jsx("strong", { children: "\u0420\u0435\u0437\u0443\u043B\u044C\u0442\u0430\u0442 \u043F\u043E\u044F\u0432\u0438\u0442\u0441\u044F \u0437\u0434\u0435\u0441\u044C" }), _jsx("p", { children: isAdmin
                                    ? 'Калькулятор возьмёт стоимость логистики для выбранного города из тарифов WMS.'
                                    : 'После расчёта здесь будет показана только итоговая стоимость с налогом.' })] })] }))] }));
}
function ClientTotal({ name, value }) {
    return (_jsxs("article", { children: [_jsx("small", { children: name }), _jsx("span", { children: "\u0421\u0442\u043E\u0438\u043C\u043E\u0441\u0442\u044C \u0441 \u043D\u0430\u043B\u043E\u0433\u043E\u043C" }), _jsx("strong", { children: formatMoney(value) })] }));
}
function CalculationRule({ icon: Icon, label, value, }) {
    return (_jsxs("div", { children: [_jsx(Icon, { size: 17, "aria-hidden": "true" }), _jsx("span", { children: label }), _jsx("strong", { children: value })] }));
}
function DirectionResult({ name, tone, calculation, }) {
    return (_jsxs("article", { className: `fbs-calculator-direction fbs-calculator-direction--${tone}`, children: [_jsxs("header", { children: [_jsx("span", { children: _jsx(Truck, { size: 19, "aria-hidden": "true" }) }), _jsxs("div", { children: [_jsx("small", { children: "\u041D\u0430\u043F\u0440\u0430\u0432\u043B\u0435\u043D\u0438\u0435" }), _jsx("strong", { children: name })] })] }), _jsxs("div", { className: "fbs-calculator-direction__total", children: [_jsx("span", { children: "\u0418\u0442\u043E\u0433\u043E\u0432\u0430\u044F \u0441\u0442\u043E\u0438\u043C\u043E\u0441\u0442\u044C \u0441 \u043D\u0430\u043B\u043E\u0433\u043E\u043C" }), _jsx("strong", { children: formatMoney(calculation.totalWithTax) })] }), _jsxs("dl", { children: [_jsxs("div", { children: [_jsx("dt", { children: "\u041A\u043E\u0440\u043E\u0431\u043E\u0432" }), _jsx("dd", { children: formatNumber(calculation.boxesCount) })] }), calculation.deliveryType === 'pallet' ? (_jsxs(_Fragment, { children: [_jsxs("div", { children: [_jsx("dt", { children: "\u041F\u0430\u043B\u043B\u0435\u0442" }), _jsx("dd", { children: formatNumber(calculation.palletsCount) })] }), _jsxs("div", { children: [_jsx("dt", { children: "\u0426\u0435\u043D\u0430 \u0437\u0430 \u043F\u0430\u043B\u043B\u0435\u0442\u0443" }), _jsx("dd", { children: formatMoney(calculation.palletPrice) })] })] })) : (_jsxs("div", { children: [_jsx("dt", { children: "\u0422\u0438\u043F \u043B\u043E\u0433\u0438\u0441\u0442\u0438\u043A\u0438" }), _jsx("dd", { children: "\u0422\u0430\u0440\u0438\u0444 WMS" })] })), _jsxs("div", { children: [_jsx("dt", { children: "\u041B\u043E\u0433\u0438\u0441\u0442\u0438\u043A\u0430 \u0431\u0435\u0437 \u043D\u0430\u043B\u043E\u0433\u0430" }), _jsx("dd", { children: formatMoney(calculation.deliveryPrice) })] }), _jsxs("div", { children: [_jsx("dt", { children: "\u041D\u0430\u043B\u043E\u0433 \u043D\u0430 \u043B\u043E\u0433\u0438\u0441\u0442\u0438\u043A\u0443" }), _jsx("dd", { children: formatMoney(calculation.deliveryTax) })] }), _jsxs("div", { children: [_jsx("dt", { children: "\u041B\u043E\u0433\u0438\u0441\u0442\u0438\u043A\u0430 \u0441 \u043D\u0430\u043B\u043E\u0433\u043E\u043C" }), _jsx("dd", { children: formatMoney(calculation.deliveryWithTax) })] })] })] }));
}
function BreakdownRow({ label, value, total = false }) {
    return (_jsxs("div", { className: total ? 'is-total' : undefined, children: [_jsx("span", { children: label }), _jsx("strong", { children: formatMoney(value) })] }));
}
function calculateServices(quantity) {
    const boxesCount = Math.ceil(quantity / ITEMS_PER_BOX);
    const processingCost = quantity * 10;
    const stickersCost = quantity * 3;
    const boxesCost = boxesCount * 100;
    const assemblyCost = boxesCount * 40;
    const servicesCost = processingCost + stickersCost + boxesCost + assemblyCost;
    return {
        processingCost,
        stickersCost,
        boxesCost,
        assemblyCost,
        boxesCount,
        servicesCost,
        servicesWithMarkup: servicesCost * 1.5,
    };
}
function calculateSpecialDirection(quantity, destination, services) {
    const normalized = normalizeLogisticsPoint(destination).replace(/ё/g, 'е');
    const isVnukovo = normalized.includes('внуково');
    const isKavkaz = normalized.includes('кавказ');
    if (!isVnukovo && !isKavkaz)
        return null;
    let palletsCount = 0;
    let palletPrice = 0;
    let deliveryPrice = isVnukovo ? 1500 : 3000;
    let deliveryType = 'fixed';
    if (quantity > 1000) {
        palletsCount = Math.ceil(services.boxesCount / BOXES_PER_PALLET);
        palletPrice = isVnukovo
            ? palletsCount <= 2
                ? 1500
                : 1200
            : getKavkazPalletPrice(palletsCount);
        deliveryPrice = palletsCount * palletPrice;
        deliveryType = 'pallet';
    }
    return buildDirectionCalculation(services, deliveryPrice, palletsCount, palletPrice, deliveryType);
}
function getKavkazPalletPrice(palletsCount) {
    if (palletsCount === 1)
        return 3500;
    if (palletsCount === 2)
        return 3000;
    if (palletsCount === 3)
        return 2800;
    if (palletsCount === 4)
        return 2500;
    if (palletsCount === 5)
        return 2300;
    if (palletsCount === 6)
        return 2200;
    return 2000;
}
function calculateQuotedDirection(services, logistics) {
    const deliveryPrice = Number(logistics.estimatedTotalRub ?? 0);
    const palletsCount = Number(logistics.input.pallets ?? 0);
    const deliveryType = palletsCount > 0 ? 'pallet' : 'fixed';
    const palletPrice = palletsCount > 0 ? deliveryPrice / palletsCount : 0;
    return buildDirectionCalculation(services, deliveryPrice, palletsCount, palletPrice, deliveryType);
}
function buildDirectionCalculation(services, deliveryPrice, palletsCount, palletPrice, deliveryType) {
    const deliveryWithTax = addTax(deliveryPrice);
    const deliveryTax = deliveryWithTax - deliveryPrice;
    return {
        totalWithTax: addTax(services.servicesWithMarkup + deliveryPrice),
        boxesCount: services.boxesCount,
        palletsCount,
        palletPrice,
        deliveryPrice,
        deliveryTax,
        deliveryWithTax,
        deliveryType,
    };
}
function addTax(amount) {
    return (amount / 94) * 100;
}
function buildDestinationOptions(tariffSet) {
    if (!tariffSet)
        return [];
    const moscowDirections = tariffSet.directions.filter((direction) => isMoscowOrigin(direction.origin));
    const source = moscowDirections.length > 0 ? moscowDirections : tariffSet.directions;
    const options = new Map();
    source.forEach((direction) => {
        const city = direction.destination.trim();
        if (city)
            options.set(normalizeLogisticsPoint(city), city);
    });
    SPECIAL_DESTINATIONS.forEach((city) => options.set(normalizeLogisticsPoint(city), city));
    return [...options.values()].sort((left, right) => left.localeCompare(right, 'ru'));
}
function isMoscowOrigin(origin) {
    const normalized = normalizeLogisticsPoint(origin);
    return normalized === 'москва' || normalized === 'moscow';
}
function normalizeLogisticsPoint(value) {
    return value.toLowerCase().replace(/\s*,\s*/g, ', ').replace(/\s+/g, ' ').trim();
}
function formatMoney(value) {
    return moneyFormatter.format(value);
}
function formatNumber(value) {
    return new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 0 }).format(value);
}
