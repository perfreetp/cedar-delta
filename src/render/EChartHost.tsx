import * as echarts from 'echarts';
import { onCleanup, onMount } from 'solid-js';

export interface EChartHandle {
  chart: echarts.ECharts;
  zr: ReturnType<echarts.ECharts['getZr']>;
  /** 逻辑像素尺寸(不含 DPR) */
  size: () => { width: number; height: number };
  onResize: (cb: (w: number, h: number) => void) => void;
}

/**
 * 提供一个 ECharts 实例作为画布宿主。
 * 只建图表容器,不挂任何 series —— 要素全部由 FeatureRenderer 直接画在 zrender 上。
 */
export function EChartHost(props: {
  class?: string;
  onReady: (h: EChartHandle) => void;
}) {
  let host!: HTMLDivElement;
  let chart: echarts.ECharts | null = null;

  onMount(() => {
    chart = echarts.init(host, null, { renderer: 'canvas', useDirtyRect: false });
    chart.setOption({ animation: false, backgroundColor: 'transparent' });

    const size = () => ({
      width: host.clientWidth || 1,
      height: host.clientHeight || 1,
    });

    const resizeCbs: ((w: number, h: number) => void)[] = [];
    const ro = new ResizeObserver(() => {
      const s = size();
      chart!.resize({ width: s.width, height: s.height });
      for (const cb of resizeCbs) cb(s.width, s.height);
    });
    ro.observe(host);

    props.onReady({
      chart,
      zr: chart.getZr(),
      size,
      onResize: (cb) => resizeCbs.push(cb),
    });

    onCleanup(() => {
      ro.disconnect();
      chart?.dispose();
      chart = null;
    });
  });

  return <div ref={host} class={props.class} />;
}
