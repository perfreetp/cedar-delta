import { useCallback, useEffect, useRef, useState } from 'react';
import { HistoryPanel, type DetailState } from './components/HistoryPanel';
import { LevelSegments, ModuleSection, Toggle } from './components/controls';
import {
  CubeIcon,
  DownloadIcon,
  FlattenIcon,
  GrabIcon,
  RaiseIcon,
  SmoothIcon,
  SymmetryIcon,
  UploadIcon,
} from './components/Icons';
import { SculptEngine } from './sculpt/SculptEngine';
import { BRUSH_META, DIAMETER_BY_LEVEL } from './sculpt/brushConfig';
import type {
  BrushKind,
  BrushSettings,
  HistorySnapshot,
  Level,
  MeshStats,
  SymmetrySettings,
} from './sculpt/types';

const EMPTY_HISTORY: HistorySnapshot = {
  records: [],
  cursor: 0,
  canUndo: false,
  canRedo: false,
  totalStrokes: 0,
};

const BRUSH_ICONS: Record<BrushKind, typeof GrabIcon> = {
  grab: GrabIcon,
  raise: RaiseIcon,
  flatten: FlattenIcon,
  smooth: SmoothIcon,
};

const FLOW_STEPS = [
  { id: '01', label: '导入基础网格' },
  { id: '02', label: '笔刷推拉塑形' },
  { id: '03', label: 'X 轴镜像校正' },
  { id: '04', label: '笔划回放 / 导出' },
];

export default function App() {
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const engineRef = useRef<SculptEngine | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const playbackTimerRef = useRef<number | null>(null);

  const [brush, setBrush] = useState<BrushSettings>({
    kind: 'raise',
    diameterLevel: 2,
    strengthLevel: 2,
  });
  const [symmetry, setSymmetry] = useState<SymmetrySettings>({
    enabled: true,
    axis: 'x',
    affectPositive: true,
    affectNegative: true,
    lockAxis: true,
  });
  const [history, setHistory] = useState<HistorySnapshot>(EMPTY_HISTORY);
  const [stats, setStats] = useState<MeshStats | null>(null);
  const [strokeActive, setStrokeActive] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [detail, setDetail] = useState<DetailState | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    if (!viewportRef.current) return;
    const engine = new SculptEngine(viewportRef.current, {
      onHistoryChange: setHistory,
      onStats: setStats,
      onStrokeActiveChange: setStrokeActive,
    });
    engineRef.current = engine;
    setHistory(engine.getHistorySnapshot() ?? EMPTY_HISTORY);

    return () => {
      engine.dispose();
      engineRef.current = null;
    };
  }, []);

  useEffect(() => {
    engineRef.current?.setBrush(brush);
  }, [brush]);

  useEffect(() => {
    engineRef.current?.setSymmetry(symmetry);
  }, [symmetry]);

  const stopPlayback = useCallback(() => {
    if (playbackTimerRef.current !== null) {
      window.clearInterval(playbackTimerRef.current);
      playbackTimerRef.current = null;
    }
    setPlaying(false);
    engineRef.current?.setInputLocked(false);
  }, []);

  useEffect(() => stopPlayback, [stopPlayback]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const tag = target?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || target?.isContentEditable) return;

      const key = event.key.toLowerCase();
      if ((event.ctrlKey || event.metaKey) && key === 'z') {
        event.preventDefault();
        if (event.shiftKey) engineRef.current?.redo();
        else engineRef.current?.undo();
        return;
      }
      if ((event.ctrlKey || event.metaKey) && key === 'y') {
        event.preventDefault();
        engineRef.current?.redo();
        return;
      }
      if (event.ctrlKey || event.metaKey || event.altKey) return;

      const kindMap: Record<string, BrushKind> = {
        g: 'grab',
        r: 'raise',
        f: 'flatten',
        s: 'smooth',
      };
      const kind = kindMap[key];
      if (kind) setBrush((current) => ({ ...current, kind }));
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  const showNotice = (message: string) => {
    setNotice(message);
    window.setTimeout(() => setNotice(null), 2600);
  };

  const handleFile = useCallback(
    async (file: File | undefined | null) => {
      if (!file || !engineRef.current) return;
      stopPlayback();
      setError(null);
      setBusy(`正在导入并焊接 ${file.name}…`);
      try {
        await engineRef.current.loadFile(file);
        setDetail(null);
        showNotice('网格已导入，重复顶点已焊接并建立邻接');
      } catch (caught) {
        setError(caught instanceof Error ? caught.message : '导入失败');
      } finally {
        setBusy(null);
        if (fileInputRef.current) fileInputRef.current.value = '';
      }
    },
    [stopPlayback],
  );

  const loadBuiltIn = () => {
    stopPlayback();
    engineRef.current?.loadBuiltIn();
    setDetail(null);
    showNotice('已重新载入内置偶头基础网格');
  };

  const handleExportOBJ = () => {
    try {
      engineRef.current?.exportOBJ();
      showNotice('当前网格已导出为 OBJ');
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'OBJ 导出失败');
    }
  };

  const handleExportGLB = async () => {
    try {
      setBusy('正在生成 GLB 文件…');
      await engineRef.current?.exportGLB();
      showNotice('当前网格已导出为 GLB');
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'GLB 导出失败');
    } finally {
      setBusy(null);
    }
  };

  const handlePlayAll = () => {
    const engine = engineRef.current;
    if (!engine || history.totalStrokes === 0) return;
    if (playing) {
      stopPlayback();
      return;
    }

    setDetail(null);
    engine.resetForReplay();
    engine.setInputLocked(true);
    setPlaying(true);

    playbackTimerRef.current = window.setInterval(() => {
      const snapshot = engine.getHistorySnapshot();
      if (!snapshot?.canRedo) {
        stopPlayback();
        return;
      }
      engine.replayNext();
    }, 480);
  };

  const handleReplayTo = (index: number) => {
    stopPlayback();
    setDetail(null);
    engineRef.current?.replayToStroke(index);
  };

  const handleToggleDetail = (id: number) => {
    if (detail?.id === id) {
      setDetail(null);
      return;
    }
    const rows = engineRef.current?.getStrokeDetail(id) ?? [];
    setDetail({ id, rows });
  };

  const toggleSide = (side: 'positive' | 'negative', value: boolean) => {
    setSymmetry((current) => ({
      ...current,
      affectPositive: side === 'positive' ? value : current.affectPositive,
      affectNegative: side === 'negative' ? value : current.affectNegative,
    }));
  };

  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="brand">
          <div className="brand-mark">
            <CubeIcon width={24} height={24} />
          </div>
          <div>
            <h1>偶头面容雕刻台</h1>
            <p>TypeScript · React · Three.js 顶点塑形 / X 对称 / 笔划回放</p>
          </div>
        </div>
        <div className="topbar-actions">
          <span className={`live-pill ${strokeActive ? 'sculpting' : ''}`}>
            <i />
            {playing ? '回放中' : strokeActive ? '正在落笔' : '引擎就绪'}
          </span>
          <button
            type="button"
            className="top-action"
            onClick={() => engineRef.current?.undo()}
            disabled={!history.canUndo || playing}
          >
            撤销
          </button>
          <button
            type="button"
            className="top-action"
            onClick={() => engineRef.current?.redo()}
            disabled={!history.canRedo || playing}
          >
            重做
          </button>
          <button type="button" className="top-action accent" onClick={handleExportOBJ}>
            <DownloadIcon width={17} height={17} />
            导出
          </button>
        </div>
      </header>

      <nav className="flowbar" aria-label="雕刻流程">
        {FLOW_STEPS.map((step, index) => (
          <div className="flow-step" key={step.id}>
            <span className="flow-id">{step.id}</span>
            <span>{step.label}</span>
            {index < FLOW_STEPS.length - 1 ? <i className="flow-arrow">→</i> : null}
          </div>
        ))}
      </nav>

      <main className="workspace">
        <aside className="left-column">
          <ModuleSection
            index="01"
            title="导入偶头网格"
            subtitle="内置偶头可直接雕刻，也支持 OBJ / GLB / GLTF"
            icon={<UploadIcon width={18} height={18} />}
          >
            <input
              ref={fileInputRef}
              type="file"
              accept=".obj,.glb,.gltf"
              hidden
              onChange={(event) => void handleFile(event.target.files?.[0])}
            />
            <button
              type="button"
              className="primary-block"
              onClick={() => fileInputRef.current?.click()}
              disabled={busy !== null}
            >
              <UploadIcon width={19} height={19} />
              选择基础网格文件
            </button>
            <button type="button" className="secondary-block" onClick={loadBuiltIn}>
              <CubeIcon width={18} height={18} />
              重新载入内置偶头
            </button>
            <div className="format-chips">
              <span>.OBJ</span>
              <span>.GLB</span>
              <span>.GLTF</span>
              <em>导入后自动焊接重复顶点</em>
            </div>
            {stats ? (
              <div className="mesh-stat-card">
                <div>
                  <span>当前网格</span>
                  <strong title={stats.name}>{stats.name}</strong>
                </div>
                <div className="stat-numbers">
                  <span>
                    <b>{stats.vertices.toLocaleString()}</b>顶点
                  </span>
                  <span>
                    <b>{stats.triangles.toLocaleString()}</b>三角面
                  </span>
                </div>
              </div>
            ) : null}
          </ModuleSection>

          <ModuleSection
            index="02"
            title="笔刷面板"
            subtitle="四种塑形笔刷，直径与强度各三档"
          >
            <div className="brush-grid">
              {(Object.keys(BRUSH_META) as BrushKind[]).map((kind) => {
                const Icon = BRUSH_ICONS[kind];
                const meta = BRUSH_META[kind];
                return (
                  <button
                    key={kind}
                    type="button"
                    className={`brush-button ${brush.kind === kind ? 'active' : ''}`}
                    onClick={() => setBrush((current) => ({ ...current, kind }))}
                  >
                    <Icon width={24} height={24} />
                    <strong>{meta.name}</strong>
                    <small>{meta.english}</small>
                    <kbd>{meta.shortcut}</kbd>
                  </button>
                );
              })}
            </div>
            <p className="brush-hint">{BRUSH_META[brush.kind].hint}</p>
            <LevelSegments<Level>
              label="笔刷直径"
              value={brush.diameterLevel}
              options={[1, 2, 3] as const}
              onChange={(value) => setBrush((current) => ({ ...current, diameterLevel: value }))}
              formatValue={(value) => `Ø ${DIAMETER_BY_LEVEL[value].toFixed(2)}`}
            />
            <LevelSegments<Level>
              label="笔刷强度"
              value={brush.strengthLevel}
              options={[1, 2, 3] as const}
              onChange={(value) => setBrush((current) => ({ ...current, strengthLevel: value }))}
              formatValue={(value) => ['轻柔', '标准', '强烈'][value - 1]}
            />
          </ModuleSection>

          <ModuleSection
            index="03"
            title="X 轴对称"
            subtitle="开启后另一侧实时生成镜像笔划"
            icon={<SymmetryIcon width={19} height={19} />}
          >
            <Toggle
              checked={symmetry.enabled}
              onChange={(enabled) => setSymmetry((current) => ({ ...current, enabled }))}
              label="启用 X 轴镜像"
              description="镜像位移会翻转 X 分量；轴线顶点只计算一次"
            />
            <div className={`side-grid ${symmetry.enabled ? '' : 'disabled'}`}>
              <button
                type="button"
                className={symmetry.affectPositive ? 'active positive' : ''}
                disabled={!symmetry.enabled}
                onClick={() => toggleSide('positive', !symmetry.affectPositive)}
              >
                +X 侧{symmetry.affectPositive ? '已开启' : '已关闭'}
              </button>
              <button
                type="button"
                className={symmetry.affectNegative ? 'active negative' : ''}
                disabled={!symmetry.enabled}
                onClick={() => toggleSide('negative', !symmetry.affectNegative)}
              >
                −X 侧{symmetry.affectNegative ? '已开启' : '已关闭'}
              </button>
            </div>
            <Toggle
              checked={symmetry.lockAxis}
              onChange={(lockAxis) => setSymmetry((current) => ({ ...current, lockAxis }))}
              label="锁定轴线 X = 0"
              description="避免对称轴顶点被原始笔刷和镜像笔刷重复推拉"
            />
          </ModuleSection>
        </aside>

        <section className="viewport-column">
          <div
            className={`viewport-card ${dragOver ? 'drag-over' : ''}`}
            onDragOver={(event) => {
              event.preventDefault();
              setDragOver(true);
            }}
            onDragLeave={(event) => {
              if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
                setDragOver(false);
              }
            }}
            onDrop={(event) => {
              event.preventDefault();
              setDragOver(false);
              void handleFile(event.dataTransfer.files?.[0]);
            }}
          >
            <div ref={viewportRef} className="three-host" aria-label="Three.js 雕刻视口" />

            <div className="viewport-top-left">
              <span className="chip">{BRUSH_META[brush.kind].name}笔刷</span>
              <span className="chip subtle">
                直径 {DIAMETER_BY_LEVEL[brush.diameterLevel].toFixed(2)}
              </span>
              {symmetry.enabled ? <span className="chip symmetry">X Mirror</span> : null}
            </div>

            <div className="viewport-help">
              <div><kbd>左键</kbd> 雕刻</div>
              <div><kbd>右键拖动</kbd> 旋转</div>
              <div><kbd>滚轮</kbd> 缩放 · <kbd>中键</kbd> 平移</div>
              <div><kbd>G/R/F/S</kbd> 切笔刷 · <kbd>Ctrl+Z</kbd> 撤销</div>
            </div>

            {strokeActive ? <div className="sculpt-cursor-label">正在合并顶点位移…</div> : null}

            {dragOver ? (
              <div className="drop-overlay">
                <UploadIcon width={42} height={42} />
                <strong>松开以导入偶头网格</strong>
                <span>OBJ / GLB / GLTF</span>
              </div>
            ) : null}

            {busy ? (
              <div className="busy-overlay">
                <div className="spinner" />
                <span>{busy}</span>
              </div>
            ) : null}
          </div>

          <div className="export-bar">
            <div>
              <strong>完成修整后导出当前网格</strong>
              <span>导出的是当前撤销/回放位置的真实顶点数据</span>
            </div>
            <div className="export-actions">
              <button type="button" className="export-button" onClick={handleExportOBJ}>
                <DownloadIcon width={18} height={18} />
                OBJ 文件
              </button>
              <button
                type="button"
                className="export-button primary"
                onClick={() => void handleExportGLB()}
                disabled={busy !== null}
              >
                <DownloadIcon width={18} height={18} />
                GLB 文件
              </button>
            </div>
          </div>
        </section>

        <aside className="right-column">
          <ModuleSection
            index="04"
            title="笔划管理"
            subtitle="每次落笔的位移、撤销重做与逐条回放"
          >
            <HistoryPanel
              snapshot={history}
              playing={playing}
              detail={detail}
              onUndo={() => engineRef.current?.undo()}
              onRedo={() => engineRef.current?.redo()}
              onPlayAll={handlePlayAll}
              onStop={stopPlayback}
              onReplayTo={handleReplayTo}
              onToggleDetail={handleToggleDetail}
            />
          </ModuleSection>
        </aside>
      </main>

      {error ? (
        <div className="toast error" role="alert">
          <strong>操作未完成</strong>
          <span>{error}</span>
          <button type="button" onClick={() => setError(null)}>×</button>
        </div>
      ) : null}
      {notice ? (
        <div className="toast success" role="status">
          <span>{notice}</span>
        </div>
      ) : null}
    </div>
  );
}
