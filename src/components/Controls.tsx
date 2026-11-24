import type { ReactNode } from 'react';

interface SliderProps {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  unit?: string;
  onChange: (v: number) => void;
  format?: (v: number) => string;
}

export function Slider({ label, value, min, max, step, unit, onChange, format }: SliderProps): JSX.Element {
  return (
    <label className="slider">
      <span className="slider-label">
        {label}
        <b>
          {format ? format(value) : value.toFixed(step < 1 ? 2 : 0)}
          {unit ? ` ${unit}` : ''}
        </b>
      </span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(parseFloat(e.target.value))}
      />
    </label>
  );
}

export function PanelSection({ title, children }: { title: string; children: ReactNode }): JSX.Element {
  return (
    <section className="panel-section">
      <h3>{title}</h3>
      {children}
    </section>
  );
}

export function ActionButton({
  children,
  onClick,
  variant,
  disabled,
}: {
  children: ReactNode;
  onClick: () => void;
  variant?: 'primary' | 'danger' | 'ghost';
  disabled?: boolean;
}): JSX.Element {
  return (
    <button
      className={`btn ${variant ? `btn-${variant}` : ''}`}
      onClick={onClick}
      disabled={disabled}
    >
      {children}
    </button>
  );
}
