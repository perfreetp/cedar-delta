import type { ReactNode } from 'react';

export function ModuleSection({
  index,
  title,
  subtitle,
  icon,
  status,
  children,
}: {
  index: string;
  title: string;
  subtitle: string;
  icon?: ReactNode;
  status?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="module-card">
      <header className="module-header">
        <div className="module-index">{index}</div>
        <div className="module-heading">
          <div className="module-title-row">
            <h2>{title}</h2>
            {icon ? <span className="module-title-icon">{icon}</span> : null}
          </div>
          <p>{subtitle}</p>
        </div>
        {status ? <div className="module-status">{status}</div> : null}
      </header>
      {children}
    </section>
  );
}

export function Toggle({
  checked,
  onChange,
  label,
  description,
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  label: string;
  description?: string;
}) {
  return (
    <button
      type="button"
      className={`toggle-row ${checked ? 'is-on' : ''}`}
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
    >
      <span className="toggle-text">
        <strong>{label}</strong>
        {description ? <small>{description}</small> : null}
      </span>
      <span className="toggle-track">
        <span className="toggle-thumb" />
      </span>
    </button>
  );
}

export function LevelSegments<T extends number>({
  label,
  value,
  options,
  onChange,
  formatValue,
}: {
  label: string;
  value: T;
  options: readonly T[];
  onChange: (value: T) => void;
  formatValue?: (value: T) => string;
}) {
  return (
    <div className="level-row">
      <div className="level-label">
        <span>{label}</span>
        {formatValue ? <strong>{formatValue(value)}</strong> : null}
      </div>
      <div className="segmented three">
        {options.map((option, i) => (
          <button
            key={option}
            type="button"
            className={value === option ? 'active' : ''}
            onClick={() => onChange(option)}
          >
            <span className="level-dots" aria-hidden="true">
              {[1, 2, 3].map((dot) => (
                <i key={dot} className={dot <= i + 1 ? 'filled' : ''} />
              ))}
            </span>
            {['小', '中', '大'][i] ?? option}
          </button>
        ))}
      </div>
    </div>
  );
}
