/**
 * 自研轨道相机：左键拖动由业务层决定是否交给手柄，
 * 这里只处理轨道旋转（右键 / 中键 / Alt+左键）、滚轮推拉和平移（中键 Shift）。
 * 球坐标围绕 target 运转，带阻尼插值保证跟手又不抖。
 */
import * as pc from 'playcanvas';
import { clamp } from '../core/math';

export class OrbitCamera {
  private yaw = 0.6;
  private pitch = 0.5;
  private distance = 150;
  private target = new pc.Vec3(0, 2, -8);

  private curYaw = this.yaw;
  private curPitch = this.pitch;
  private curDistance = this.distance;
  private curTarget = this.target.clone();

  private minDistance = 30;
  private maxDistance = 420;
  private damping = 0.22;

  constructor(private readonly camera: pc.CameraComponent) {
    this.applyImmediate();
  }

  rotate(dx: number, dy: number): void {
    this.yaw -= dx * 0.005;
    this.pitch = clamp(this.pitch - dy * 0.005, -1.35, 1.35);
  }

  pan(dx: number, dy: number): void {
    const cam = this.camera;
    const right = new pc.Vec3();
    cam.entity.getWorldTransform().transformVector(new pc.Vec3(1, 0, 0), right);
    const up = new pc.Vec3(0, 1, 0);
    const scale = this.curDistance * 0.0016;
    this.target = this.target
      .clone()
      .add(right.mulScalar(-dx * scale))
      .add(up.mulScalar(dy * scale));
  }

  zoom(delta: number): void {
    this.distance = clamp(this.distance * (1 + delta * 0.0012), this.minDistance, this.maxDistance);
  }

  frame(center: pc.Vec3, distance = 90): void {
    this.target = center.clone();
    this.distance = clamp(distance, this.minDistance, this.maxDistance);
  }

  /** 屏幕像素 → 世界射线（供拾取与手柄使用） */
  screenRay(screenX: number, screenY: number): { origin: [number, number, number]; dir: [number, number, number] } {
    const c = this.camera;
    const start = c.screenToWorld(screenX, screenY, c.nearClip);
    const end = c.screenToWorld(screenX, screenY, c.farClip);
    const dir = new pc.Vec3().sub2(end, start).normalize();
    return {
      origin: [start.x, start.y, start.z],
      dir: [dir.x, dir.y, dir.z],
    };
  }

  update(): void {
    this.curYaw += (this.yaw - this.curYaw) * this.damping;
    this.curPitch += (this.pitch - this.curPitch) * this.damping;
    this.curDistance += (this.distance - this.curDistance) * this.damping;
    this.curTarget.lerp(this.curTarget, this.target, this.damping);

    const cp = Math.cos(this.curPitch);
    const offset = new pc.Vec3(
      this.curDistance * cp * Math.sin(this.curYaw),
      this.curDistance * Math.sin(this.curPitch),
      this.curDistance * cp * Math.cos(this.curYaw),
    );
    const pos = this.curTarget.clone().add(offset);
    this.camera.entity.setPosition(pos);
    this.camera.entity.lookAt(this.curTarget);
  }

  get position(): pc.Vec3 {
    return this.camera.entity.getPosition();
  }

  private applyImmediate(): void {
    this.curYaw = this.yaw;
    this.curPitch = this.pitch;
    this.curDistance = this.distance;
    this.update();
  }
}
