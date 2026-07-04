import { useMemo, useState } from 'react';

export type KnownValueOption = {
  value: string;
  label?: string;
  description?: string;
  data?: Record<string, string | number | null | undefined>;
};

type KnownValueInputProps = {
  label: string;
  value: string;
  options: KnownValueOption[];
  placeholder?: string;
  disabled?: boolean;
  required?: boolean;
  multiline?: boolean;
  maxVisible?: number;
  onChange: (value: string) => void;
  onSelect?: (option: KnownValueOption) => void;
  onSearch?: (value: string) => void;
};

export function KnownValueInput({
  label,
  value,
  options,
  placeholder,
  disabled,
  required,
  multiline,
  maxVisible = 12,
  onChange,
  onSelect,
  onSearch,
}: KnownValueInputProps) {
  const [isOpen, setOpen] = useState(false);
  const visibleOptions = useMemo(() => filterOptions(options, value).slice(0, maxVisible), [maxVisible, options, value]);
  const hasOptions = visibleOptions.length > 0;

  function openList(nextValue = value) {
    if (disabled) {
      return;
    }

    setOpen(true);
    onSearch?.(nextValue);
  }

  function changeValue(nextValue: string) {
    onChange(nextValue);
    setOpen(true);
    onSearch?.(nextValue);
  }

  function selectOption(option: KnownValueOption) {
    onChange(option.value);
    onSelect?.(option);
    setOpen(false);
  }

  const control = multiline ? (
    <textarea
      value={value}
      placeholder={placeholder}
      disabled={disabled}
      required={required}
      onFocus={() => openList()}
      onChange={(event) => changeValue(event.target.value)}
      onBlur={() => window.setTimeout(() => setOpen(false), 120)}
    />
  ) : (
    <input
      value={value}
      placeholder={placeholder}
      disabled={disabled}
      required={required}
      onFocus={() => openList()}
      onChange={(event) => changeValue(event.target.value)}
      onBlur={() => window.setTimeout(() => setOpen(false), 120)}
    />
  );

  return (
    <label className="known-value-field">
      <span>{label}</span>
      <div className="known-value-control">
        {control}
        {isOpen ? (
          <div className="known-value-options">
            {hasOptions ? (
              visibleOptions.map((option) => (
                <button
                  key={`${option.value}-${option.description ?? ''}`}
                  type="button"
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => selectOption(option)}
                >
                  <strong>{option.label ?? option.value}</strong>
                  {option.description ? <small>{option.description}</small> : null}
                </button>
              ))
            ) : (
              <span className="known-value-options__empty">Нет известных значений</span>
            )}
          </div>
        ) : null}
      </div>
    </label>
  );
}

function filterOptions(options: KnownValueOption[], value: string) {
  const query = value.trim().toLowerCase();
  if (!query) {
    return options;
  }

  return options.filter((option) =>
    [option.value, option.label, option.description].filter(Boolean).some((text) => text!.toLowerCase().includes(query)),
  );
}
