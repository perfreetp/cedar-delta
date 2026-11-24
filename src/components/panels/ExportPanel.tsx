import { useRef } from 'react';
import { useEditorStore } from '../../store';
import { getEngine } from '../../engineRegistry';
import { ActionButton, PanelSection } from '../Controls';
import { downloadTrack, parseTrack, serializeTrack } from '../../lib/serializer';
import { makeSnapshot } from '../../lib/history';
import { GRID_SEGMENTS, TERRAIN_LENGTH, TERRAIN_WIDTH } from '../../lib/constants';

export function ExportPanel(): JSX.Element {
  const trackName = useEditorStore((s) => s.trackName);
  const controlPoints = useEditorStore((s) => s.controlPoints);
  const steps = useEditorStore((s) => s.steps);
  const gates = useEditorStore((s) => s.gates);
  const showToast = useEditorStore((s) => s.showToast);
  const fileRef = useRef<HTMLInputElement>(null);
  const engine = getEngine();

  const handleExport = (): void => {
    if (!engine) return;
    const file = serializeTrack(trackName, engine.getHeights(), controlPoints, steps, gates);
    downloadTrack(file);
    showToast(`赛道「${trackName}」已导出,共 ${file.baseHeights.length} 个高程点`);
  };

  const handleImport = async (file: File): Promise<void> => {
    try {
      const text = await file.text();
      const track = parseTrack(text);
      if (
        track.grid.segments !== GRID_SEGMENTS ||
        track.grid.width !== TERRAIN_WIDTH ||
        track.grid.length !== TERRAIN_LENGTH
      ) {
        showToast('网格规格与当前编辑器不一致,导入中止');
        return;
      }
      const engineNow = getEngine();
      if (!engineNow) return;
      engineNow.loadSnapshot(
        makeSnapshot(
          new Float32Array(track.baseHeights),
          track.controlPoints,
          track.steps,
          track.gates,
        ),
      );
      useEditorStore.getState().setTrackName(track.meta.name);
      showToast(`已导入赛道「${track.meta.name}」`);
    } catch (err) {
      showToast(`导入失败:${(err as Error).message}`);
    }
  };

  const sizeKb = engine
    ? (
        JSON.stringify(
          serializeTrack(trackName, engine.getHeights(), controlPoints, steps, gates),
        ).length / 1024
      ).toFixed(0)
    : '0';

  return (
    <div className="panel">
      <PanelSection title="赛道概览">
        <div className="stat-grid">
          <div className="stat">
            <small>网格分辨率</small>
            <b>
              {GRID_SEGMENTS + 1}×{GRID_SEGMENTS + 1}
            </b>
          </div>
          <div className="stat">
            <small>控制点数</small>
            <b>{controlPoints.length}</b>
          </div>
          <div className="stat">
            <small>跌水台阶</small>
            <b>{steps.length}</b>
          </div>
          <div className="stat">
            <small>闸门数量</small>
            <b>{gates.length}</b>
          </div>
        </div>
      </PanelSection>

      <PanelSection title="导出赛道文件">
        <p className="muted">
          导出为自包含的 <code>.whtrack.json</code>:包含中心线、台阶、闸门及全部河床高程,可分享后重新导入继续编辑。
        </p>
        <ActionButton variant="primary" onClick={handleExport}>
          ⬇ 导出赛道文件
        </ActionButton>
        <p className="muted">预估文件体积约 {sizeKb} KB</p>
      </PanelSection>

      <PanelSection title="导入赛道">
        <input
          ref={fileRef}
          type="file"
          accept="application/json,.json"
          style={{ display: 'none' }}
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) void handleImport(f);
            e.target.value = '';
          }}
        />
        <ActionButton onClick={() => fileRef.current?.click()}>⬆ 选择文件导入</ActionButton>
        <p className="muted">导入会替换当前全部内容并清空历史记录。</p>
      </PanelSection>
    </div>
  );
}
