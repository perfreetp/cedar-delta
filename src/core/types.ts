export type Vec3 = [number, number, number];

export type ToolId =
  | 'select'
  | 'clip'
  | 'acd'
  | 'lensThickness'
  | 'curvature';

export type TransformMode = 'position' | 'rotation' | 'scaling';

export type SelectionId = 'lens' | 'cornea' | null;

export interface TransformState {
  position: Vec3;
  rotation: Vec3;
  scaling: Vec3;
  snappedToCornea?: boolean;
}

export interface ClipState {
  /** Signed plane offset along its unit normal, in scene units (1 unit ≈ 1 mm). */
  offset: number;
  /** Rotation around Y. PI/2 makes the normal point along +X for an axial section. */
  yaw: number;
  snap: boolean;
  snappedKey: string | null;
  angleSnapped?: boolean;
  enabled: boolean;
}

export type AnchorRef =
  | { type: 'corneaPole'; surface: 'anterior' | 'posterior' }
  | { type: 'lensPole'; end: 'anterior' | 'posterior' };

export interface MeasurePoint {
  p: Vec3;
  anchor?: AnchorRef;
}

export type MeasurementKind = 'acd' | 'lensThickness' | 'curvature';

export interface Measurement {
  id: string;
  kind: MeasurementKind;
  points: MeasurePoint[];
  done: boolean;
  value?: number;
  radius?: number;
  center?: Vec3;
  createdAt: number;
}

export interface LabState {
  lens: TransformState;
  clip: ClipState;
  microVisible: boolean;
  measurements: Measurement[];
  /** Exact orthonormal world basis extracted from the Babylon lens matrix. */
  lensBasis?: [Vec3, Vec3, Vec3];
}

export interface HintMessage {
  tone: 'info' | 'success' | 'warning';
  text: string;
}

export interface HistorySnapshot {
  label: string;
  state: LabState;
}
