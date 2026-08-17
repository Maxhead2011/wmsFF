export function extractTemplateVariables(tspl) {
    return Array.from(tspl.matchAll(/{{\s*([A-Za-z0-9_.-]+)\s*}}/g), (match) => match[1]).filter((name, index, list) => list.indexOf(name) === index);
}
export function sampleVariableValue(variable) {
    const lower = variable.toLowerCase();
    if (lower.includes('client')) {
        return 'LOGOFF';
    }
    if (lower.includes('box')) {
        return 'BOX-001';
    }
    if (lower.includes('pallet')) {
        return 'PAL-001';
    }
    if (lower.includes('sku')) {
        return 'SKU-001';
    }
    if (lower.includes('barcode')) {
        return '460000000001';
    }
    return 'test';
}
