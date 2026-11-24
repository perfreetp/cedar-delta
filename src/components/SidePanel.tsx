import { useEditorStore } from '../store';
import { SculptPanel } from './panels/SculptPanel';
import { ProfilePanel } from './panels/ProfilePanel';
import { GatePanel } from './panels/GatePanel';
import { ExportPanel } from './panels/ExportPanel';
import { PanelSection, ActionButton } from './Controls';

function CenterlinePanel(): JSX.Element {
  const controlPoints = useEditorStore((s) => s.controlPoints);
  const setModule = useEditorStore((s) => s.setModule);
  return (
    <div className="panel">
      <PanelSection title="赛道中心线编辑">
        <p className="muted">
          拖动视口中的黄色控制点调整弯道走向与曲率。河床宽度随曲率自适应收窄,松开鼠标后地形与闸门自动重建。
        </p>
        <ul className="tips">
          <li>黄色球体:Catmull-Rom 样条控制点</li>
          <li>青色线:中心线;青色虚线:两岸边界</li>
          <li>弯越急,河道越窄(下限 45%)</li>
        </ul>
        <div className="stat-grid">
          <div className="stat">
            <small>控制点</small>
            <b>{controlPoints.length}</b>
          </div>
        </div>
        <ActionButton onClick={() => setModule('profile')}>返回坡度剖面</ActionButton>
      </PanelSection>
    </div>
  );
}

export function SidePanel(): JSX.Element {
  const activeModule = useEditorStore((s) => s.activeModule);
  const toolMode = useEditorStore((s) => s.toolMode);

  return (
    <aside className="sidepanel">
      {toolMode === 'centerline' ? (
        <CenterlinePanel />
      ) : (
        <>
          {activeModule === 'sculpt' && <SculptPanel />}
          {activeModule === 'profile' && <ProfilePanel />}
          {activeModule === 'gate' && <GatePanel />}
          {activeModule === 'export' && <ExportPanel />}
        </>
      )}
    </aside>
  );
}
