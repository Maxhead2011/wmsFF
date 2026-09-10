import { beforeEach, describe, expect, it, vi } from 'vitest';
import { BillingPeriodGenerationDialog, billingPeriodPreset } from './BillingPeriodGenerationDialog';
import { generateBillingPeriod, previewBillingPeriod } from '../../lib/api';

// TEST: lightweight hook harness follows the existing direct-element test convention.
const hooks = vi.hoisted(() => ({ values: [] as any[], cursor: 0 }));
vi.mock('react', async () => ({
  ...await vi.importActual<typeof import('react')>('react'),
  useState: (initial: any) => {
    const index = hooks.cursor++;
    if (!(index in hooks.values)) hooks.values[index] = typeof initial === 'function' ? initial() : initial;
    return [hooks.values[index], (next: any) => { hooks.values[index] = typeof next === 'function' ? next(hooks.values[index]) : next; }];
  },
  useRef: (initial: any) => {
    const index = hooks.cursor++;
    if (!(index in hooks.values)) hooks.values[index] = { current: initial };
    return hooks.values[index];
  },
}));
vi.mock('../../lib/api', () => ({ previewBillingPeriod: vi.fn(), generateBillingPeriod: vi.fn() }));
function elements(node: any): any[] {
  if (!node || typeof node !== 'object') return [];
  if (Array.isArray(node)) return node.flatMap(elements);
  return [node, ...elements(node.props?.children)];
}
function text(node: any): string {
  if (node == null || typeof node === 'boolean') return '';
  if (typeof node !== 'object') return String(node);
  return Array.isArray(node) ? node.map(text).join('') : text(node.props?.children);
}
const preview: any = {
  previewHash: 'snapshot-1', periodFrom: '2026-08-01', periodTo: '2026-08-31',
  groups: [{ key: 'one', clientId: 'client', clientName: 'Клиент', warehouseId: 'warehouse', category: 'FBS', chargeIds: ['charge'], invoiceIds: [], totalRub: 500, itemCount: 2 }],
  issues: [{ id: 'missing', clientName: 'Клиент', message: 'Нет тарифа ПРР' }], alreadyBilledCount: 3, zeroCount: 1,
};
let onCreated = vi.fn();
function render() {
  hooks.cursor = 0;
  return BillingPeriodGenerationDialog({ session: { accessToken: 'token', user: {} } as any, clients: [{ id: 'client', code: '001', name: 'Клиент' }] as any, periodFrom: '2026-08-01', periodTo: '2026-08-31', onClose: vi.fn(), onCreated });
}
function button(tree: any, label: string) { return elements(tree).find(node => node.type === 'button' && text(node) === label); }
async function getPreview() { await button(render(), 'Предварительный расчёт').props.onClick(); return render(); }

describe('billing period generation', () => {
  beforeEach(() => { hooks.values = []; hooks.cursor = 0; vi.clearAllMocks(); onCreated = vi.fn(); vi.mocked(previewBillingPeriod).mockResolvedValue(preview); });
  // TEST: presets use inclusive calendar days, not elapsed hours/local timezone.
  it('calculates seven/fourteen days across month and year boundaries', () => {
    expect(billingPeriodPreset('2026-08-28', 'week')).toEqual({ periodFrom: '2026-08-28', periodTo: '2026-09-03' });
    expect(billingPeriodPreset('2026-12-25', 'fortnight')).toEqual({ periodFrom: '2026-12-25', periodTo: '2027-01-07' });
    expect(billingPeriodPreset('2028-02-19', 'month')).toEqual({ periodFrom: '2028-02-01', periodTo: '2028-02-29' });
    expect(billingPeriodPreset('2026-02-30', 'week')).toBeNull();
  });
  it('starts with four categories, excludes Lukin, and shows actual selected dates', async () => {
    const tree = await getPreview();
    expect(previewBillingPeriod).toHaveBeenCalledWith('token', { periodFrom: '2026-08-01', periodTo: '2026-08-31', categories: ['FBS', 'PROCESSING', 'PRR', 'STORAGE'], excludeLukin: true });
    expect(text(tree)).toContain('Нет тарифа ПРР');
    expect(text(tree)).toContain('FBS');
    expect(text(tree)).toContain('2026-08-01');
    expect(generateBillingPeriod).not.toHaveBeenCalled();
  });
  it('clears preview when dates or filters change', async () => {
    let tree = await getPreview();
    elements(tree).find(node => node.props?.name === 'periodFrom').props.onChange({ target: { value: '2026-08-02' } });
    tree = render();
    expect(button(tree, 'Подтвердить создание черновиков')).toBeUndefined();
    expect(text(tree)).not.toContain('Нет тарифа ПРР');
  });
  it('requires valid ordered dates before querying', async () => {
    let tree = render();
    elements(tree).find(node => node.props?.name === 'periodFrom').props.onChange({ target: { value: '2026-09-01' } });
    tree = render();
    await button(tree, 'Предварительный расчёт').props.onClick();
    expect(previewBillingPeriod).not.toHaveBeenCalled();
    expect(text(render())).toContain('Проверьте даты');
  });
  it('guards same-tick preview double clicks', async () => {
    let resolve!: (value: any) => void;
    vi.mocked(previewBillingPeriod).mockReturnValue(new Promise(done => { resolve = done; }));
    const action = button(render(), 'Предварительный расчёт');
    const first = action.props.onClick();
    await action.props.onClick();
    expect(previewBillingPeriod).toHaveBeenCalledTimes(1);
    resolve(preview); await first;
  });
  it('creates only after confirmation using the hash, blocks repeated clicks, and refreshes parent', async () => {
    const tree = await getPreview();
    let resolve!: (value: any) => void;
    vi.mocked(generateBillingPeriod).mockReturnValue(new Promise(done => { resolve = done; }));
    const action = button(tree, 'Подтвердить создание черновиков');
    const first = action.props.onClick();
    await action.props.onClick();
    expect(generateBillingPeriod).toHaveBeenCalledTimes(1);
    expect(vi.mocked(generateBillingPeriod).mock.calls[0][1].previewHash).toBe('snapshot-1');
    resolve({ invoices: [{ id: 'invoice', number: 'СЧ-1' }], replayed: false }); await first;
    expect(onCreated).toHaveBeenCalledTimes(1);
    expect(text(render())).toContain('СЧ-1');
    expect(button(render(), 'Подтвердить создание черновиков')).toBeUndefined();
  });
  it('shows server error and requires another preview after failed generation', async () => {
    const tree = await getPreview();
    vi.mocked(generateBillingPeriod).mockRejectedValue(new Error('Начисления изменились'));
    await button(tree, 'Подтвердить создание черновиков').props.onClick();
    expect(text(render())).toContain('Начисления изменились');
    expect(button(render(), 'Подтвердить создание черновиков')).toBeUndefined();
    expect(onCreated).not.toHaveBeenCalled();
  });
  it('does not offer generation for an empty preview', async () => {
    vi.mocked(previewBillingPeriod).mockResolvedValue({ ...preview, groups: [] });
    const tree = await getPreview();
    expect(button(tree, 'Подтвердить создание черновиков')).toBeUndefined();
    expect(text(tree)).toContain('Нет доступных начислений');
  });
  // TEST: controls change the actual request, not only the displayed label.
  it('applies period buttons and client/category/exclusion filters to the next preview', async () => {
    let tree = render();
    button(tree, 'За две недели').props.onClick();
    tree = render();
    expect(elements(tree).find(node => node.props?.name === 'periodTo').props.value).toBe('2026-08-14');
    elements(tree).find(node => node.type === 'select').props.onChange({ target: { value: 'client' } });
    tree = render();
    const labels = elements(tree).filter(node => node.type === 'label');
    elements(labels.find(node => text(node) === ' FBS')).find(node => node.type === 'input').props.onChange({ target: { checked: false } });
    tree = render();
    const exclusion = elements(tree).find(node => node.type === 'label' && text(node).includes('Исключить ИП Лукин'));
    elements(exclusion).find(node => node.type === 'input').props.onChange({ target: { checked: false } });
    await getPreview();
    expect(previewBillingPeriod).toHaveBeenLastCalledWith('token', { clientId: 'client', periodFrom: '2026-08-01', periodTo: '2026-08-14', categories: ['PROCESSING', 'PRR', 'STORAGE'], excludeLukin: false });
  });
  it('shows preview API failures without exposing a generation action', async () => {
    vi.mocked(previewBillingPeriod).mockRejectedValue(new Error('Нет доступа к филиалу'));
    const tree = await getPreview();
    expect(text(tree)).toContain('Нет доступа к филиалу');
    expect(button(tree, 'Подтвердить создание черновиков')).toBeUndefined();
  });
  it('requires at least one selected service category', async () => {
    for (const category of ['FBS', 'Первичная обработка', 'ПРР', 'Хранение']) {
      const label = elements(render()).find(node => node.type === 'label' && text(node).trim() === category);
      elements(label).find(node => node.type === 'input').props.onChange({ target: { checked: false } });
    }
    await button(render(), 'Предварительный расчёт').props.onClick();
    expect(previewBillingPeriod).not.toHaveBeenCalled();
    expect(text(render())).toContain('Выберите хотя бы один вид услуг');
  });
  // TEST: generation offers only the four categories accepted by its server DTO.
  it('does not expose unresolved OTHER services as a selectable generation category', () => {
    const labels = elements(render()).filter(node => node.type === 'label').map(text);
    expect(labels.some(label => label.includes('Прочие услуги'))).toBe(false);
    for (const category of ['FBS', 'Первичная обработка', 'ПРР', 'Хранение']) {
      expect(labels.some(label => label.trim() === category)).toBe(true);
    }
  });
  // TEST: approval shows each source and its fixed quantity/tariff before creation.
  it('shows detailed sources and distinguishes existing documents from new drafts', async () => {
    vi.mocked(previewBillingPeriod).mockResolvedValue({ ...preview, groups: [{ ...preview.groups[0], action: 'EXISTING', existingInvoiceId: 'existing',
      lines: [{ sourceType: 'INVOICE', sourceId: 'existing', sourceNumber: 'INV-AUG-001', description: 'Сборка заказа', serviceDate: '2026-08-10', quantity: '2', unit: 'PIECE', unitPriceRub: '250', totalRub: '500' }] }] });
    const tree = await getPreview();
    expect(text(tree)).toContain('INV-AUG-001');
    expect(text(tree)).toContain('Сборка заказа');
    expect(text(tree)).toContain('Тариф');
    expect(text(tree)).toContain('Существующий счёт');
    expect(text(tree)).toContain('Создать новых: 0');
  });
});
