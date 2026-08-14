import { performance } from "node:perf_hooks";

export const NETWORK_LOAD_SLO = {
  errorRateMaximum: 0.01,
  responseP95MillisecondsMaximum: 750,
} as const;

export interface HttpLoadWorkload {
  name: string;
  requestCount: number;
  concurrency: number;
  request: (index: number) => Promise<Response>;
  expectedStatus: number;
}

export interface HttpLoadWorkloadResult {
  name: string;
  requested: number;
  completed: number;
  failures: number;
  errorRate: number;
  responseP95Milliseconds: number;
  responseMaximumMilliseconds: number;
}

function percentile(values: readonly number[], fraction: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[
    Math.min(sorted.length - 1, Math.floor(sorted.length * fraction))
  ]!;
}

function isPositiveSafeInteger(value: number): boolean {
  return Number.isSafeInteger(value) && value > 0;
}

function assertWorkload(workload: HttpLoadWorkload): void {
  if (!/^[a-z][a-z0-9-]{0,63}$/.test(workload.name))
    throw new Error("HTTP workload name is invalid");
  if (!isPositiveSafeInteger(workload.requestCount))
    throw new Error("HTTP workload request count is invalid");
  if (!isPositiveSafeInteger(workload.concurrency))
    throw new Error("HTTP workload concurrency is invalid");
  if (
    !Number.isSafeInteger(workload.expectedStatus) ||
    workload.expectedStatus < 100 ||
    workload.expectedStatus > 599
  )
    throw new Error("HTTP workload expected status is invalid");
}

async function executeWorkload(
  workload: HttpLoadWorkload,
): Promise<HttpLoadWorkloadResult> {
  assertWorkload(workload);
  const latencies: number[] = [];
  let nextIndex = 0;
  let failures = 0;
  const workerCount = Math.min(workload.concurrency, workload.requestCount);
  await Promise.all(
    Array.from({ length: workerCount }, async () => {
      while (nextIndex < workload.requestCount) {
        const index = nextIndex;
        nextIndex += 1;
        const started = performance.now();
        try {
          const response = await workload.request(index);
          await response.arrayBuffer();
          if (response.status !== workload.expectedStatus) failures += 1;
        } catch {
          failures += 1;
        } finally {
          latencies.push(performance.now() - started);
        }
      }
    }),
  );
  return {
    name: workload.name,
    requested: workload.requestCount,
    completed: latencies.length,
    failures,
    errorRate: failures / workload.requestCount,
    responseP95Milliseconds: percentile(latencies, 0.95),
    responseMaximumMilliseconds: Math.max(...latencies),
  };
}

export async function runHttpLoadProof(workloads: readonly HttpLoadWorkload[]) {
  if (workloads.length === 0) throw new Error("HTTP workloads are absent");
  const results: HttpLoadWorkloadResult[] = [];
  for (const workload of workloads)
    results.push(await executeWorkload(workload));
  const requested = results.reduce(
    (total, result) => total + result.requested,
    0,
  );
  const failures = results.reduce(
    (total, result) => total + result.failures,
    0,
  );
  return {
    mode: "LOCAL_LOOPBACK_HTTP" as const,
    workloads: results,
    observed: {
      requested,
      completed: results.reduce((total, result) => total + result.completed, 0),
      failures,
      errorRate: failures / requested,
      responseP95Milliseconds: Math.max(
        ...results.map(
          ({ responseP95Milliseconds }) => responseP95Milliseconds,
        ),
      ),
    },
    passed: results.every(
      (result) =>
        result.completed === result.requested &&
        result.errorRate < NETWORK_LOAD_SLO.errorRateMaximum &&
        result.responseP95Milliseconds <
          NETWORK_LOAD_SLO.responseP95MillisecondsMaximum,
    ),
    remoteCapacity: {
      state: "NOT_EXECUTED_BLAXEL_CAPACITY_GATE" as const,
      liveConcurrencyVerified: false,
      headroomReserved: false,
    },
  };
}
