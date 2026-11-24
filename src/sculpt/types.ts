export type BrushKind = 'grab' | 'raise' | 'flatten' | 'smooth';

export type Level = 1 | 2 | 3;

export interface BrushSettings {
  kind: BrushKind;
  diameterLevel: Level;
  strengthLevel: Level;
}

export interface SymmetrySettings {
  enabled: boolean;
  axis: 'x';
  affectPositive: boolean;
  affectNegative: boolean;
  lockAxis: boolean;
}

export interface Vec3Like {
  x: number;
  y: number;
  z: number;
}

export interface PlaneLike {
  point: Vec3Like;
  normal: Vec3Like;
}

export interface SideCounts {
  pointer: number;
  mirror: number;
  axis: number;
}

export interface StrokeSummary {
  id: number;
  index: number;
  brush: BrushKind;
  title: string;
  affected: number;
  maxDisplacement: number;
  totalDisplacement: number;
  diameterLevel: Level;
  strengthLevel: Level;
  symmetric: boolean;
  pointerCount: number;
  mirrorCount: number;
  axisCount: number;
  createdAtLabel: string;
}

export interface HistorySnapshot {
  records: StrokeSummary[];
  cursor: number;
  canUndo: boolean;
  canRedo: boolean;
  totalStrokes: number;
}

export interface MeshStats {
  name: string;
  vertices: number;
  triangles: number;
  source: string;
}

export interface StrokeDetailRow {
  index: number;
  dx: number;
  dy: number;
  dz: number;
  length: number;
  side: '+' | '−' | '0';
}
