import { useEditorStore } from '../../store';
import { getEngine } from '../../engineRegistry';
import { ActionButton, PanelSection, Slider } from '../Controls';
import type { GateColor } from '../../lib/types';

export function GatePanel(): JSX.Element {
  const gateColor = useEditorStore((s) => s.gateColor);
  const setGateColor = useEditorStore((s) => s.setGateColor);
  const gates = useEditorStore((s) => s.gates);
  const selection = useEditorStore((s) => s.selection);
  const setSelection = useEditorStore((s) => s.setSelection);
  const setModule = useEditorStore((s) => s.setModule);
  const setToolMode = useEditorStore((s) => s.setToolMode);
  const engine = getEngine();

  const selected = gates.find((g) => selection?.kind === 'gate' && selection.id === g.id);

  return (
    <div className="panel">
      <PanelSection title="闸门颜色(水流方向规则)">
        <div className="color-toggle">
          {(['red', 'green'] as GateColor[]).map((c) => (
            <button
              key={c}
              className={`color-btn color-${c} ${gateColor === c ? 'active' : ''}`}
              onClick={() => setGateColor(c)}
            >
              {c === 'red' ? '红门(左杆)' : '绿门(右杆)'}
            </button>
          ))}
        </div>
        <p className="muted">
          在地形上点击放置闸门。门杆自动吸附到落点处的等高线切线方向,两端立柱落到地面并记录入水高度。
        </p>
        <ActionButton
          variant="primary"
          onClick={() => {
            setModule('gate');
            setToolMode('gate');
          }}
        >
          进入放置模式
        </ActionButton>
      </PanelSection>

      <PanelSection title={`闸门列表 (${gates.length})`}>
        {gates.length === 0 && <p className="muted">尚未放置闸门。</p>}
        <div className="gate-list">
          {gates.map((g, i) => (
            <div
              key={g.id}
              className={`gate-item ${selected?.id === g.id ? 'selected' : ''}`}
              onClick={() => setSelection({ kind: 'gate', id: g.id })}
            >
              <div className="gate-head">
                <span className={`gate-dot gate-dot-${g.color}`} />
                <b>
                  {g.color === 'red' ? '红' : '绿'}门 #{i + 1}
                </b>
                <small>s={g.s.toFixed(1)} m</small>
                <button
                  className="mini-btn"
                  onClick={(e) => {
                    e.stopPropagation();
                    engine?.deleteGate(g.id);
                  }}
                >
                  ✕
                </button>
              </div>
              <div className="gate-stats">
                <span>入水高度 {g.entryHeight.toFixed(2)} m</span>
                <span>下游坡度 {g.downstreamGrade.toFixed(2)}%</span>
              </div>
              <div onClick={(e) => e.stopPropagation()}>
                <Slider
                  label="门宽"
                  value={g.width}
                  min={2}
                  max={9}
                  step={0.1}
                  unit="m"
                  onChange={(v) => engine?.updateGateWidth(g.id, v)}
                />
              </div>
            </div>
          ))}
        </div>
      </PanelSection>

      {selected && (
        <PanelSection title="选中闸门">
          <ul className="tips">
            <li>在视口中拖动闸门可整体移位</li>
            <li>移动后门杆重新吸附等高线,立柱重新落地</li>
            <li>下游坡度剖面联动重算</li>
            <li>Delete 键删除选中闸门</li>
          </ul>
        </PanelSection>
      )}
    </div>
  );
}
