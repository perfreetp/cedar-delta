import { useState } from 'react';
import { EditorController } from '../editor/EditorController';
import { FLOWER_META, FLOWER_ORDER, FlowerType, MAX_INSTANCES } from '../editor/types';

interface Props {
  editor: EditorController;
}

type Filter = FlowerType | 'all';

const FILTERS: { key: Filter; label: string }[] = [
  { key: 'all', label: '全部' },
  { key: 'rose', label: '玫瑰' },
  { key: 'hydrangea', label: '绣球' },
  { key: 'eucalyptus', label: '尤加利叶' },
];

function FlowerGlyph({ type }: { type: FlowerType }) {
  return <span className={`flower-glyph glyph-${type}`} aria-hidden="true" />;
}

export function LeftPanel({ editor }: Props) {
  const [filter, setFilter] = useState<Filter>('all');
  const visible = FLOWER_ORDER.filter((type) => filter === 'all' || type === filter);
  const usage = editor.totalCount / MAX_INSTANCES;

  return (
    <aside className="panel left-panel">
      <section className="panel-section">
        <div className="panel-heading">
          <h2>花材库</h2>
          <span className="badge">{editor.totalCount}/{MAX_INSTANCES}</span>
        </div>
        <div className="capacity-track" title={`已使用 ${editor.totalCount} / ${MAX_INSTANCES}`}>
          <span style={{ width: `${Math.min(100, usage * 100)}%` }} />
        </div>
        <div className="filter-chips" role="tablist" aria-label="按类别筛选">
          {FILTERS.map((item) => (
            <button
              key={item.key}
              type="button"
              className={filter === item.key ? 'chip active' : 'chip'}
              onClick={() => setFilter(item.key)}
            >
              {item.label}
            </button>
          ))}
        </div>
      </section>

      <section className="flower-list" aria-label="花材类型">
        {visible.map((type) => {
          const meta = FLOWER_META[type];
          const count = editor.getTypeCount(type);
          return (
            <button
              key={type}
              type="button"
              className="flower-card"
              onClick={() => editor.addFlower(type)}
              disabled={editor.totalCount >= MAX_INSTANCES}
              style={{ ['--accent' as string]: meta.color, ['--accent-soft' as string]: meta.soft }}
            >
              <FlowerGlyph type={type} />
              <span className="flower-card-body">
                <strong>{meta.label}</strong>
                <em>{meta.latin}</em>
                <small>场景中 {count} 枝 · 点击置于桌面中心</small>
              </span>
              <span className="add-pill">+ 添加</span>
            </button>
          );
        })}
      </section>

      <section className="panel-section tips-card">
        <h3>排布操作</h3>
        <ul>
          <li>在空白处按住左键拖拽可框选多个实例。</li>
          <li>点击已分组花材会选中整组；Shift/Ctrl 点击可加减选。</li>
          <li>拖动时自动贴合桌面，并滑开已有花球区域。</li>
          <li>旋转手柄已固定为 15° 吸附。</li>
        </ul>
        <div className="danger-zone">
          <button type="button" className="subtle-button" onClick={() => editor.resetSample()}>
            恢复示例
          </button>
          <button
            type="button"
            className="subtle-button danger"
            onClick={() => {
              if (window.confirm('确定清空桌面所有花材吗？该操作可撤销。')) editor.clearTable();
            }}
          >
            清空桌面
          </button>
        </div>
      </section>
    </aside>
  );
}
