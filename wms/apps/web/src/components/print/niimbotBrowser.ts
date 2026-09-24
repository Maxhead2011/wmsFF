import JsBarcode from 'jsbarcode';
import QRCode from 'qrcode';
import 'niimbot-web-bluetooth';
import { fitStickerText, type StickerBoxes, type StickerBox, type StickerTextStyles, type StickerTextStyle } from '../../lib/stickerLayout';

declare global {
  interface Window {
    Niimbot?: NiimbotDriver;
  }
}

type NiimbotModel = {
  name_prefixes: string[];
  task: 'b1';
  density: number;
  label_type: number;
  speed: number;
};

type NiimbotSize = { w_px: number; h_px: number; offset_y_px?: number };

type NiimbotDriver = {
  isSupported(): boolean;
  printBatch(urls: string[], options: { model: NiimbotModel; size: NiimbotSize; onProgress?: (status: string) => void }): Promise<void>;
};

const B1_MODEL: NiimbotModel = {
  name_prefixes: ['B1'],
  task: 'b1',
  density: 3,
  label_type: 1,
  speed: 1,
};

const B1_50X30: NiimbotSize = { w_px: 384, h_px: 240, offset_y_px: 4 };

export type BrowserSticker = {
  clientName: string;
  value: string;
  topText: string;
  bottomText: string;
  fontSize: number;
  qrEnabled: boolean;
  qrLevel?: 'L' | 'M' | 'Q' | 'H';
  qrSize?: number;
  barcodeEnabled: boolean;
  qrX: number;
  qrY: number;
  barcodeX: number;
  barcodeY: number;
  numberY: number;
  boxes?: StickerBoxes;
  textStyles?: StickerTextStyles;
};

export async function printB1Stickers(stickers: BrowserSticker[], onProgress: (message: string) => void) {
  if (!window.Niimbot?.isSupported()) {
    throw new Error('Для печати на NIIMBOT B1 откройте WMS в Chrome или Edge по HTTPS и разрешите Bluetooth.');
  }
  if (stickers.length === 0) return;

  onProgress('Готовлю макет для NIIMBOT B1…');
  const images = await Promise.all(stickers.map((sticker) => renderStickerImage(sticker, 50, 30, B1_50X30.w_px, B1_50X30.h_px)));
  await window.Niimbot.printBatch(images, {
    model: B1_MODEL,
    size: B1_50X30,
    onProgress: (status) => onProgress(describeProgress(status)),
  });
}

export async function renderStickerPng(sticker: BrowserSticker, widthMm: number, heightMm: number) {
  const image = await renderStickerImage(sticker, widthMm, heightMm, Math.round(widthMm * 11.81), Math.round(heightMm * 11.81));
  return image.replace(/^data:image\/png;base64,/, '');
}

async function renderStickerImage(sticker: BrowserSticker, widthMm: number, heightMm: number, outputWidth: number, outputHeight: number) {
  const canvas = document.createElement('canvas');
  canvas.width = outputWidth;
  canvas.height = outputHeight;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Не удалось подготовить макет стикера для печати.');

  context.fillStyle = '#fff';
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.scale(outputWidth / (widthMm * 8), outputHeight / (heightMm * 8));
  context.fillStyle = '#050505';
  context.textBaseline = 'top';

  const boxes = sticker.boxes;
  const textSize = Math.max(18, clamp(sticker.fontSize, 1, 10) * 6);
  drawText(context, sticker.clientName, boxes?.client ?? { x: 14, y: 12, width: widthMm * 8 - 28, height: 30 }, textSize, sticker.textStyles?.client ?? { align: 'left', bold: true });
  if (sticker.topText.trim()) drawText(context, sticker.topText, boxes?.top ?? { x: 14, y: 37, width: widthMm * 8 - 28, height: 30 }, textSize, sticker.textStyles?.top ?? { align: 'left', bold: false });

  const qrBox = boxes?.qr ?? { x: sticker.qrX, y: sticker.qrY, width: sticker.qrSize ?? 102, height: sticker.qrSize ?? 102 };
  if (sticker.qrEnabled) {
    const qrCanvas = document.createElement('canvas');
    const qrSize = Math.min(qrBox.width, qrBox.height);
    await QRCode.toCanvas(qrCanvas, sticker.value, { width: qrSize, margin: 0, errorCorrectionLevel: sticker.qrLevel ?? 'M', color: { dark: '#000000', light: '#ffffff' } });
    context.drawImage(qrCanvas, qrBox.x, qrBox.y, qrSize, qrSize);
  }

  if (sticker.barcodeEnabled) {
    const barcodeCanvas = document.createElement('canvas');
    const barcodeBox = boxes?.barcode ?? { x: sticker.barcodeX, y: sticker.barcodeY, width: 180, height: 48 };
    JsBarcode(barcodeCanvas, sticker.value, {
      format: 'CODE128',
      displayValue: false,
      margin: 0,
      width: 1.28,
      height: barcodeBox.height,
      background: '#ffffff',
      lineColor: '#000000',
    });
    context.drawImage(barcodeCanvas, barcodeBox.x, barcodeBox.y, barcodeBox.width, barcodeBox.height);
  }

  drawText(context, sticker.value, boxes?.number ?? { x: 14, y: sticker.numberY, width: widthMm * 8 - 28, height: 30 }, textSize, sticker.textStyles?.number ?? { align: 'left', bold: true });
  if (sticker.bottomText.trim()) drawText(context, sticker.bottomText, boxes?.bottom ?? { x: 14, y: sticker.numberY + 22, width: widthMm * 8 - 28, height: 22 }, textSize, sticker.textStyles?.bottom ?? { align: 'left', bold: false });
  return canvas.toDataURL('image/png');
}

function drawText(context: CanvasRenderingContext2D, source: string, box: StickerBox, size: number, style: StickerTextStyle) {
  const text = source.trim();
  if (!text) return;
  const weight = style.bold ? '700' : '500';
  const fitted = fitStickerText(text, box, size, (line, fontSize) => {
    context.font = `${weight} ${fontSize}px Arial, sans-serif`;
    return context.measureText(line).width;
  });
  context.font = `${weight} ${fitted.size}px Arial, sans-serif`;
  fitted.lines.forEach((line, index) => {
    const width = context.measureText(line).width;
    const x = style.align === 'center' ? box.x + (box.width - width) / 2 : style.align === 'right' ? box.x + box.width - width : box.x;
    context.fillText(line, x, box.y + index * fitted.size * 1.2);
  });
}

function clamp(value: number, min: number, max: number) { return Math.max(min, Math.min(max, value)); }

function describeProgress(status: string) {
  if (status === 'connecting…') return 'Выберите NIIMBOT B1 в окне Bluetooth…';
  if (status === 'ok') return 'Печать на NIIMBOT B1 завершена.';
  return `NIIMBOT B1: ${status}`;
}
