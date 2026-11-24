import { useMemo } from 'react';
import { useEditorStore } from '../store';
import { getEngine } from '../engineRegistry';
import { baseElevation, type ProfilePoint } from '../lib/profile';

const W = 860;
const H = 230;
const M = { top: 18, right: 24, bottom: 34, left: 52 };

export function ProfileChart(): JSX.Element {
  const profileVersion = useEditorStore((s) => s.profileVersion);
  const steps = useEditorStore((s) => s.steps);
  const gates = useEditorStore((s) => s.gates);
  const activeModule = useEditorStore((s) => s.activeModule);
  void profileVersion;

  const data = useMemo(() => {
    const engine = getEngine();
    if (!engine) return null;
    const profile: ProfilePoint[] = engine.getProfile();
    const total = engine.getCenterline().length;
    const elevations = profile.map((p: ProfilePoint) => p.elevation);
    const minE = Math.min(...elevations);
    const maxE = Math.max(...elevations);
    const pad = Math.max(1, (maxE - minE) * 0.12);
    const yMin = minE - pad;
    const yMax = maxE + pad;

    const xOf = (s: number): number => M.left + (s / total) * (W - M.left - M.right);
    const yOf = (h: number): number =>
      M.top + (1 - (h - yMin) / (yMax - yMin)) * (H - M.top - M.bottom);

    const linePath = profile
      .map(
        (p: ProfilePoint, i: number) =>
          `${i === 0 ? 'M' : 'L'}${xOf(p.s).toFixed(1)},${yOf(p.elevation).toFixed(1)}`,
      )
      .join(' ');
    const areaPath =
      `${linePath} L${xOf(total).toFixed(1)},${yOf(yMin).toFixed(1)} ` +
      `L${xOf(0).toFixed(1)},${yOf(yMin).toFixed(1)} Z`;
    const basePath = `M${xOf(0)},${yOf(baseElevation(0))} L${xOf(total)},${yOf(baseElevation(total))}`;

    const gridY = Array.from({ length: 5 }, (_, i) => {
      const h = yMin + ((yMax - yMin) * i) / 4;
      return { y: yOf(h), label: h.toFixed(1) };
    });
    const gridX = Array.from({ length: 6 }, (_, i) => {
      const s = (total * i) / 5;
      return { x: xOf(s), label: `${s.toFixed(0)}m` };
    });

    return { linePath, areaPath, basePath, gridY, gridX, xOf, yOf, total, yMin };
    // gates 以站位/高度参与标记,steps 改变剖面形状;profileVersion 驱动重算
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profileVersion, steps, gates, activeModule]);

  if (!data) return <div className="profile-chart empty">剖面加载中…</div>;

  return (
    <div className="profile-chart">
      <div className="profile-title">
        沿河道中心线坡度剖面
        <span className="legend">
          <i className="lg lg-line" /> 设计渠底
          <i className="lg lg-base" /> 基础纵坡
          <i className="lg lg-step" /> 跌水台阶
          <i className="lg lg-gate" /> 闸门
        </span>
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="profile-svg">
        {data.gridY.map((g, i) => (
          <g key={`gy${i}`}>
            <line x1={M.left} x2={W - M.right} y1={g.y} y2={g.y} className="grid-line" />
            <text x={M.left - 8} y={g.y + 4} className="axis-text" textAnchor="end">
              {g.label}
            </text>
          </g>
        ))}
        {data.gridX.map((g, i) => (
          <text key={`gx${i}`} x={g.x} y={H - 10} className="axis-text" textAnchor="middle">
            {g.label}
          </text>
        ))}
        <path d={data.areaPath} className="profile-area" />
        <path d={data.basePath} className="profile-base" />
        <path d={data.linePath} className="profile-line" />

        {steps.map((st) => (
          <g key={st.id} className="step-marker">
            <line
              x1={data.xOf(st.s)}
              x2={data.xOf(st.s)}
              y1={M.top}
              y2={H - M.bottom}
              className="step-vline"
            />
            <path
              d={`M${data.xOf(st.s) - 7},${M.top + 14} L${data.xOf(st.s) + 7},${M.top + 14} L${data.xOf(st.s)},${M.top + 4} Z`}
              className="step-triangle"
            />
            <text x={data.xOf(st.s)} y={M.top + 28} className="marker-text" textAnchor="middle">
              -{st.drop}m
            </text>
          </g>
        ))}

        {gates.map((g) => (
          <g key={g.id} className={`gate-marker gate-marker-${g.color}`}>
            <line
              x1={data.xOf(g.s)}
              x2={data.xOf(g.s)}
              y1={data.yOf(g.entryHeight) - 6}
              y2={H - M.bottom}
              className="gate-vline"
            />
            <circle cx={data.xOf(g.s)} cy={data.yOf(g.entryHeight) - 8} r={4.5} className="gate-dot-svg" />
            <title>{`${g.color === 'red' ? '红' : '绿'}门 · 入水 ${g.entryHeight.toFixed(2)}m · 下游坡度 ${g.downstreamGrade.toFixed(2)}%`}</title>
          </g>
        ))}
      </svg>
    </div>
  );
}
