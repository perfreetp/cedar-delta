import * as echarts from 'echarts';
import { createMemo, onCleanup, onMount } from 'solid-js';
import type { AppStore } from '../core/store';
import type { MapApi } from './MapView';
import { layerCounts } from '../data/generate';
import { LAYER_META } from './LayerPanel';
import type { LayerId } from '../types';

/**
 * 分层统计:ECharts 在这里承担真正的图表职责 ——
 * 对比各图层总要素数与当前两个视图的绘制量,并给出当前档位。
 */
export function StatsChart(props: { store: AppStore; apis: () => Partial<Record<string, MapApi>> }) {
  let el!: HTMLDivElement;
  let chart: echarts.ECharts | null = null;

  const counts = layerCounts(props.store.ds);
  const layers: LayerId[] = ['exit', 'stair', 'assembly', 'hazard', 'path', 'point', 'area'];

  const mode = createMemo(() => props.store.state().layers.map((l) => `${l.id}:${l.visible}`).join('|'));

  function option() {
    const apis = props.apis();
    const ov = apis.overview?.stats();
    const fl = apis.floor?.stats();
    return {
      animation: false,
      backgroundColor: 'transparent',
      grid: { left: 8, right: 8, top: 26, bottom: 4, containLabel: true },
      tooltip: {
        trigger: 'axis',
        axisPointer: { type: 'shadow' },
        backgroundColor: 'rgba(15,23,42,0.96)',
        borderColor: 'rgba(148,163,184,0.3)',
        textStyle: { color: '#e2e8f0', fontSize: 11 },
      },
      legend: {
        top: 0,
        right: 0,
        itemWidth: 8,
        itemHeight: 8,
        textStyle: { color: '#94a3b8', fontSize: 10 },
      },
      xAxis: {
        type: 'category',
        data: layers.map((l) => LAYER_META[l].name),
        axisLine: { lineStyle: { color: 'rgba(148,163,184,0.25)' } },
        axisTick: { show: false },
        axisLabel: { color: '#94a3b8', fontSize: 10, interval: 0 },
      },
      yAxis: {
        type: 'value',
        splitLine: { lineStyle: { color: 'rgba(148,163,184,0.12)' } },
        axisLabel: { color: '#64748b', fontSize: 10, formatter: (v: number) => (v >= 1000 ? `${v / 1000}k` : `${v}`) },
      },
      series: [
        {
          name: '图层要素总数',
          type: 'bar',
          barMaxWidth: 14,
          itemStyle: { color: 'rgba(56,189,248,0.45)', borderRadius: [2, 2, 0, 0] },
          data: layers.map((l) => counts[l]),
        },
        {
          name: '当前绘制量',
          type: 'bar',
          barMaxWidth: 14,
          itemStyle: { color: '#67e8f9', borderRadius: [2, 2, 0, 0] },
          // 两视图实际绘制量之和(渲染器逐图层上报,不是估算)
          data: layers.map(
            (l) => (ov?.perLayer[l] ?? 0) + (fl?.perLayer[l] ?? 0),
          ),
        },
      ],
    };
  }

  onMount(() => {
    chart = echarts.init(el, null, { renderer: 'canvas' });
    chart.setOption(option());
    const ro = new ResizeObserver(() => chart?.resize());
    ro.observe(el);
    onCleanup(() => {
      ro.disconnect();
      chart?.dispose();
      chart = null;
    });
  });

  // 任一视图变化都刷新
  createMemo(() => {
    mode();
    props.store.cameras();
    props.store.selection();
    if (chart) chart.setOption(option(), { notMerge: false });
  });

  return (
    <div class="panel panel--stats">
      <div class="panel__head">
        <h3>分层统计</h3>
        <span class="mono panel__meta">总计 {props.store.ds.point.count.toLocaleString()} 点位</span>
      </div>
      <div class="stats-chart" ref={el} />
    </div>
  );
}
