import { createMemo, createSignal, Show } from 'solid-js';
import { parseScheme, serializeScheme } from '../lib/scheme';
import { downloadTextFile, formatTime, readFileAsText } from '../lib/utils';
import { projectStore } from '../state/projectStore';

export default function ExportPanel() {
  const [importError, setImportError] = createSignal('');
  const [copied, setCopied] = createSignal(false);
  const json = createMemo(() => serializeScheme(projectStore.doc));
  const filename = createMemo(() => {
    const safe = projectStore.doc.name.trim().replace(/[\\/:*?"<>|\s]+/g, '-').slice(0, 48) || 'river-layout';
    return `${safe}-${formatTime()}.rros.json`;
  });

  const download = () => {
    downloadTextFile(filename(), json());
    projectStore.showToast('方案文件已导出，可直接分享');
  };

  const copyJson = async () => {
    try {
      await navigator.clipboard.writeText(json());
      setCopied(true);
      projectStore.showToast('方案 JSON 已复制到剪贴板');
      window.setTimeout(() => setCopied(false), 1800);
    } catch {
      projectStore.showToast('浏览器拒绝剪贴板访问，请使用下载文件', 'warn');
    }
  };

  const onImportFile = async (event: Event) => {
    const input = event.currentTarget as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;
    try {
      const text = await readFileAsText(file);
      const scheme = parseScheme(text);
      projectStore.loadImportedDocument(scheme);
      setImportError('');
      projectStore.setActiveModule('library');
    } catch (error) {
      const message = error instanceof Error ? error.message : '导入失败';
      setImportError(message);
      projectStore.showToast(message, 'error');
    } finally {
      input.value = '';
    }
  };

  return (
    <div>
      <section class="panel-section">
        <h3 class="section-title">方案文件</h3>
        <div class="export-drop">
          <div style={{ 'font-size': '34px', 'font-weight': 900, color: 'var(--accent)' }}>↥</div>
          <h2 style={{ margin: '6px 0' }}>导出赛道布置方案</h2>
          <p class="help-text" style={{ margin: '0 0 14px' }}>
            文件包含障碍参数、分组、批量列、河道与阈值设置，使用 <code>.rros.json</code> 后缀，可发送给其他设计师并重新导入。
          </p>
          <button class="btn primary block" onClick={download}>下载方案文件</button>
          <div style={{ height: '8px' }} />
          <button class="btn block" onClick={copyJson}>{copied() ? '✓ 已复制' : '复制 JSON 文本'}</button>
        </div>
      </section>

      <section class="panel-section">
        <h3 class="section-title">导入并分享</h3>
        <label class="btn block" style={{ cursor: 'pointer' }}>
          ↧ 选择收到的方案文件
          <input type="file" accept=".json,application/json" style={{ display: 'none' }} onChange={onImportFile} />
        </label>
        <Show when={importError()}>
          <p class="help-text" style={{ color: '#fda4af' }}>{importError()}</p>
        </Show>
        <p class="help-text">导入会作为一次“导入方案”历史记录，可按撤销恢复当前工作区。</p>
      </section>

      <section class="panel-section">
        <h3 class="section-title">方案摘要</h3>
        <div class="export-summary">
          <div class="stat-tile"><div class="stat-value">{projectStore.doc.obstacles.length}</div><div class="stat-label">障碍</div></div>
          <div class="stat-tile"><div class="stat-value">{projectStore.doc.groups.length}</div><div class="stat-label">分组 / 批量列</div></div>
        </div>
        <div class="summary-line"><span>方案名称</span><strong>{projectStore.doc.name}</strong></div>
        <div class="summary-line"><span>河道长度 / 宽度</span><strong>{projectStore.doc.river.length} × {projectStore.doc.river.width} m</strong></div>
        <div class="summary-line"><span>占道阈值</span><strong>{projectStore.doc.detection.laneThreshold.toFixed(1)} m³</strong></div>
        <div class="summary-line"><span>暗礁阈值</span><strong>{projectStore.doc.detection.reefThreshold.toFixed(2)} m</strong></div>
        <div class="summary-line"><span>文件名</span><strong style={{ 'font-size': '11px' }}>{filename()}</strong></div>
      </section>

      <section class="panel-section">
        <h3 class="section-title">JSON 预览</h3>
        <textarea class="export-code" readOnly value={json()} spellcheck={false} />
      </section>
    </div>
  );
}
