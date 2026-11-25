import assert from 'node:assert/strict';
import test from 'node:test';
import {
  circumcircle3,
  ellipsoidPlanePolygon,
  rayAxisParameter,
  rayPlane,
  type RayLike,
} from '../src/core/math.ts';

test('three corneal points recover known radius', () => {
  const center: [number, number, number] = [0, 0, 6.62];
  const r = 7.82;
  const circle = circumcircle3(
    [center[0], center[1], center[2] + r],
    [center[0], 4, center[2] + Math.sqrt(r * r - 16)],
    [center[0], -4, center[2] + Math.sqrt(r * r - 16)],
  );
  assert.equal(circle.valid, true);
  assert.ok(Math.abs(circle.radius - r) < 0.02, `expected ${r}, got ${circle.radius}`);
});

test('ray plane intersection and axis parameter are stable', () => {
  const ray: RayLike = { origin: [5, 2, -8], direction: [0, 0, 1] };
  const p = rayPlane(ray, [0, 0, 0], [0, 0, 1]);
  assert.deepEqual(p, [5, 2, 0]);
  const t = rayAxisParameter({ origin: [4, 1, -10], direction: [0, 0, 1] }, [0, 0, 0], [1, 0, 0]);
  assert.ok(Math.abs(t - 4) < 1e-6);
});

test('ellipsoid central section has expected axial height', () => {
  const polygon = ellipsoidPlanePolygon(
    {
      center: [0, 0, 8.05],
      radii: [4.6, 4.6, 2.05],
      basis: [
        [1, 0, 0],
        [0, 1, 0],
        [0, 0, 1],
      ],
    },
    [1, 0, 0],
    0,
    64,
  );
  assert.ok(polygon);
  const zs = polygon.points.map((p) => p[2]);
  assert.ok(Math.max(...zs) > 10.05 - 0.01);
  assert.ok(Math.min(...zs) < 6.05 + 0.01);
});
