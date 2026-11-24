import { useEffect, useRef, useState } from 'react';
import { EditorController } from '../editor/EditorController';
import { FLOWER_META, FLOWER_ORDER } from '../editor/types';

interface Props {
  editor: EditorController;
}

function formatNumber(value: number | null | undefined, digits = 2): string {
  if (value === null || value === undefined || Number.isNaN(value)) return '';
  return String(Math.round(value * 10 ** digits) / 10 ** digits);
}

interface NumberFieldProps {
  label: string;
  value: number | null;
  onCommit: (value: number) => void;
  step?: number;
  suffix?: string;
  disabled?: boolean;
  placeholder?: string;
}

function NumberField({ label, value, onCommit, step = 0.1, suffix, disabled, placeholder }: NumberFieldProps) {
  const [text, setText] = useState(formatNumber(value));
  const focused = useRef(false);

  useEffect(() => {
    if (!focused.current) setText(formatNumber(value));
  }, [value]);

  const commit = () => {
    const parsed = Number.parseFloat(text);
    if (Number.isFinite(parsed)) onCommit(parsed);
    else setText(formatNumber(value));
  };

  return (
    <label className="number-field">
      <span>{label}</span>
      <div className="input-wrap">
        <input
          type="number"
          step={step}
          value={text}
          disabled={disabled}
          placeholder={placeholder ?? (value === null ? '多个值' : '0.00')}
          onFocus={() => {
            focused.current = true;
          }}
          onChange={(event) => setText(event.target.value)}
          onBlur={() => {
            focused.current = false;
            commit();
          }}
          onKeyDown={(event) => {
            if (event.key === 'Enter') (event.target as HTMLInputElement).blur();
          }}
        />
        {suffix ? <em>{suffix}</em> : null}
      </div>
    </label>
  );
}

export function RightPanel({ editor }: Props) {
  const info = editor.selectionInfo;
  const [offset, setOffset] = useState<[string, string, string]>(['0.20', '0', '0']);
  const [scaleFactor, setScaleFactor] = useState('1.10');
  const [rotateStep, setRotateStep] = useState('15');

  const applyOffset = () => {
    const dx = Number.parseFloat(offset[0]) || 0;
    const dy = Number.parseFloat(offset[1]) || 0;
    const dz = Number.parseFloat(offset[2]) || 0;
    editor.applyOffset([dx, dy, dz]);
  };

  const applyScale = () => {
    const factor = Number.parseFloat(scaleFactor);
    if (Number.isFinite(factor) && factor > 0) editor.scaleSelectionUniform(factor);
  };

  const applyRotation = (sign: 1 | -1) => {
    const degrees = Number.parseFloat(rotateStep) || 15;
    editor.rotateSelectionY(sign * Math.abs(degrees));
  };

  return (
    <aside className="panel right-panel">
      <section className="panel-section selection-summary">
        <div className="panel-heading">
          <h2>属性</h2>
          <span className={info ? 'badge active-badge' : 'badge'}>{info?.count ?? 0} 选中</span>
        </div>

        {!info ? (
          <div className="empty-properties">
            <div className="empty-icon">✥</div>
            <p>尚未选择花材</p>
            <span>点击花材，或在视口空白处拖拽框选多个实例。</span>
          </div>
        ) : (
          <>
            <div className="group-line">
              {info.groupId ? (
                <label className="group-name-input">
                  <span>组名称</span>
                  <input
                    key={info.groupId}
                    defaultValue={info.groupName ?? ''}
                    onBlur={(event) => editor.renameSelectedGroup(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter') (event.target as HTMLInputElement).blur();
                    }}
                  />
                </label>
              ) : (
                <div className="temporary-group">
                  <strong>{info.count > 1 ? '临时多选' : '单个实例'}</strong>
                  <span>成组后可保存组名并反复整体排布</span>
                </div>
              )}
            </div>

            <div className="button-row">
              <button type="button" className="small-primary" onClick={() => editor.groupSelected()}>
                成组
              </button>
              <button type="button" className="small-button" onClick={() => editor.ungroupSelected()}>
                取消组
              </button>
              <button type="button" className="small-button danger-text" onClick={() => editor.deleteSelected()}>
                删除
              </button>
            </div>

            <div className="type-counts">
              {FLOWER_ORDER.map((type) => (
                <span key={type} style={{ color: FLOWER_META[type].color }}>
                  <i className="dot" style={{ background: FLOWER_META[type].color }} />
                  {FLOWER_META[type].label} {info.typeCounts[type]}
                </span>
              ))}
            </div>
          </>
        )}
      </section>

      {info ? (
        <>
          <section className="panel-section">
            <h3>组中心坐标</h3>
            <div className="field-grid three">
              <NumberField label="X" value={info.center[0]} step={0.05} onCommit={(x) => editor.setCenterPosition([x, info.center[1], info.center[2]])} />
              <NumberField label="Y" value={info.center[1]} step={0.05} onCommit={(y) => editor.setCenterPosition([info.center[0], y, info.center[2]])} />
              <NumberField label="Z" value={info.center[2]} step={0.05} onCommit={(z) => editor.setCenterPosition([info.center[0], info.center[1], z])} />
            </div>

            <h3 className="mt">整体尺寸</h3>
            <div className="dimension-grid">
              <div><span>宽 X</span><strong>{formatNumber(info.size[0])} m</strong></div>
              <div><span>高 Y</span><strong>{formatNumber(info.size[1])} m</strong></div>
              <div><span>深 Z</span><strong>{formatNumber(info.size[2])} m</strong></div>
            </div>
          </section>

          <section className="panel-section">
            <h3>精确偏移量</h3>
            <div className="field-grid three">
              {(['ΔX', 'ΔY', 'ΔZ'] as const).map((label, index) => (
                <label className="number-field" key={label}>
                  <span>{label}</span>
                  <input
                    type="number"
                    step={0.05}
                    value={offset[index]}
                    onChange={(event) => {
                      const next = [...offset] as [string, string, string];
                      next[index] = event.target.value;
                      setOffset(next);
                    }}
                    onKeyDown={(event) => event.key === 'Enter' && applyOffset()}
                  />
                </label>
              ))}
            </div>
            <button type="button" className="full-button" onClick={applyOffset}>
              应用偏移并记录历史
            </button>
          </section>

          <section className="panel-section">
            <h3>旋转 / 缩放 / 花器</h3>
            <div className="inline-action-grid">
              <label className="number-field compact">
                <span>角度</span>
                <input type="number" step={15} value={rotateStep} onChange={(e) => setRotateStep(e.target.value)} />
              </label>
              <button type="button" className="small-button" onClick={() => applyRotation(-1)}>- 旋转</button>
              <button type="button" className="small-button" onClick={() => applyRotation(1)}>+ 旋转</button>
            </div>
            <p className="snap-note">视口旋转手柄固定 15° 吸附；此处可输入任意角度。</p>

            <div className="inline-action-grid">
              <label className="number-field compact">
                <span>倍乘</span>
                <input type="number" step={0.05} min={0.05} value={scaleFactor} onChange={(e) => setScaleFactor(e.target.value)} />
              </label>
              <button type="button" className="small-button" onClick={() => editor.scaleSelectionUniform(0.9)}>0.9×</button>
              <button type="button" className="small-button" onClick={() => editor.scaleSelectionUniform(1.1)}>1.1×</button>
              <button type="button" className="small-primary compact-button" onClick={applyScale}>应用</button>
            </div>
            {info.scale ? (
              <p className="scale-readout">
                当前缩放 {info.scale.map((v) => formatNumber(v, 2)).join(' / ')}
              </p>
            ) : (
              <p className="scale-readout muted">所选实例缩放不一致，倍乘将作用于各自当前值。</p>
            )}

            <NumberField
              label="花器高度偏移（整体抬高 m）"
              value={info.vaseHeight}
              step={0.02}
              onCommit={(height) => editor.setVaseHeight(height)}
            />
          </section>
        </>
      ) : (
        <section className="panel-section">
          <h3>方案概览</h3>
          <div className="dimension-grid">
            <div><span>实例总数</span><strong>{editor.doc.instances.length}</strong></div>
            <div><span>命名组</span><strong>{editor.doc.groups.length}</strong></div>
            <div><span>桌面半径</span><strong>{formatNumber(editor.doc.tableRadius, 1)} m</strong></div>
          </div>
          <p className="snap-note mt">数据会自动保存在当前浏览器，可通过顶部 JSON 文件分享给其他设备。</p>
        </section>
      )}
    </aside>
  );
}
