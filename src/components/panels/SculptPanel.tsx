import { useEditorStore } from '../../store';
import { PanelSection, Slider } from '../Controls';
import type { BrushType } from '../../lib/types';

const BRUSHES: Array<{ id: BrushType; label: string; hint: string; icon: string }> = [
  { id: 'raise', label: '抬升', hint: '向上堆塑河床', icon: '⬆' },
  { id: 'lower', label: '下压', hint: '下切冲刷深槽', icon: '⬇' },
  { id: 'smooth', label: '平滑', hint: '邻域均化起伏', icon: '〜' },
  { id: 'flatten', label: '拉平', hint: '抬压至落笔高程', icon: '▬' },
];

export function SculptPanel(): JSX.Element {
  const brush = useEditorStore((s) => s.brush);
  const patchBrush = useEditorStore((s) => s.patchBrush);
  const setBrushType = useEditorStore((s) => s.setBrushType);
  const setToolMode = useEditorStore((s) => s.setToolMode);
  const setModule = useEditorStore((s) => s.setModule);

  return (
    <div className="panel">
      <PanelSection title="笔刷类型">
        <div className="brush-grid">
          {BRUSHES.map((b) => (
            <button
              key={b.id}
              className={`brush-btn ${brush.type === b.id ? 'active' : ''}`}
              onClick={() => {
                setBrushType(b.id);
                setToolMode('sculpt');
                setModule('sculpt');
              }}
              title={b.hint}
            >
              <span className="brush-icon">{b.icon}</span>
              {b.label}
            </button>
          ))}
        </div>
      </PanelSection>

      <PanelSection title="笔刷参数">
        <Slider
          label="半径"
          value={brush.radius}
          min={2}
          max={30}
          step={0.5}
          unit="m"
          onChange={(v) => patchBrush({ radius: v })}
        />
        <Slider
          label="强度"
          value={brush.strength}
          min={0.05}
          max={1}
          step={0.05}
          onChange={(v) => patchBrush({ strength: v })}
          format={(v) => `${Math.round(v * 100)}%`}
        />
        <label className="check-row">
          <input
            type="checkbox"
            checked={brush.symmetric}
            onChange={(e) => patchBrush({ symmetric: e.target.checked })}
          />
          <span>
            对称笔刷
            <small>沿中心线镜像,同时雕刻两岸</small>
          </span>
        </label>
      </PanelSection>

      <PanelSection title="操作提示">
        <ul className="tips">
          <li>左键拖动:在地形上雕刻</li>
          <li>左键空白处拖动:旋转视角</li>
          <li>右键拖动:平移,滚轮:缩放</li>
          <li>拉平以落笔处高程为目标</li>
          <li>Ctrl+Z / Ctrl+Shift+Z 撤销重做</li>
        </ul>
      </PanelSection>
    </div>
  );
}
