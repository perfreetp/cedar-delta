import type { ColliderSpec, Obstacle } from '../types';

export function colliderHalfHeight(spec: ColliderSpec): number {
  if (spec.kind === 'box') return spec.size[1] / 2;
  if (spec.kind === 'cylinder') return spec.height / 2;
  return Math.max(
    ...spec.parts.map((part) => {
      const base = colliderHalfHeight(part.collider);
      const centerY = part.position?.[1] ?? 0;
      return centerY + base;
    }),
    0.5,
  );
}

export function colliderBoundingRadius(spec: ColliderSpec): number {
  if (spec.kind === 'box') {
    const [x, y, z] = spec.size;
    return Math.sqrt(x * x + y * y + z * z) / 2;
  }
  if (spec.kind === 'cylinder') {
    return Math.sqrt(spec.radius * spec.radius + (spec.height / 2) ** 2);
  }
  return spec.parts.reduce((maximum, part) => {
    const offset = part.position ? Math.hypot(...part.position) : 0;
    return Math.max(maximum, offset + colliderBoundingRadius(part.collider));
  }, 0.1);
}

export function verticalPositionForExposure(obstacle: Obstacle, exposure: number): number {
  const half = colliderHalfHeight(obstacle.collider) * obstacle.scale[1];
  return exposure - half;
}

export function obstacleDisplayName(id: string, obstacles: Obstacle[]): string {
  return obstacles.find((o) => o.id === id)?.name ?? '已删除障碍';
}

export function formatVolume(value: number): string {
  if (!Number.isFinite(value)) return '—';
  if (value >= 100) return value.toFixed(0);
  if (value >= 10) return value.toFixed(1);
  return value.toFixed(2);
}
