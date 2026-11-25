import type { EyeLab } from '../core/EyeLab';
import { circumcircle3, formatMm, resolvePoint } from '../core/math';
import type { Measurement, Vec3 } from '../core/types';

const SVG_NS = 'http://www.w3.org/2000/svg';

interface DragHandle {
  measurementId: string;
  index: number;
  pointerId: number;
  element: Element;
}

/** Renders measurement lines/draggable points in SVG and values in HTML. */
export class AnnotationOverlay {
  private svg: SVGSVGElement;
  private labelLayer: HTMLElement;
  private lab: EyeLab;
  private signature = '';
  private drag: DragHandle | null = null;
  private raf = 0;

  constructor(lab: EyeLab, svg: SVGSVGElement, labelLayer: HTMLElement) {
    this.lab = lab;
    this.svg = svg;
    this.labelLayer = labelLayer;
    window.addEventListener('pointermove', this.handlePointerMove);
    window.addEventListener('pointerup', this.handlePointerUp);
    window.addEventListener('pointercancel', this.handlePointerUp);
    this.loop();
  }

  dispose(): void {
    cancelAnimationFrame(this.raf);
    window.removeEventListener('pointermove', this.handlePointerMove);
    window.removeEventListener('pointerup', this.handlePointerUp);
    window.removeEventListener('pointercancel', this.handlePointerUp);
  }

  private handlePointerMove = (event: PointerEvent): void => {
    if (!this.drag) return;
    event.preventDefault();
    this.lab.updatePointDragFromClient(event.clientX, event.clientY);
  };

  private handlePointerUp = (): void => {
    if (!this.drag) return;
    try {
      (this.drag.element as Element & { releasePointerCapture?: (id: number) => void }).releasePointerCapture?.(
        this.drag.pointerId,
      );
    } catch {
      /* pointer capture may already be gone */
    }
    this.drag = null;
    this.lab.endPointDrag();
  };

  private loop = (): void => {
    this.syncStructure();
    this.updatePositions();
    this.raf = requestAnimationFrame(this.loop);
  };

  private structureSignature(): string {
    return this.lab.state.measurements
      .map((m) => `${m.id}:${m.kind}:${m.points.length}:${m.done ? 1 : 0}`)
      .join('|');
  }

  private syncStructure(): void {
    const signature = this.structureSignature();
    if (signature === this.signature) return;
    this.signature = signature;
    this.svg.querySelectorAll('[data-measurement-id]').forEach((node) => node.remove());
    this.labelLayer.querySelectorAll('[data-measurement-id]').forEach((node) => node.remove());

    for (const measurement of this.lab.state.measurements) {
      const group = document.createElementNS(SVG_NS, 'g');
      group.setAttribute('data-measurement-id', measurement.id);
      group.setAttribute('class', `measurement measurement--${measurement.kind}`);

      const circle = document.createElementNS(SVG_NS, 'circle');
      circle.setAttribute('class', 'curve-circle');
      circle.setAttribute('fill', 'none');
      circle.setAttribute('stroke-width', '2');
      circle.setAttribute('stroke-dasharray', '5 5');
      circle.style.display = 'none';
      group.appendChild(circle);

      const line = document.createElementNS(SVG_NS, 'polyline');
      line.setAttribute('class', 'measurement-line');
      line.setAttribute('fill', 'none');
      line.setAttribute('stroke-width', '2.5');
      line.setAttribute('stroke-linecap', 'round');
      line.setAttribute('stroke-linejoin', 'round');
      group.appendChild(line);

      measurement.points.forEach((_, index) => {
        const visible = document.createElementNS(SVG_NS, 'circle');
        visible.setAttribute('class', 'point-visible');
        visible.setAttribute('r', '5.5');
        visible.setAttribute('fill', this.color(measurement.kind));
        visible.setAttribute('stroke', '#06101f');
        visible.setAttribute('stroke-width', '2');
        visible.style.pointerEvents = 'none';
        group.appendChild(visible);

        const hit = document.createElementNS(SVG_NS, 'circle');
        hit.setAttribute('class', 'point-hit');
        hit.setAttribute('r', '15');
        hit.setAttribute('fill', 'transparent');
        hit.style.pointerEvents = 'all';
        hit.style.cursor = 'grab';
        hit.addEventListener('pointerdown', (event) => {
          const pointerEvent = event as PointerEvent;
          pointerEvent.preventDefault();
          pointerEvent.stopPropagation();
          this.drag = { measurementId: measurement.id, index, pointerId: pointerEvent.pointerId, element: hit };
          try {
            hit.setPointerCapture(pointerEvent.pointerId);
          } catch {
            /* SVG capture unsupported; window listeners still work */
          }
          this.lab.beginPointDrag(measurement.id, index);
        });
        group.appendChild(hit);
      });

      this.svg.appendChild(group);

      const label = document.createElement('div');
      label.className = `anno-label anno-label--${measurement.kind}`;
      label.dataset.measurementId = measurement.id;
      this.labelLayer.appendChild(label);
    }
  }

  private color(kind: Measurement['kind']): string {
    if (kind === 'acd') return '#67e8f9';
    if (kind === 'lensThickness') return '#fbbf24';
    return '#c4b5fd';
  }

  private labelTitle(measurement: Measurement): string {
    if (measurement.kind === 'acd') return '前房深度';
    if (measurement.kind === 'lensThickness') return '晶状体厚度';
    return '角膜曲率半径';
  }

  private updatePositions(): void {
    const rect = this.lab.canvas.getBoundingClientRect();
    if (rect.width > 2 && rect.height > 2) {
      const viewBox = `0 0 ${rect.width} ${rect.height}`;
      if (this.svg.getAttribute('viewBox') !== viewBox) this.svg.setAttribute('viewBox', viewBox);
    }

    for (const measurement of this.lab.state.measurements) {
      const group = this.svg.querySelector<SVGGElement>(`[data-measurement-id="${cssEscape(measurement.id)}"]`);
      const label = this.labelLayer.querySelector<HTMLElement>(`[data-measurement-id="${cssEscape(measurement.id)}"]`);
      if (!group || !label) continue;

      const pts = measurement.points.map((point) => resolvePoint(point, this.lab.state));
      const projected = pts.map((p) => this.lab.project(p));
      const line = group.querySelector<SVGPolylineElement>('.measurement-line');
      const curveCircle = group.querySelector<SVGCircleElement>('.curve-circle');
      const circles = Array.from(group.querySelectorAll<SVGCircleElement>('.point-visible'));
      const hits = Array.from(group.querySelectorAll<SVGCircleElement>('.point-hit'));

      projected.forEach((p, i) => {
        for (const circle of [circles[i], hits[i]]) {
          if (!circle) continue;
          circle.setAttribute('cx', `${p.x}`);
          circle.setAttribute('cy', `${p.y}`);
          circle.style.display = p.visible ? '' : 'none';
        }
      });

      if (line) {
        if (measurement.kind === 'curvature' && projected.length === 3) {
          line.setAttribute(
            'points',
            [...projected, projected[0]].map((p) => `${p.x},${p.y}`).join(' '),
          );
          line.setAttribute('stroke', this.color(measurement.kind));
          line.style.opacity = '0.72';
        } else if (projected.length >= 2) {
          line.setAttribute(
            'points',
            projected.slice(0, 2).map((p) => `${p.x},${p.y}`).join(' '),
          );
          line.setAttribute('stroke', this.color(measurement.kind));
          line.style.opacity = '1';
        } else {
          line.setAttribute('points', '');
        }
        line.style.display = projected.every((p) => p.visible) || projected.length === 1 ? '' : 'none';
      }

      let labelWorld: Vec3 | null = null;
      let valueText = '等待拾取点…';
      let detailText = `${measurement.points.length}/${measurement.kind === 'curvature' ? 3 : 2} 点`;

      if (pts.length >= 2 && measurement.kind !== 'curvature') {
        labelWorld = [(pts[0][0] + pts[1][0]) / 2, (pts[0][1] + pts[1][1]) / 2 + 0.7, (pts[0][2] + pts[1][2]) / 2];
        const value = Math.hypot(pts[1][0] - pts[0][0], pts[1][1] - pts[0][1], pts[1][2] - pts[0][2]);
        valueText = formatMm(value);
        detailText = '两点距离';
      }

      if (measurement.kind === 'curvature') {
        const circle = pts.length === 3 ? circumcircle3(pts[0], pts[1], pts[2]) : null;
        if (circle?.valid) {
          labelWorld = [circle.center[0], circle.center[1] + 1.1, circle.center[2]];
          valueText = `R ${formatMm(circle.radius)}`;
          detailText = `曲率圆 Ø ${formatMm(circle.radius * 2)}`;
          const centerP = this.lab.project(circle.center);
          const radii = projected.map((p) => Math.hypot(p.x - centerP.x, p.y - centerP.y));
          const r = radii.reduce((a, b) => a + b, 0) / Math.max(1, radii.length);
          if (curveCircle && centerP.visible && Number.isFinite(r)) {
            curveCircle.style.display = '';
            curveCircle.setAttribute('cx', `${centerP.x}`);
            curveCircle.setAttribute('cy', `${centerP.y}`);
            curveCircle.setAttribute('r', `${r}`);
            curveCircle.setAttribute('stroke', this.color(measurement.kind));
          }
        } else if (pts.length > 0) {
          labelWorld = pts[pts.length - 1];
          valueText = `曲率 ${measurement.points.length}/3`;
          detailText = '继续点角膜';
          curveCircle?.style.setProperty('display', 'none');
        }
      }

      if (!labelWorld && pts.length > 0) labelWorld = pts[pts.length - 1];
      if (labelWorld) {
        const p = this.lab.project(labelWorld);
        label.style.transform = `translate(${p.x + 12}px, ${p.y - 34}px)`;
        label.style.display = p.visible ? '' : 'none';
      }
      label.innerHTML = `<strong>${this.labelTitle(measurement)}</strong><b>${valueText}</b><span>${detailText} · 点可拖动</span>`;
      label.style.borderColor = `${this.color(measurement.kind)}66`;
    }
  }
}

function cssEscape(value: string): string {
  if (typeof CSS !== 'undefined' && CSS.escape) return CSS.escape(value);
  return value.replace(/["\\]/g, '\\$&');
}
