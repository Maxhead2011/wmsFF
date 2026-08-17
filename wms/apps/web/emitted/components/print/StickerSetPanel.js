import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { Barcode, FileText, Printer, QrCode, Save } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { createLabelTemplate, createPrintJobFromTemplate, fetchClients, fetchPrintPrinters, previewLabelTemplate, } from '../../lib/api';
import { printB1Stickers } from './niimbotBrowser';
import { TsplPreviewCard } from './TsplPreviewCard';
const NIIMBOT_BROWSER_CODE = 'NIIMBOT_B1_BROWSER';
export function StickerSetPanel({ session }) {
    const [clients, setClients] = useState([]);
    const [printers, setPrinters] = useState([]);
    const [clientId, setClientId] = useState('');
    const [name, setName] = useState('Короба с QR');
    const [prefix, setPrefix] = useState('FFL_LKB0101_');
    const [start, setStart] = useState('1');
    const [count, setCount] = useState('10');
    const [width, setWidth] = useState('50');
    const [height, setHeight] = useState('30');
    const [font, setFont] = useState('3');
    const [topText, setTopText] = useState('');
    const [bottomText, setBottomText] = useState('');
    const [barcodeEnabled, setBarcodeEnabled] = useState(true);
    const [qrEnabled, setQrEnabled] = useState(true);
    const [qrX, setQrX] = useState('20');
    const [qrY, setQrY] = useState('82');
    const [barcodeX, setBarcodeX] = useState('180');
    const [barcodeY, setBarcodeY] = useState('88');
    const [numberY, setNumberY] = useState('230');
    const [printerCode, setPrinterCode] = useState('');
    const [preview, setPreview] = useState(null);
    const [message, setMessage] = useState('');
    const [error, setError] = useState('');
    const [isWorking, setWorking] = useState(false);
    const client = useMemo(() => clients.find((item) => item.id === clientId) ?? null, [clientId, clients]);
    const values = useMemo(() => sequence(prefix, start, count), [prefix, start, count]);
    const availablePrinters = useMemo(() => [{ id: NIIMBOT_BROWSER_CODE, code: NIIMBOT_BROWSER_CODE, name: 'NIIMBOT B1 · Bluetooth этого ноутбука' }, ...printers], [printers]);
    useEffect(() => {
        Promise.all([fetchClients(session.accessToken), fetchPrintPrinters(session.accessToken)])
            .then(([nextClients, nextPrinters]) => {
            setClients(nextClients);
            setPrinters(nextPrinters.filter((printer) => printer.isActive));
            setClientId((current) => current || nextClients[0]?.id || '');
            setPrinterCode((current) => current || NIIMBOT_BROWSER_CODE);
        })
            .catch((caught) => setError(caught instanceof Error ? caught.message : 'Не удалось загрузить клиентов или принтеры.'));
    }, [session.accessToken]);
    useEffect(() => {
        const printer = printers.find((item) => item.code === printerCode);
        if (!printer && printerCode !== NIIMBOT_BROWSER_CODE)
            return;
        const isNiimbot = printerCode === NIIMBOT_BROWSER_CODE || `${printer?.code ?? ''} ${printer?.name ?? ''}`.toUpperCase().includes('NIIMBOT');
        setWidth(isNiimbot ? '50' : '58');
        setHeight(isNiimbot ? '30' : '40');
    }, [printerCode, printers]);
    async function createSet(mode) {
        if (!client || values.length === 0)
            return;
        setWorking(true);
        setError('');
        setMessage('');
        setPreview(null);
        try {
            const template = await createLabelTemplate(session.accessToken, {
                code: `SET_${Date.now().toString(36)}`,
                name: `${client.name} · ${name}`.slice(0, 120),
                type: 'CUSTOM',
                description: `Набор стикеров клиента ${client.name}. Префикс: ${prefix}`,
                widthMm: positive(width, 50),
                heightMm: positive(height, 30),
                tspl: buildTspl({ width: positive(width, 50), height: positive(height, 30), font: positive(font, 3), barcodeEnabled, qrEnabled, topText, bottomText, qrX: coordinate(qrX, 20), qrY: coordinate(qrY, 82), barcodeX: coordinate(barcodeX, 180), barcodeY: coordinate(barcodeY, 88), numberY: coordinate(numberY, 230) }),
                isActive: true,
            });
            const firstVariables = stickerVariables(client.name, values[0], topText, bottomText);
            if (mode === 'preview') {
                setPreview(await previewLabelTemplate(session.accessToken, template.id, { variables: firstVariables }));
                setMessage(`Набор сохранён. Предпросмотр первого стикера: ${values[0]}.`);
            }
            else {
                if (!printerCode)
                    throw new Error('Выберите принтер.');
                if (printerCode === NIIMBOT_BROWSER_CODE) {
                    await printB1Stickers(values.map((value) => ({
                        clientName: client.name,
                        value,
                        topText,
                        bottomText,
                        fontSize: positive(font, 3),
                        barcodeEnabled,
                        qrEnabled,
                        qrX: coordinate(qrX, 20),
                        qrY: coordinate(qrY, 82),
                        barcodeX: coordinate(barcodeX, 180),
                        barcodeY: coordinate(barcodeY, 88),
                        numberY: coordinate(numberY, 190),
                    })), setMessage);
                    setMessage(`NIIMBOT B1 напечатал ${values.length} стикеров: от ${values[0]} до ${values[values.length - 1]}.`);
                    return;
                }
                for (const value of values) {
                    await createPrintJobFromTemplate(session.accessToken, template.id, { printerCode, variables: stickerVariables(client.name, value, topText, bottomText), copies: 1 });
                }
                setMessage(`В очередь отправлено ${values.length} стикеров: от ${values[0]} до ${values[values.length - 1]}.`);
            }
        }
        catch (caught) {
            setError(caught instanceof Error ? caught.message : 'Не удалось создать набор стикеров.');
        }
        finally {
            setWorking(false);
        }
    }
    return _jsxs("section", { className: "sticker-set", "aria-label": "\u041D\u0430\u0431\u043E\u0440 \u0441\u0442\u0438\u043A\u0435\u0440\u043E\u0432", children: [_jsxs("header", { children: [_jsxs("div", { children: [_jsx("p", { className: "eyebrow", children: "\u041D\u0430\u0431\u043E\u0440\u044B \u0441\u0442\u0438\u043A\u0435\u0440\u043E\u0432" }), _jsx("h3", { children: "\u0421\u0435\u0440\u0438\u0439\u043D\u0430\u044F \u043F\u0435\u0447\u0430\u0442\u044C \u043A\u043E\u0440\u043E\u0431\u043E\u0432" }), _jsx("span", { children: "\u041D\u0430\u0431\u043E\u0440 \u0441\u043E\u0445\u0440\u0430\u043D\u044F\u0435\u0442\u0441\u044F \u043A\u0430\u043A \u0448\u0430\u0431\u043B\u043E\u043D \u043A\u043B\u0438\u0435\u043D\u0442\u0430; \u043A\u0430\u0436\u0434\u044B\u0439 \u043D\u043E\u043C\u0435\u0440 \u043F\u043E\u043B\u0443\u0447\u0430\u0435\u0442 \u0441\u043E\u0431\u0441\u0442\u0432\u0435\u043D\u043D\u044B\u0439 \u0428\u041A \u0438 QR." })] }), _jsx(Printer, { size: 20 })] }), _jsxs("div", { className: "sticker-set__grid", children: [_jsxs("label", { children: [_jsx("span", { children: "\u041A\u043B\u0438\u0435\u043D\u0442" }), _jsx("select", { value: clientId, onChange: (event) => setClientId(event.target.value), children: clients.map((item) => _jsxs("option", { value: item.id, children: [item.code, " \u00B7 ", item.name] }, item.id)) })] }), _jsxs("label", { children: [_jsx("span", { children: "\u041D\u0430\u0437\u0432\u0430\u043D\u0438\u0435 \u043D\u0430\u0431\u043E\u0440\u0430" }), _jsx("input", { value: name, onChange: (event) => setName(event.target.value) })] }), _jsxs("label", { children: [_jsx("span", { children: "\u041F\u0440\u0435\u0444\u0438\u043A\u0441 \u043D\u043E\u043C\u0435\u0440\u0430" }), _jsx("input", { value: prefix, onChange: (event) => setPrefix(event.target.value), placeholder: "FFL_LKB0101_" })] }), _jsxs("label", { children: [_jsx("span", { children: "\u041D\u0430\u0447\u0430\u0442\u044C \u0441" }), _jsx("input", { min: "0", type: "number", value: start, onChange: (event) => setStart(event.target.value) })] }), _jsxs("label", { children: [_jsx("span", { children: "\u0421\u043A\u043E\u043B\u044C\u043A\u043E \u0441\u0442\u0438\u043A\u0435\u0440\u043E\u0432" }), _jsx("input", { min: "1", max: "500", type: "number", value: count, onChange: (event) => setCount(event.target.value) })] }), _jsxs("label", { children: [_jsx("span", { children: "\u041F\u0440\u0438\u043D\u0442\u0435\u0440" }), _jsxs("select", { value: printerCode, onChange: (event) => setPrinterCode(event.target.value), children: [_jsx("option", { value: "", children: "\u0412\u044B\u0431\u0435\u0440\u0438\u0442\u0435 \u043F\u0440\u0438\u043D\u0442\u0435\u0440" }), availablePrinters.map((item) => _jsx("option", { value: item.code, children: item.code === NIIMBOT_BROWSER_CODE ? item.name : `${item.code} · ${item.name}` }, item.id))] })] })] }), printerCode === NIIMBOT_BROWSER_CODE ? _jsx("p", { className: "sticker-set__browser-note", children: "\u041F\u0435\u0447\u0430\u0442\u044C \u043D\u0430\u043F\u0440\u044F\u043C\u0443\u044E \u0441 \u044D\u0442\u043E\u0433\u043E \u043D\u043E\u0443\u0442\u0431\u0443\u043A\u0430: \u0432\u043A\u043B\u044E\u0447\u0438\u0442\u0435 NIIMBOT B1, \u043E\u0442\u043A\u0440\u043E\u0439\u0442\u0435 WMS \u0432 Chrome \u0438\u043B\u0438 Edge \u0438 \u043D\u0430\u0436\u043C\u0438\u0442\u0435 \u00AB\u041D\u0430\u043F\u0435\u0447\u0430\u0442\u0430\u0442\u044C\u00BB. \u0411\u0440\u0430\u0443\u0437\u0435\u0440 \u043F\u043E\u043F\u0440\u043E\u0441\u0438\u0442 \u0432\u044B\u0431\u0440\u0430\u0442\u044C \u043F\u0440\u0438\u043D\u0442\u0435\u0440 \u043E\u0434\u0438\u043D \u0440\u0430\u0437." }) : null, _jsxs("div", { className: "sticker-set__design", children: [_jsxs("label", { children: [_jsx("span", { children: "\u0428\u0438\u0440\u0438\u043D\u0430, \u043C\u043C" }), _jsx("input", { min: "20", max: "100", type: "number", value: width, onChange: (event) => setWidth(event.target.value) })] }), _jsxs("label", { children: [_jsx("span", { children: "\u0412\u044B\u0441\u043E\u0442\u0430, \u043C\u043C" }), _jsx("input", { min: "20", max: "100", type: "number", value: height, onChange: (event) => setHeight(event.target.value) })] }), _jsxs("label", { children: [_jsx("span", { children: "\u0420\u0430\u0437\u043C\u0435\u0440 \u0448\u0440\u0438\u0444\u0442\u0430" }), _jsx("input", { min: "1", max: "10", type: "number", value: font, onChange: (event) => setFont(event.target.value) })] }), _jsxs("label", { children: [_jsx("span", { children: "\u0422\u0435\u043A\u0441\u0442 \u0441\u0432\u0435\u0440\u0445\u0443" }), _jsx("input", { value: topText, onChange: (event) => setTopText(event.target.value), placeholder: "\u041D\u0430\u043F\u0440\u0438\u043C\u0435\u0440: \u041A\u043E\u0440\u043E\u0431 \u043A\u043B\u0438\u0435\u043D\u0442\u0430" })] }), _jsxs("label", { children: [_jsx("span", { children: "\u0422\u0435\u043A\u0441\u0442 \u0441\u043D\u0438\u0437\u0443" }), _jsx("input", { value: bottomText, onChange: (event) => setBottomText(event.target.value), placeholder: "\u041D\u0430\u043F\u0440\u0438\u043C\u0435\u0440: \u041C\u043E\u0441\u043A\u0432\u0430" })] }), _jsxs("label", { className: "sticker-set__switch", children: [_jsx("input", { type: "checkbox", checked: barcodeEnabled, onChange: (event) => setBarcodeEnabled(event.target.checked) }), _jsx(Barcode, { size: 16 }), "\u0428\u0442\u0440\u0438\u0445\u043A\u043E\u0434"] }), _jsxs("label", { className: "sticker-set__switch", children: [_jsx("input", { type: "checkbox", checked: qrEnabled, onChange: (event) => setQrEnabled(event.target.checked) }), _jsx(QrCode, { size: 16 }), "QR-\u043A\u043E\u0434"] })] }), _jsxs("div", { className: "sticker-set__editor", children: [_jsxs("div", { className: "sticker-set__canvas", style: { aspectRatio: `${positive(width, 50)} / ${positive(height, 30)}` }, children: [_jsx("small", { className: "sticker-set__canvas-client", children: client?.name ?? 'Клиент' }), topText ? _jsx("b", { className: "sticker-set__canvas-top", children: topText }) : null, qrEnabled ? _jsx("span", { className: "sticker-set__canvas-qr", style: { left: `${Math.min(76, coordinate(qrX, 20) / 5)}%`, top: `${Math.min(70, coordinate(qrY, 82) / 4)}%` }, children: "\u25A6" }) : null, barcodeEnabled ? _jsx("span", { className: "sticker-set__canvas-barcode", style: { left: `${Math.min(65, coordinate(barcodeX, 180) / 5)}%`, top: `${Math.min(70, coordinate(barcodeY, 88) / 4)}%` }, children: "|||||||||" }) : null, _jsx("strong", { className: "sticker-set__canvas-number", style: { top: `${Math.min(82, coordinate(numberY, 230) / 4)}%`, fontSize: `${Math.min(18, 7 + positive(font, 3) * 2)}px` }, children: values[0] ?? 'Номер' }), bottomText ? _jsx("em", { children: bottomText }) : null] }), _jsxs("div", { className: "sticker-set__positions", children: [_jsx("b", { children: "\u041F\u043E\u043B\u043E\u0436\u0435\u043D\u0438\u0435 \u044D\u043B\u0435\u043C\u0435\u043D\u0442\u043E\u0432, \u0442\u043E\u0447\u043A\u0438 \u043F\u0440\u0438\u043D\u0442\u0435\u0440\u0430" }), _jsxs("label", { children: ["QR X", _jsx("input", { type: "number", value: qrX, onChange: (e) => setQrX(e.target.value) })] }), _jsxs("label", { children: ["QR Y", _jsx("input", { type: "number", value: qrY, onChange: (e) => setQrY(e.target.value) })] }), _jsxs("label", { children: ["\u0428\u041A X", _jsx("input", { type: "number", value: barcodeX, onChange: (e) => setBarcodeX(e.target.value) })] }), _jsxs("label", { children: ["\u0428\u041A Y", _jsx("input", { type: "number", value: barcodeY, onChange: (e) => setBarcodeY(e.target.value) })] }), _jsxs("label", { children: ["\u041D\u043E\u043C\u0435\u0440 Y", _jsx("input", { type: "number", value: numberY, onChange: (e) => setNumberY(e.target.value) })] })] })] }), _jsxs("div", { className: "sticker-set__sequence", children: [_jsx("b", { children: "\u0411\u0443\u0434\u0435\u0442 \u043D\u0430\u043F\u0435\u0447\u0430\u0442\u0430\u043D\u043E" }), _jsxs("span", { children: [values.slice(0, 5).join(' · '), values.length > 5 ? ` · … · ${values[values.length - 1]}` : ''] })] }), error || message ? _jsx("p", { className: error ? 'form-error' : 'inline-status', children: error || message }) : null, _jsxs("footer", { children: [_jsxs("button", { className: "secondary-button", type: "button", disabled: isWorking || !client || values.length === 0, onClick: () => void createSet('preview'), children: [_jsx(FileText, { size: 16 }), "\u041F\u0440\u0435\u0434\u043F\u0440\u043E\u0441\u043C\u043E\u0442\u0440"] }), _jsxs("button", { className: "primary-button", type: "button", disabled: isWorking || !client || values.length === 0 || !printerCode, onClick: () => void createSet('print'), children: [_jsx(Save, { size: 16 }), isWorking ? 'Готовлю…' : `${printerCode === NIIMBOT_BROWSER_CODE ? 'Подключить и напечатать' : 'Напечатать'} ${values.length} шт.`] })] }), preview ? _jsx(TsplPreviewCard, { preview: preview, fileName: `${prefix || 'stickers'}${values[0] ?? ''}.tspl` }) : null] });
}
function sequence(prefix, startText, countText) { const start = Math.max(0, Math.floor(Number(startText) || 0)); const count = Math.min(500, Math.max(0, Math.floor(Number(countText) || 0))); return Array.from({ length: count }, (_, index) => `${prefix.trim()}${start + index}`); }
function positive(value, fallback) { const parsed = Math.floor(Number(value)); return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback; }
function coordinate(value, fallback) { const parsed = Math.floor(Number(value)); return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback; }
function stickerVariables(clientName, value, topText, bottomText) { return { clientName, barcodeValue: value, qrValue: value, topText, bottomText }; }
function buildTspl(input) { const lines = [`SIZE ${input.width} mm,${input.height} mm`, 'GAP 2 mm,0', 'CLS', `TEXT 20,16,"${input.font}",0,1,1,"{{clientName}}"`]; if (input.topText)
    lines.push(`TEXT 20,48,"${input.font}",0,1,1,"{{topText}}"`); if (input.qrEnabled)
    lines.push(`QRCODE ${input.qrX},${input.qrY},L,4,A,0,"{{qrValue}}"`); if (input.barcodeEnabled)
    lines.push(`BARCODE ${input.barcodeX},${input.barcodeY},"128",70,1,0,2,2,"{{barcodeValue}}"`); lines.push(`TEXT 20,${input.numberY},"${input.font}",0,1,1,"{{barcodeValue}}"`); if (input.bottomText)
    lines.push(`TEXT 20,${input.numberY + 28},"${input.font}",0,1,1,"{{bottomText}}"`); lines.push('PRINT 1'); return lines.join('\n'); }
