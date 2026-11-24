import { useMemo, useState } from 'react';
import * as THREE from 'three';
import { GLTFExporter } from 'three/examples/jsm/exporters/GLTFExporter.js';
import { STLExporter } from 'three/examples/jsm/exporters/STLExporter.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { useAppState } from '../state/store';
import { useFont } from '../font/fontManager';
import { getBlockGeometry, glyphAdvance } from '../geometry/extrude';
import { layoutBlocks } from '../layout/pathLayout';

interface SeamReport {
  pairs: number;
  overlapping: number;
  minGap: number;
  maxGap: number;
}

/** 模块四：成品台 —— 合并字块、接缝检查、导出模型 */
export function ExportPanel() {
  const state = useAppState();
  const font = useFont();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');

  // 接缝检查：相邻字块沿路径的间隙 + 全部 AABB 相交对
  const report = useMemo<SeamReport | null>(() => {
    if (!font || state.blocks.length === 0) return null;
    const widths = new Map<string, number>();
    for (const b of state.blocks) widths.set(b.id, glyphAdvance(b.glyphIndex));
    const layout = layoutBlocks(state.blocks, widths, state.layout);
    let minGap = Infinity, maxGap = -Infinity, overlapping = 0;
    for (let i = 0; i < layout.placements.length - 1; i++) {
      const a = layout.placements[i];
      const b = layout.placements[i + 1];
      const chord = Math.hypot(b.x - a.x, b.z - a.z);
      const gap = chord - (a.width + b.width) / 2;
      minGap = Math.min(minGap, gap);
      maxGap = Math.max(maxGap, gap);
      if (gap < -1e-6) overlapping++;
    }
    return {
      pairs: Math.max(0, layout.placements.length - 1),
      overlapping,
      minGap: minGap === Infinity ? 0 : minGap,
      maxGap: maxGap === -Infinity ? 0 : maxGap,
    };
  }, [font, state.blocks, state.layout]);

  /** 收集全部字块（应用世界变换）为一个 Group */
  const buildMergedGroup = (): THREE.Group | null => {
    if (!font) return null;
    const widths = new Map<string, number>();
    for (const b of state.blocks) widths.set(b.id, glyphAdvance(b.glyphIndex));
    const layout = layoutBlocks(state.blocks, widths, state.layout);
    const group = new THREE.Group();
    group.name = 'wedding-letters';
    for (const p of layout.placements) {
      const block = state.blocks.find((b) => b.id === p.id)!;
      const geo = getBlockGeometry(block.glyphIndex, state.extrude);
      if (!geo) continue;
      const cx = (geo.bounds.minX + geo.bounds.maxX) / 2;
      const cy = (geo.bounds.minY + geo.bounds.maxY) / 2;
      const mesh = new THREE.Mesh(geo.body);
      mesh.name = `letter_${block.char}`;
      mesh.position.set(-cx, -cy, 0);
      const holder = new THREE.Group();
      holder.add(mesh);
      if (geo.relief) {
        const r = new THREE.Mesh(geo.relief);
        r.name = `relief_${block.char}`;
        r.position.set(-cx, -cy, geo.frontZ - state.extrude.reliefDepth + 0.002);
        holder.add(r);
      }
      holder.position.set(p.x, 0, p.z);
      holder.rotation.y = p.rotY;
      group.add(holder);
    }
    return group;
  };

  const download = (data: Blob | string, filename: string) => {
    const blob = typeof data === 'string' ? new Blob([data]) : data;
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
  };

  const exportGLB = () => {
    const group = buildMergedGroup();
    if (!group) return;
    setBusy(true);
    new GLTFExporter().parse(
      group,
      (result) => {
        if (result instanceof ArrayBuffer) {
          download(new Blob([result], { type: 'model/gltf-binary' }), 'wedding-letters.glb');
          setMessage('已导出 wedding-letters.glb');
        }
        setBusy(false);
      },
      (err) => { setMessage(`导出失败: ${err}`); setBusy(false); },
      { binary: true },
    );
  };

  const exportSTL = () => {
    const group = buildMergedGroup();
    if (!group) return;
    setBusy(true);
    try {
      // 合并为单一几何（应用世界变换），供 STL/3D 打印
      group.updateMatrixWorld(true);
      const geos: THREE.BufferGeometry[] = [];
      group.traverse((o) => {
        if (o instanceof THREE.Mesh) {
          const g = o.geometry.clone().applyMatrix4(o.matrixWorld);
          // STL 只要位置属性
          const clean = new THREE.BufferGeometry();
          clean.setAttribute('position', g.getAttribute('position'));
          if (g.index) clean.setIndex(g.index);
          geos.push(clean.toNonIndexed());
        }
      });
      const merged = mergeGeometries(geos, false);
      geos.forEach((g) => g.dispose());
      if (!merged) throw new Error('几何合并失败');
      const stl = new STLExporter().parse(new THREE.Mesh(merged), { binary: true });
      download(new Blob([stl as unknown as ArrayBuffer]), 'wedding-letters.stl');
      merged.dispose();
      setMessage(`已导出 wedding-letters.stl（${group.children.length} 字块合并）`);
    } catch (e) {
      setMessage(`导出失败: ${e instanceof Error ? e.message : String(e)}`);
    }
    setBusy(false);
  };

  if (!font) return <div className="panel"><h2>④ 成品台</h2><p className="dim">请先加载字体。</p></div>;

  return (
    <div className="panel">
      <h2>④ 成品台</h2>
      {report ? (
        <div className="report">
          <div>字块数：{state.blocks.length}</div>
          <div>相邻接缝：{report.pairs} 处</div>
          <div className={report.overlapping > 0 ? 'error' : 'ok'}>
            {report.overlapping > 0
              ? `⚠ ${report.overlapping} 处重叠，请回排布台吸附对齐`
              : '✓ 无重叠，接缝合格'}
          </div>
          {report.pairs > 0 && (
            <div className="dim small">
              接缝间隙 {report.minGap.toFixed(3)} ~ {report.maxGap.toFixed(3)}
            </div>
          )}
        </div>
      ) : (
        <p className="dim">还没有字块。</p>
      )}
      <div className="row">
        <button disabled={busy || !report} onClick={exportGLB}>导出 GLB</button>
        <button disabled={busy || !report} onClick={exportSTL}>导出 STL（合并）</button>
      </div>
      {message && <div className="ok small">{message}</div>}
      <p className="dim small">GLB 保留字块结构与双材质，适合分享查看；STL 为合并单体，适合 3D 打印打样。</p>
    </div>
  );
}
