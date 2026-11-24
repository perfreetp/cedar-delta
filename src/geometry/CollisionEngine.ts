import * as THREE from 'three';
import Module from 'manifold-3d';
import type { Manifold as ManifoldSolid, ManifoldToplevel, Mat4 } from 'manifold-3d';
import manifoldWasmUrl from 'manifold-3d/manifold.wasm?url';
import { RiverPath } from '../river';
import { colliderBoundingRadius } from '../lib/obstacleMath';
import type { ColliderSpec, Obstacle, PairCollision, RiverConfig } from '../types';

type ManifoldNamespace = ManifoldToplevel['Manifold'];

export class CollisionEngine {
  private manifold: ManifoldToplevel | null = null;
  private Manifold: ManifoldNamespace | null = null;
  private channel: ManifoldSolid | null = null;
  private initPromise: Promise<void> | null = null;

  async init(river: RiverConfig): Promise<void> {
    if (this.manifold) {
      this.rebuildChannel(river);
      return;
    }
    if (!this.initPromise) {
      this.initPromise = (async () => {
        const mod = await Module({
          locateFile: () => manifoldWasmUrl,
        });
        mod.setup();
        this.manifold = mod;
        this.Manifold = mod.Manifold;
        this.channel = this.buildChannel(river);
      })();
    }
    await this.initPromise;
  }

  get ready(): boolean {
    return Boolean(this.Manifold && this.channel);
  }

  rebuildChannel(river: RiverConfig): void {
    if (!this.Manifold) return;
    this.channel?.delete();
    this.channel = this.buildChannel(river);
  }

  private buildChannel(river: RiverConfig): ManifoldSolid {
    const M = this.Manifold!;
    const path = new RiverPath(river);
    const segments = path.channelSegments();
    let region: ManifoldSolid | null = null;

    for (const segment of segments) {
      const height = river.channelTop - river.channelBottom;
      const solid = M.cube([river.centerWidth, height, segment.length], true);
      const matrix = new THREE.Matrix4().compose(
        new THREE.Vector3(...segment.position),
        new THREE.Quaternion().setFromEuler(new THREE.Euler(0, segment.angleY, 0)),
        new THREE.Vector3(1, 1, 1),
      );
      const posed = solid.transform([...matrix.elements] as Mat4);
      solid.delete();

      if (!region) {
        region = posed;
      } else {
        const merged: ManifoldSolid = region.add(posed);
        region.delete();
        posed.delete();
        region = merged;
      }
    }
    return region!;
  }

  private buildCollider(spec: ColliderSpec): ManifoldSolid {
    const M = this.Manifold!;
    if (spec.kind === 'box') {
      return M.cube(spec.size, true);
    }
    if (spec.kind === 'cylinder') {
      return M.cylinder(spec.height, spec.radius, spec.radius, spec.segments ?? 20, true);
    }

    let compound: ManifoldSolid | null = null;
    for (const part of spec.parts) {
      const child = this.buildCollider(part.collider);
      const matrix = new THREE.Matrix4().compose(
        new THREE.Vector3(...(part.position ?? [0, 0, 0])),
        new THREE.Quaternion().setFromEuler(
          new THREE.Euler(
            THREE.MathUtils.degToRad(part.rotation?.[0] ?? 0),
            THREE.MathUtils.degToRad(part.rotation?.[1] ?? 0),
            THREE.MathUtils.degToRad(part.rotation?.[2] ?? 0),
          ),
        ),
        new THREE.Vector3(1, 1, 1),
      );
      const posed = child.transform([...matrix.elements] as Mat4);
      child.delete();
      if (!compound) {
        compound = posed;
      } else {
        const merged: ManifoldSolid = compound.add(posed);
        compound.delete();
        posed.delete();
        compound = merged;
      }
    }
    return compound ?? M.cube([0.01, 0.01, 0.01], true);
  }

  private worldSolid(obstacle: Obstacle): ManifoldSolid {
    const local = this.buildCollider(obstacle.collider);
    const matrix = new THREE.Matrix4().compose(
      new THREE.Vector3(...obstacle.position),
      new THREE.Quaternion().setFromEuler(
        new THREE.Euler(
          THREE.MathUtils.degToRad(obstacle.rotation[0]),
          THREE.MathUtils.degToRad(obstacle.rotation[1]),
          THREE.MathUtils.degToRad(obstacle.rotation[2]),
        ),
      ),
      new THREE.Vector3(...obstacle.scale),
    );
    const world = local.transform([...matrix.elements] as Mat4);
    local.delete();
    return world;
  }

  private broadRadius(obstacle: Obstacle): number {
    // max(axis scale) gives a conservative world-space radius even for non-uniform X/Y/Z scaling.
    return colliderBoundingRadius(obstacle.collider) * Math.max(obstacle.scale[0], obstacle.scale[1], obstacle.scale[2]);
  }

  detect(obstacles: Obstacle[]): {
    laneVolumes: Record<string, number>;
    pairs: PairCollision[];
    durationMs: number;
    solidCount: number;
  } {
    if (!this.ready || !this.channel) {
      throw new Error('Manifold 碰撞引擎尚未就绪');
    }
    const started = performance.now();
    const laneVolumes: Record<string, number> = {};
    const pairs: PairCollision[] = [];
    const solids = obstacles.map((o) => this.worldSolid(o));

    try {
      for (let i = 0; i < obstacles.length; i++) {
        const overlap = this.channel.intersect(solids[i]);
        laneVolumes[obstacles[i].id] = overlap.volume();
        overlap.delete();
      }

      for (let i = 0; i < obstacles.length; i++) {
        const a = obstacles[i];
        const ra = this.broadRadius(a);
        for (let j = i + 1; j < obstacles.length; j++) {
          const b = obstacles[j];
          const rb = this.broadRadius(b);
          const dx = a.position[0] - b.position[0];
          const dy = a.position[1] - b.position[1];
          const dz = a.position[2] - b.position[2];
          if (dx * dx + dy * dy + dz * dz > (ra + rb) ** 2) continue;

          const overlap = solids[i].intersect(solids[j]);
          const volume = overlap.volume();
          overlap.delete();
          if (volume > 0.0001) {
            pairs.push({ aId: a.id, bId: b.id, volume });
          }
        }
      }
    } finally {
      for (const solid of solids) solid.delete();
    }

    return {
      laneVolumes,
      pairs,
      durationMs: performance.now() - started,
      solidCount: obstacles.length,
    };
  }

  dispose(): void {
    this.channel?.delete();
    this.channel = null;
    this.manifold = null;
    this.Manifold = null;
    this.initPromise = null;
  }
}
