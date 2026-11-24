import { store } from '../state/store';

interface SliderProps {
  label: string;
  min: number;
  max: number;
  step: number;
  value: number;
  /** 拖动中调用（瞬时更新），松手自动并入一条历史 */
  onChange: (v: number) => void;
  format?: (v: number) => string;
}

/** 滑块：按下开始事务，拖动瞬时更新，松开提交为单条可回退历史 */
export function Slider({ label, min, max, step, value, onChange, format }: SliderProps) {
  return (
    <label className="slider-row">
      <span className="slider-label">{label}</span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onPointerDown={() => store.beginTransaction()}
        onChange={(e) => onChange(Number(e.target.value))}
        onPointerUp={() => store.endTransaction()}
        onPointerCancel={() => store.endTransaction()}
        onBlur={() => store.endTransaction()}
      />
      <span className="slider-value">{format ? format(value) : value.toFixed(2)}</span>
    </label>
  );
}
