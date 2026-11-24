import type { JSX } from 'solid-js';
import { For, Show, splitProps } from 'solid-js';
import type { Vec3Tuple } from '../types';

export function Field(props: { label: string; value?: string | number; children: JSX.Element; hint?: string }) {
  return (
    <label class="form-row">
      <span class="form-label">
        <span>{props.label}</span>
        <Show when={props.value !== undefined}>
          <output>{props.value}</output>
        </Show>
      </span>
      {props.children}
      <Show when={props.hint}>
        <span class="help-text" style={{ 'margin-top': '-3px' }}>{props.hint}</span>
      </Show>
    </label>
  );
}

export function NumberInput(props: {
  value: number;
  step?: number;
  min?: number;
  max?: number;
  disabled?: boolean;
  onCommit: (value: number) => void;
}) {
  return (
    <input
      class="input"
      type="number"
      value={Number.isFinite(props.value) ? Math.round(props.value * 1000) / 1000 : 0}
      step={props.step ?? 0.1}
      min={props.min}
      max={props.max}
      disabled={props.disabled}
      onChange={(event) => {
        const value = Number(event.currentTarget.value);
        if (Number.isFinite(value)) props.onCommit(value);
      }}
    />
  );
}

export function VectorInput(props: {
  value: Vec3Tuple;
  labels?: [string, string, string];
  step?: number;
  onCommit: (value: Vec3Tuple) => void;
}) {
  const labels = props.labels ?? ['X', 'Y', 'Z'];
  const update = (index: number, raw: string) => {
    const value = Number(raw);
    if (!Number.isFinite(value)) return;
    const next = [...props.value] as Vec3Tuple;
    next[index] = value;
    props.onCommit(next);
  };
  return (
    <div class="vec3-grid">
      <For each={[0, 1, 2] as const}>
        {(index) => (
          <div class={`vec-axis axis-${labels[index].toLowerCase()}`}>
            <span>{labels[index]}</span>
            <input
              class="input"
              type="number"
              step={props.step ?? 0.1}
              value={Math.round(props.value[index] * 100) / 100}
              onChange={(e) => update(index, e.currentTarget.value)}
            />
          </div>
        )}
      </For>
    </div>
  );
}

export function SliderRow(props: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  unit?: string;
  disabled?: boolean;
  format?: (value: number) => string;
  onGestureStart?: () => void;
  onLive: (value: number) => void;
  onGestureEnd?: () => void;
}) {
  let active = false;
  const begin = () => {
    if (active || props.disabled) return;
    active = true;
    props.onGestureStart?.();
  };
  const display = () => props.format?.(props.value) ?? `${props.value.toFixed(props.step < 0.1 ? 2 : 1)}${props.unit ?? ''}`;

  return (
    <div class="form-row">
      <span class="form-label">
        <span>{props.label}</span>
        <output>{display()}</output>
      </span>
      <input
        type="range"
        min={props.min}
        max={props.max}
        step={props.step}
        value={props.value}
        disabled={props.disabled}
        onPointerDown={begin}
        onKeyDown={(e) => {
          if (e.key.startsWith('Arrow')) begin();
        }}
        onInput={(e) => {
          begin();
          props.onLive(Number(e.currentTarget.value));
        }}
        onChange={() => {
          if (active) {
            active = false;
            props.onGestureEnd?.();
          }
        }}
      />
    </div>
  );
}

export function Toggle(props: { checked: boolean; label: string; description?: string; onChange: (checked: boolean) => void }) {
  return (
    <label class="switch-row">
      <span>
        <span style={{ 'font-weight': 750, color: '#dbeafe', 'font-size': '13px' }}>{props.label}</span>
        <Show when={props.description}>
          <span class="help-text" style={{ display: 'block', margin: '2px 0 0' }}>{props.description}</span>
        </Show>
      </span>
      <span class="switch">
        <input type="checkbox" checked={props.checked} onChange={(e) => props.onChange(e.currentTarget.checked)} />
        <span class="switch-track" />
      </span>
    </label>
  );
}

export function PanelSection(props: { title: string; count?: number; action?: JSX.Element; children: JSX.Element }) {
  return (
    <section class="panel-section">
      <h3 class="section-title">
        <span>{props.title}</span>
        <Show when={props.count !== undefined}>
          <span class="count-pill">{props.count}</span>
        </Show>
        {props.action}
      </h3>
      {props.children}
    </section>
  );
}
