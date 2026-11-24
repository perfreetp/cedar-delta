import { useEffect, useRef } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { store, useAppState } from '../state/store';
import { useFont } from '../font/fontManager';
import { getBlockGeometry, glyphAdvance } from '../geometry/extrude';
import { layoutBlocks } from '../layout/pathLayout';

const bodyMat = new THREE.MeshStandardMaterial({
  color: 0xf2c9c0, // 香槟粉
  metalness: 0.55,
  roughness: 0.32,
});
const reliefMat = new THREE.MeshStandardMaterial({
  color: 0x8a5a3b, // 深铜色，内凹镶嵌观感
  metalness: 0.7,
  roughness: 0.45,
  polygonOffset: true,
  polygonOffsetFactor: -2,
});
const selectedMat = new THREE.MeshStandardMaterial({
  color: 0xffd27d,
  metalness: 0.6,
  roughness: 0.3,
  emissive: 0x332200,
});
const overlapMat = new THREE.MeshStandardMaterial({
  color: 0xff6b6b,
  metalness: 0.4,
  roughness: 0.4,
  emissive: 0x440000,
});

interface BlockEntry {
  group: THREE.Group;
  body: THREE.Mesh;
  relief: THREE.Mesh | null;
  glyphIndex: number;
  geoKey: string;
}

/**
 * 三维视口：场景只初始化一次，字块网格按 state 差量同步；
 * 几何体由 extrude 模块缓存（同字形+同参数共享），
 * 几百字块时拖动滑块只更新 transform，不重建几何。
 */
export function Viewport() {
  const state = useAppState();
  const font = useFont();
  const mountRef = useRef<HTMLDivElement>(null);
  const sceneRef = useRef<{
    scene: THREE.Scene;
    camera: THREE.PerspectiveCamera;
    renderer: THREE.WebGLRenderer;
    controls: OrbitControls;
    blocksGroup: THREE.Group;
    hintGroup: THREE.Group;
    pathLine: THREE.Line;
    entries: Map<string, BlockEntry>;
    raycaster: THREE.Raycaster;
  } | null>(null);

  // 初始化场景（一次）
  useEffect(() => {
    const mount = mountRef.current!;
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x1e1a20);

    const camera = new THREE.PerspectiveCamera(45, 1, 0.01, 500);
    camera.position.set(0, 1.2, 4.5);

    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    mount.appendChild(renderer.domElement);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.08;

    scene.add(new THREE.AmbientLight(0xffffff, 0.5));
    const key = new THREE.DirectionalLight(0xfff2e0, 1.6);
    key.position.set(3, 5, 4);
    scene.add(key);
    const rim = new THREE.DirectionalLight(0xc0d8ff, 0.7);
    rim.position.set(-4, 2, -3);
    scene.add(rim);

    const grid = new THREE.GridHelper(20, 40, 0x554a5a, 0x352e3a);
    grid.position.y = -0.6;
    scene.add(grid);

    const blocksGroup = new THREE.Group();
    scene.add(blocksGroup);
    const hintGroup = new THREE.Group();
    scene.add(hintGroup);
    const pathGeo = new THREE.BufferGeometry();
    const pathLine = new THREE.Line(
      pathGeo,
      new THREE.LineBasicMaterial({ color: 0xff9eb5, transparent: true, opacity: 0.5 }),
    );
    scene.add(pathLine);

    const raycaster = new THREE.Raycaster();

    const ctx = {
      scene, camera, renderer, controls, blocksGroup, hintGroup, pathLine,
      entries: new Map<string, BlockEntry>(), raycaster,
    };
    sceneRef.current = ctx;

    // 点击选中字块
    const onClick = (e: MouseEvent) => {
      const rect = renderer.domElement.getBoundingClientRect();
      const ndc = new THREE.Vector2(
        ((e.clientX - rect.left) / rect.width) * 2 - 1,
        -((e.clientY - rect.top) / rect.height) * 2 + 1,
      );
      raycaster.setFromCamera(ndc, camera);
      const hits = raycaster.intersectObjects(blocksGroup.children, true);
      const hit = hits.find((h) => h.object.userData.blockId);
      store.commit((s) => ({
        ...s,
        selectedId: hit ? (hit.object.userData.blockId as string) : null,
      }));
    };
    renderer.domElement.addEventListener('click', onClick);

    const resize = () => {
      const w = mount.clientWidth, h = mount.clientHeight;
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      renderer.setSize(w, h);
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(mount);

    let raf = 0;
    const loop = () => {
      raf = requestAnimationFrame(loop);
      controls.update();
      renderer.render(scene, camera);
    };
    loop();

    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      renderer.domElement.removeEventListener('click', onClick);
      controls.dispose();
      renderer.dispose();
      mount.removeChild(renderer.domElement);
      sceneRef.current = null;
    };
  }, []);

  // 状态 → 网格差量同步
  useEffect(() => {
    const ctx = sceneRef.current;
    if (!ctx) return;
    const { blocksGroup, hintGroup, pathLine, entries } = ctx;

    if (!font) {
      entries.forEach((e) => blocksGroup.remove(e.group));
      entries.clear();
      hintGroup.clear();
      pathLine.geometry.setAttribute('position', new THREE.Float32BufferAttribute([], 3));
      return;
    }

    const widths = new Map<string, number>();
    for (const b of state.blocks) widths.set(b.id, glyphAdvance(b.glyphIndex));
    const layout = layoutBlocks(state.blocks, widths, state.layout);
    const overlapIds = new Set<string>();
    layout.overlaps.forEach((o) => { overlapIds.add(o.aId); overlapIds.add(o.bId); });

    const geoKeyOf = (glyphIndex: number) =>
      `${glyphIndex}|${state.extrude.depth}|${state.extrude.bevelSize}|${state.extrude.bevelThickness}|${state.extrude.bevelSegments}|${state.extrude.reliefScale}|${state.extrude.reliefDepth}`;

    // 移除已删除的字块
    const alive = new Set(state.blocks.map((b) => b.id));
    entries.forEach((entry, id) => {
      if (!alive.has(id)) {
        blocksGroup.remove(entry.group);
        entries.delete(id);
      }
    });

    // 创建/更新字块
    for (const placement of layout.placements) {
      const block = state.blocks.find((b) => b.id === placement.id)!;
      const key = geoKeyOf(block.glyphIndex);
      let entry = entries.get(block.id);
      if (!entry || entry.geoKey !== key) {
        if (entry) blocksGroup.remove(entry.group);
        const geo = getBlockGeometry(block.glyphIndex, state.extrude);
        if (!geo) continue;
        const group = new THREE.Group();
        const body = new THREE.Mesh(geo.body, bodyMat);
        body.userData.blockId = block.id;
        // 以字形中心为局部原点，便于沿路径摆放
        const cx = (geo.bounds.minX + geo.bounds.maxX) / 2;
        const cy = (geo.bounds.minY + geo.bounds.maxY) / 2;
        body.position.set(-cx, -cy, 0);
        group.add(body);
        let reliefMesh: THREE.Mesh | null = null;
        if (geo.relief) {
          reliefMesh = new THREE.Mesh(geo.relief, reliefMat);
          reliefMesh.userData.blockId = block.id;
          // 嵌片贴在前脸平面（视觉内凹镶嵌）
          reliefMesh.position.set(-cx, -cy, geo.frontZ - state.extrude.reliefDepth + 0.002);
          group.add(reliefMesh);
        }
        entry = { group, body, relief: reliefMesh, glyphIndex: block.glyphIndex, geoKey: key };
        entries.set(block.id, entry);
        blocksGroup.add(group);
      }
      // 位姿：位置 + 朝向路径切线（弧面法线随曲率联动）
      entry.group.position.set(placement.x, 0, placement.z);
      entry.group.rotation.set(0, placement.rotY, 0);
      // 材质：选中 > 重叠 > 默认
      const mat =
        block.id === state.selectedId ? selectedMat : overlapIds.has(block.id) ? overlapMat : bodyMat;
      if (entry.body.material !== mat) entry.body.material = mat;
    }

    // 重叠吸附提示线
    hintGroup.clear();
    if (layout.overlaps.length > 0) {
      const pts: number[] = [];
      for (const o of layout.overlaps) {
        pts.push(o.ax, 0.9, o.az, o.bx, 0.9, o.bz);
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
      const lines = new THREE.LineSegments(
        g,
        new THREE.LineBasicMaterial({ color: 0xff4d4d }),
      );
      hintGroup.add(lines);
    }

    // 路径引导线
    if (layout.pathPoints.length >= 2) {
      const pts: number[] = [];
      layout.pathPoints.forEach(([x, z]) => pts.push(x, -0.55, z));
      pathLine.geometry.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
    } else {
      pathLine.geometry.setAttribute('position', new THREE.Float32BufferAttribute([], 3));
    }
  }, [state, font]);

  return <div ref={mountRef} className="viewport" />;
}
