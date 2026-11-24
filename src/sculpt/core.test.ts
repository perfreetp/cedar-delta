import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { OBJExporter } from 'three/examples/jsm/exporters/OBJExporter.js';
import { StrokeHistory } from './history';
import { SculptKernel } from './kernel';
import { buildTopology } from './topology';
import { createDollHeadGeometry } from './createDollHead';
import type { SymmetrySettings } from './types';

function makeGrid(size = 5, spacing = 1) {
  const half = (size - 1) / 2;
  const positions: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];

  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      positions.push((x - half) * spacing, (y - half) * spacing, 0);
      uvs.push(x / (size - 1), y / (size - 1));
    }
  }

  for (let y = 0; y < size - 1; y += 1) {
    for (let x = 0; x < size - 1; x += 1) {
      const a = y * size + x;
      const b = a + 1;
      const c = a + size;
      const d = c + 1;
      indices.push(a, c, b, b, c, d);
    }
  }

  return {
    positions: Float32Array.from(positions),
    normals: new Float32Array(positions.map((_, i) => (i % 3 === 2 ? 1 : 0))),
    indices: Uint32Array.from(indices),
    indexOf: (x: number, y: number) => (y + half) * size + (x + half),
  };
}

const symmetryOn: SymmetrySettings = {
  enabled: true,
  axis: 'x',
  affectPositive: true,
  affectNegative: true,
  lockAxis: true,
};

describe('StrokeHistory', () => {
  it('undoes overlapping strokes exactly and redoes them', () => {
    const original = Float32Array.from([0, 0, 0, 1, 2, 3, -1, 0, 1]);
    const positions = original.slice();
    const history = new StrokeHistory(positions);

    history.beginStroke(positions);
    positions[0] += 0.37;
    positions[4] += 0.2;
    history.commitStroke(positions, new Set([0, 1]), {
      brush: 'grab',
      title: '抓取',
      diameterLevel: 2,
      strengthLevel: 2,
      symmetric: false,
      pointerCount: 2,
      mirrorCount: 0,
      axisCount: 0,
    });
    const afterFirst = positions.slice();

    history.beginStroke(positions);
    positions[0] += 0.11;
    positions[3] -= 0.4;
    history.commitStroke(positions, new Set([0, 1]), {
      brush: 'raise',
      title: '隆起',
      diameterLevel: 1,
      strengthLevel: 3,
      symmetric: false,
      pointerCount: 2,
      mirrorCount: 0,
      axisCount: 0,
    });
    const afterSecond = positions.slice();

    expect(history.cursor).toBe(2);
    history.undo(positions);
    expect(Array.from(positions)).toEqual(Array.from(afterFirst));

    history.undo(positions);
    expect(Array.from(positions)).toEqual(Array.from(original));

    history.redo(positions);
    history.redo(positions);
    expect(Array.from(positions)).toEqual(Array.from(afterSecond));

    history.replayTo(positions, 0);
    expect(Array.from(positions)).toEqual(Array.from(afterFirst));
  });
});

describe('SculptKernel symmetry', () => {
  it('processes an axis vertex once and locks its X coordinate', () => {
    const grid = makeGrid(5, 1);
    const topology = buildTopology(grid.indices, grid.positions.length / 3);
    const kernel = new SculptKernel(grid.positions, grid.normals, topology, 1e-6);
    const axisCenter = grid.indexOf(0, 0);

    const result = kernel.applyStamp({
      kind: 'grab',
      center: { x: 0, y: 0, z: 0 },
      radius: 10,
      strength: 1,
      grabDelta: { x: 1, y: 1, z: 0 },
      symmetry: symmetryOn,
    });

    expect(new Set(result.indices).size).toBe(result.indices.length);
    expect(result.axisCount).toBe(5);
    expect(grid.positions[axisCenter * 3]).toBeCloseTo(0, 10);
    // Once, not twice: full center weight and strength produce exactly one y unit.
    expect(grid.positions[axisCenter * 3 + 1]).toBeCloseTo(1, 5);
  });

  it('mirrors displacement vectors and merges both sides in one stroke', () => {
    const grid = makeGrid(5, 1);
    const topology = buildTopology(grid.indices, grid.positions.length / 3);
    const kernel = new SculptKernel(grid.positions, grid.normals, topology, 1e-6);
    const positive = grid.indexOf(1, 0);
    const negative = grid.indexOf(-1, 0);

    kernel.applyStamp({
      kind: 'grab',
      center: { x: 1, y: 0, z: 0 },
      radius: 0.55,
      strength: 1,
      grabDelta: { x: 0.3, y: 0.5, z: 0 },
      symmetry: symmetryOn,
    });

    expect(grid.positions[positive * 3]).toBeCloseTo(1.3, 6);
    expect(grid.positions[positive * 3 + 1]).toBeCloseTo(0.5, 6);
    expect(grid.positions[negative * 3]).toBeCloseTo(-1.3, 6);
    expect(grid.positions[negative * 3 + 1]).toBeCloseTo(0.5, 6);
  });

  it('respects a disabled side', () => {
    const grid = makeGrid(5, 1);
    const topology = buildTopology(grid.indices, grid.positions.length / 3);
    const kernel = new SculptKernel(grid.positions, grid.normals, topology, 1e-6);
    const negative = grid.indexOf(-1, 0);

    kernel.applyStamp({
      kind: 'raise',
      center: { x: 1, y: 0, z: 0 },
      radius: 0.55,
      strength: 1,
      dt: 1 / 60,
      symmetry: { ...symmetryOn, affectNegative: false },
    });

    expect(grid.positions[negative * 3 + 2]).toBeCloseTo(0, 10);
  });
});

describe('SculptKernel smooth brush', () => {
  it('uses adjacent weighted vertices and never produces NaN collapse', () => {
    const grid = makeGrid(3, 1);
    const center = grid.indexOf(0, 0);
    grid.positions[center * 3 + 2] = 1;
    const topology = buildTopology(grid.indices, grid.positions.length / 3);
    const kernel = new SculptKernel(grid.positions, grid.normals, topology, 1e-6);

    for (let i = 0; i < 12; i += 1) {
      kernel.applyStamp({
        kind: 'smooth',
        center: { x: 0, y: 0, z: 1 },
        radius: 1.7,
        strength: 0.72,
        dt: 1 / 60,
        symmetry: { ...symmetryOn, enabled: false },
      });
    }

    for (const value of grid.positions) {
      expect(Number.isFinite(value)).toBe(true);
    }
    expect(grid.positions[center * 3 + 2]).toBeLessThan(0.9);
    expect(grid.positions[center * 3 + 2]).toBeGreaterThan(-0.25);
  });
});

describe('mesh export', () => {
  it('serializes the current indexed mesh as OBJ', () => {
    const geometry = createDollHeadGeometry();
    const mesh = new THREE.Mesh(geometry);
    const obj = new OBJExporter().parse(mesh);

    expect(obj).toContain('v ');
    expect(obj).toContain('f ');
    expect(obj.split('\n').filter((line) => line.startsWith('v ')).length).toBe(
      geometry.getAttribute('position').count,
    );
  });
});
