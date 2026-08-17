import JsBarcode from 'jsbarcode';
import QRCode from 'qrcode';
import 'niimbot-web-bluetooth';
const B1_MODEL = {
    name_prefixes: ['B1'],
    task: 'b1',
    density: 3,
    label_type: 1,
    speed: 1,
};
const B1_50X30 = { w_px: 384, h_px: 240, offset_y_px: 4 };
export async function printB1Stickers(stickers, onProgress) {
    if (!window.Niimbot?.isSupported()) {
        throw new Error('Для печати на NIIMBOT B1 откройте WMS в Chrome или Edge по HTTPS и разрешите Bluetooth.');
    }
    if (stickers.length === 0)
        return;
    onProgress('Готовлю макет для NIIMBOT B1…');
    const images = await Promise.all(stickers.map((sticker) => renderB1Sticker(sticker)));
    await window.Niimbot.printBatch(images, {
        model: B1_MODEL,
        size: B1_50X30,
        onProgress: (status) => onProgress(describeProgress(status)),
    });
}
async function renderB1Sticker(sticker) {
    const canvas = document.createElement('canvas');
    canvas.width = B1_50X30.w_px;
    canvas.height = B1_50X30.h_px;
    const context = canvas.getContext('2d');
    if (!context)
        throw new Error('Не удалось подготовить макет стикера для печати.');
    context.fillStyle = '#fff';
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.fillStyle = '#050505';
    context.textBaseline = 'top';
    const fontScale = clamp(sticker.fontSize, 1, 10);
    const left = 14;
    drawText(context, sticker.clientName, left, 12, 10 + fontScale * 2, canvas.width - 28, true);
    if (sticker.topText.trim())
        drawText(context, sticker.topText, left, 37, 9 + fontScale * 2, canvas.width - 28, false);
    const qrX = clamp(sticker.qrX, 0, 275);
    const qrY = clamp(sticker.qrY, 48, 140);
    if (sticker.qrEnabled) {
        const qrCanvas = document.createElement('canvas');
        await QRCode.toCanvas(qrCanvas, sticker.value, { width: 102, margin: 0, errorCorrectionLevel: 'M', color: { dark: '#000000', light: '#ffffff' } });
        context.drawImage(qrCanvas, qrX, qrY, 102, 102);
    }
    if (sticker.barcodeEnabled) {
        const barcodeCanvas = document.createElement('canvas');
        const barcodeX = clamp(sticker.barcodeX, 0, 180);
        const barcodeY = clamp(sticker.barcodeY, 48, 150);
        JsBarcode(barcodeCanvas, sticker.value, {
            format: 'CODE128',
            displayValue: false,
            margin: 0,
            width: 1.28,
            height: 48,
            background: '#ffffff',
            lineColor: '#000000',
        });
        const maxWidth = canvas.width - barcodeX - 10;
        const ratio = Math.min(1, maxWidth / barcodeCanvas.width);
        context.drawImage(barcodeCanvas, barcodeX, barcodeY, barcodeCanvas.width * ratio, barcodeCanvas.height);
    }
    const serialY = clamp(sticker.numberY, 150, 218);
    drawText(context, sticker.value, left, serialY, 12 + fontScale * 2, canvas.width - 28, true);
    if (sticker.bottomText.trim())
        drawText(context, sticker.bottomText, left, Math.min(226, serialY + 22), 9 + fontScale, canvas.width - 28, false);
    return canvas.toDataURL('image/png');
}
function drawText(context, source, x, y, size, maxWidth, bold) {
    const text = source.trim();
    if (!text)
        return;
    context.font = `${bold ? '700' : '500'} ${size}px Arial, sans-serif`;
    const clipped = truncateToWidth(context, text, maxWidth);
    context.fillText(clipped, x, y);
}
function truncateToWidth(context, value, maxWidth) {
    if (context.measureText(value).width <= maxWidth)
        return value;
    let shortened = value;
    while (shortened.length > 1 && context.measureText(`${shortened}…`).width > maxWidth)
        shortened = shortened.slice(0, -1);
    return `${shortened}…`;
}
function clamp(value, min, max) { return Math.max(min, Math.min(max, value)); }
function describeProgress(status) {
    if (status === 'connecting…')
        return 'Выберите NIIMBOT B1 в окне Bluetooth…';
    if (status === 'ok')
        return 'Печать на NIIMBOT B1 завершена.';
    return `NIIMBOT B1: ${status}`;
}
