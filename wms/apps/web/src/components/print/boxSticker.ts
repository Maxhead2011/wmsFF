import type { BrowserSticker } from './niimbotBrowser';

// FIX: render the warehouse box code for a remote Windows print station.
export function boxSticker(clientName: string, boxCode: string, quantity: number): BrowserSticker {
  return {
    clientName,
    value: boxCode,
    topText: '',
    bottomText: `Кол-во строк: ${quantity}`,
    fontSize: 4,
    qrEnabled: false,
    barcodeEnabled: true,
    qrX: 0,
    qrY: 0,
    barcodeX: 40,
    barcodeY: 95,
    numberY: 215,
    boxes: {
      client: { x: 16, y: 12, width: 608, height: 58 },
      top: { x: 16, y: 74, width: 608, height: 18 },
      qr: { x: 0, y: 0, width: 1, height: 1 },
      barcode: { x: 40, y: 95, width: 560, height: 100 },
      number: { x: 16, y: 215, width: 608, height: 60 },
      bottom: { x: 16, y: 300, width: 608, height: 40 },
    },
  };
}
