// 교체 가능한 metrics sink (spec §8). 기본은 in-process 집계 — 나중에 OTel/Prometheus/StatsD로 스왑.
// counter(누적) / gauge(현재값) / observe(histogram → percentile) / count(분포 버킷).

export interface MetricsSink {
  inc(name: string, by?: number): void;
  gauge(name: string, value: number): void;
  observe(name: string, value: number): void; // histogram 표본
  count(name: string, bucket: string): void; // 분포 (drift/PSI용)
}

export interface Percentiles {
  count: number;
  mean: number;
  p10: number;
  p50: number;
  p90: number;
}

export class InMemoryMetrics implements MetricsSink {
  private counters = new Map<string, number>();
  private gauges = new Map<string, number>();
  private hist = new Map<string, number[]>();
  private dist = new Map<string, Map<string, number>>();

  inc(name: string, by = 1): void {
    this.counters.set(name, (this.counters.get(name) ?? 0) + by);
  }
  gauge(name: string, value: number): void {
    this.gauges.set(name, value);
  }
  observe(name: string, value: number): void {
    const arr = this.hist.get(name) ?? [];
    arr.push(value);
    this.hist.set(name, arr);
  }
  count(name: string, bucket: string): void {
    const d = this.dist.get(name) ?? new Map<string, number>();
    d.set(bucket, (d.get(bucket) ?? 0) + 1);
    this.dist.set(name, d);
  }

  // --- readers ---
  getCounter(name: string): number {
    return this.counters.get(name) ?? 0;
  }
  getGauge(name: string): number | undefined {
    return this.gauges.get(name);
  }
  getDist(name: string): Record<string, number> {
    return Object.fromEntries(this.dist.get(name) ?? []);
  }
  percentiles(name: string): Percentiles {
    const arr = (this.hist.get(name) ?? []).slice().sort((a, b) => a - b);
    if (arr.length === 0) return { count: 0, mean: 0, p10: 0, p50: 0, p90: 0 };
    const q = (p: number) => arr[Math.min(arr.length - 1, Math.floor(p * arr.length))]!;
    const mean = arr.reduce((a, b) => a + b, 0) / arr.length;
    return { count: arr.length, mean: round3(mean), p10: q(0.1), p50: q(0.5), p90: q(0.9) };
  }
  // 비율 = num/den counter (den=0이면 0)
  ratio(num: string, den: string): number {
    const d = this.getCounter(den);
    return d === 0 ? 0 : round3(this.getCounter(num) / d);
  }
}

export function round3(n: number): number {
  return Math.round(n * 1000) / 1000;
}
