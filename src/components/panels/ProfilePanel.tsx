import { useState } from 'react';
import { useEditorStore } from '../../store';
import { getEngine } from '../../engineRegistry';
import { ActionButton, PanelSection, Slider } from '../Controls';
import { CHANNEL_GRADE, HEAD_ELEVATION } from '../../lib/constants';

export function ProfilePanel(): JSX.Element {
  const steps = useEditorStore((s) => s.steps);
  const profileVersion = useEditorStore((s) => s.profileVersion);
  const setToolMode = useEditorStore((s) => s.setToolMode);
  const setModule = useEditorStore((s) => s.setModule);
  const [s, setS] = useState(60);
  const [drop, setDrop] = useState(2);
  const [angle, setAngle] = useState(35);

  const engine = getEngine();
  const total = engine?.getCenterline().length ?? 0;
  void profileVersion;

  return (
    <div className="panel">
      <PanelSection title="纵坡概览">
        <div className="stat-grid">
          <div className="stat">
            <small>渠首高程</small>
            <b>{HEAD_ELEVATION.toFixed(1)} m</b>
          </div>
          <div className="stat">
            <small>基础纵坡</small>
            <b>{(CHANNEL_GRADE * 100).toFixed(1)}%</b>
          </div>
          <div className="stat">
            <small>河道总长</small>
            <b>{total.toFixed(1)} m</b>
          </div>
          <div className="stat">
            <small>跌水台阶</small>
            <b>{steps.length} 处</b>
          </div>
        </div>
        <p className="muted">
          下方剖面图中蓝线为设计渠底,橙色三角标记落差台阶,虚线为基础纵坡参考。
        </p>
      </PanelSection>

      <PanelSection title="插入落差台阶(跌水段)">
        <Slider label="沿程位置" value={s} min={4} max={Math.max(8, total - 4)} step={1} unit="m" onChange={setS} />
        <Slider label="落差高度" value={drop} min={0.3} max={6} step={0.1} unit="m" onChange={setDrop} />
        <Slider label="过渡坡角" value={angle} min={5} max={70} step={1} unit="°" onChange={setAngle} />
        <div className="row">
          <ActionButton variant="primary" onClick={() => engine?.addStep(s, drop, angle)}>
            插入台阶
          </ActionButton>
        </div>
        <p className="muted">
          台阶前后坡面按 {angle}° 自动过渡,过渡段长度约 {(drop / Math.tan((angle * Math.PI) / 180)).toFixed(1)} m。
        </p>
      </PanelSection>

      <PanelSection title={`已插入台阶 (${steps.length})`}>
        {steps.length === 0 && <p className="muted">暂无台阶,河道为均匀纵坡。</p>}
        <div className="step-list">
          {steps.map((st, i) => (
            <div className="step-item" key={st.id}>
              <div className="step-head">
                <b>
                  #{i + 1} · s={st.s.toFixed(1)} m
                </b>
                <ActionButton variant="danger" onClick={() => engine?.removeStep(st.id)}>
                  删除
                </ActionButton>
              </div>
              <div className="step-controls">
                <label>
                  落差
                  <input
                    type="number"
                    step={0.1}
                    value={st.drop}
                    onChange={(e) => engine?.updateStep(st.id, { drop: parseFloat(e.target.value) || 0 })}
                  />
                  m
                </label>
                <label>
                  坡角
                  <input
                    type="number"
                    step={1}
                    value={st.angle}
                    onChange={(e) => engine?.updateStep(st.id, { angle: parseFloat(e.target.value) || 1 })}
                  />
                  °
                </label>
                <label>
                  位置
                  <input
                    type="number"
                    step={1}
                    value={Math.round(st.s)}
                    onChange={(e) => engine?.updateStep(st.id, { s: parseFloat(e.target.value) || 0 })}
                  />
                  m
                </label>
              </div>
            </div>
          ))}
        </div>
      </PanelSection>

      <PanelSection title="赛道中心线">
        <p className="muted">拖动控制点调整弯道曲率,河床宽度随曲率自适应收窄。</p>
        <ActionButton
          onClick={() => {
            setModule('sculpt');
            setToolMode('centerline');
          }}
        >
          进入中心线编辑
        </ActionButton>
      </PanelSection>
    </div>
  );
}
