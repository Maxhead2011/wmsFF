import { Save, X } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import {
  updateNomenclatureItem,
  type AuthSession,
  type CreateNomenclaturePayload,
  type NomenclatureSummary,
} from '../../lib/api';

type NomenclatureEditDialogProps = {
  session: AuthSession;
  item: NomenclatureSummary;
  onClose: () => void;
  onSaved: (item: NomenclatureSummary) => void;
};

export function NomenclatureEditDialog({ session, item, onClose, onSaved }: NomenclatureEditDialogProps) {
  const [form, setForm] = useState(() => formFromItem(item));
  const [error, setError] = useState('');
  const [isSubmitting, setSubmitting] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true);
    setError('');

    try {
      const saved = await updateNomenclatureItem(session.accessToken, item.id, payloadFromForm(form));
      onSaved(saved);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Не удалось сохранить номенклатуру.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="nomenclature-edit-backdrop" role="dialog" aria-modal="true" aria-label="Редактирование номенклатуры">
      <form className="nomenclature-edit-dialog" onSubmit={(event) => void submit(event)}>
        <header>
          <div>
            <span>Общая номенклатура</span>
            <h3>{item.name}</h3>
          </div>
          <button className="icon-button" type="button" onClick={onClose} title="Закрыть" aria-label="Закрыть">
            <X size={18} aria-hidden="true" />
          </button>
        </header>

        <div className="nomenclature-edit-dialog__fields">
          <label>
            <span>Внутренний SKU</span>
            <input required value={form.internalSku} onChange={(event) => setForm({ ...form, internalSku: event.target.value })} />
          </label>
          <label>
            <span>Название</span>
            <input required value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} />
          </label>
          <label>
            <span>Штрихкод</span>
            <input value={form.barcode} onChange={(event) => setForm({ ...form, barcode: event.target.value })} />
          </label>
          <label>
            <span>Артикул</span>
            <input value={form.article} onChange={(event) => setForm({ ...form, article: event.target.value })} />
          </label>
          <label className="nomenclature-edit-dialog__wide">
            <span>Наименование для печати</span>
            <input value={form.printName} onChange={(event) => setForm({ ...form, printName: event.target.value })} />
          </label>
          <label>
            <span>Единица хранения</span>
            <input value={form.unit} onChange={(event) => setForm({ ...form, unit: event.target.value })} />
          </label>
          <label>
            <span>Тип номенклатуры</span>
            <input value={form.itemType} onChange={(event) => setForm({ ...form, itemType: event.target.value })} />
          </label>
          <label>
            <span>Цвет</span>
            <input value={form.color} onChange={(event) => setForm({ ...form, color: event.target.value })} />
          </label>
          <label>
            <span>Размер</span>
            <input value={form.size} onChange={(event) => setForm({ ...form, size: event.target.value })} />
          </label>
          <label className="directory-checkbox nomenclature-edit-dialog__wide">
            <input
              checked={form.needsChestnyZnak}
              type="checkbox"
              onChange={(event) => setForm({ ...form, needsChestnyZnak: event.target.checked })}
            />
            <span>Требуется КИЗ «Честный знак»</span>
          </label>
        </div>

        {error ? <p className="form-error">{error}</p> : null}

        <footer>
          <button className="secondary-button" type="button" onClick={onClose}>Отмена</button>
          <button className="primary-button" disabled={isSubmitting} type="submit">
            <Save size={16} aria-hidden="true" />
            <span>{isSubmitting ? 'Сохраняю' : 'Сохранить изменения'}</span>
          </button>
        </footer>
      </form>
    </div>
  );
}

function formFromItem(item: NomenclatureSummary) {
  return {
    internalSku: item.internalSku,
    article: item.article ?? '',
    barcode: item.barcode ?? '',
    name: item.name,
    printName: item.printName ?? '',
    unit: item.unit ?? '',
    itemType: item.itemType ?? '',
    color: item.color ?? '',
    size: item.size ?? '',
    needsChestnyZnak: item.needsChestnyZnak,
  };
}

function payloadFromForm(form: ReturnType<typeof formFromItem>): CreateNomenclaturePayload {
  return {
    internalSku: form.internalSku.trim(),
    article: form.article.trim(),
    barcode: form.barcode.trim(),
    name: form.name.trim(),
    printName: form.printName.trim(),
    unit: form.unit.trim(),
    itemType: form.itemType.trim(),
    color: form.color.trim(),
    size: form.size.trim(),
    needsChestnyZnak: form.needsChestnyZnak,
  };
}
