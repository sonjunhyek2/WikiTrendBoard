import normalD1A from '../../fixtures/normal-d1-a.json';
import normalD1B from '../../fixtures/normal-d1-b.json';
import normalD2 from '../../fixtures/normal-d2.json';
import timeoutFixture from '../../fixtures/timeout.json';
import auth401Fixture from '../../fixtures/auth-401.json';
import rate429Fixture from '../../fixtures/rate-429.json';
import offlineFixture from '../../fixtures/offline.json';
import schemaBreakFixture from '../../fixtures/schema-break.json';
import recoverD2Fixture from '../../fixtures/recover-d2.json';

import publicContractJson from '../../public-contract.json';
import criterionRegistryJson from '../../criterion-registry.json';
import assetManifestJson from '../../asset-manifest.json';
import fixtureManifestJson from '../../fixture-manifest.json';

import {
  EvaluationState,
  NormalizedReading,
  ReplayFixture,
  applySuccessfulReading,
  resetEvaluationState,
  runFixture
} from './adapter';

export const PUBLIC_CONTRACT = publicContractJson;
export const CRITERION_REGISTRY = criterionRegistryJson;
export const ASSET_MANIFEST = assetManifestJson;
export const FIXTURE_MANIFEST = fixtureManifestJson;

export const FIXTURE_LIST: ReplayFixture[] = [
  normalD1A as unknown as ReplayFixture,
  normalD1B as unknown as ReplayFixture,
  normalD2 as unknown as ReplayFixture,
  timeoutFixture as unknown as ReplayFixture,
  auth401Fixture as unknown as ReplayFixture,
  rate429Fixture as unknown as ReplayFixture,
  offlineFixture as unknown as ReplayFixture,
  schemaBreakFixture as unknown as ReplayFixture,
  recoverD2Fixture as unknown as ReplayFixture
];

export const FIXTURE_MAP: Record<string, ReplayFixture> = Object.fromEntries(
  FIXTURE_LIST.map((f) => [f.fixture_id, f])
);

export const FAILURE_FIXTURE_IDS = [
  'T04-TIMEOUT',
  'T04-AUTH-401',
  'T04-RATE-429',
  'T04-OFFLINE',
  'T04-SCHEMA-BREAK'
] as const;

export interface FixtureAssertionResult {
  fixtureId: string;
  passed: boolean;
  checks: {
    label: string;
    expected: string | number | boolean | null;
    actual: string | number | boolean | null;
    passed: boolean;
  }[];
}

export function verifyFixtureState(
  state: EvaluationState,
  fixture: ReplayFixture,
  baselineRecordId?: string | null
): FixtureAssertionResult {
  const exp = fixture.expected;
  const actualFreshness = state.status?.freshness ?? null;
  const actualErrorCode = state.status?.error_code ?? null;
  const actualRowCount = state.daily_readings.length;
  const actualStoredValue = state.current_reading?.normalized_value ?? null;
  const actualDelta = state.last_delta ?? null;
  const actualPreserveLastGood = state.current_reading !== null && state.daily_readings.length > 0;
  const actualRecordDate = state.current_reading?.record_date ?? null;

  const checks: FixtureAssertionResult['checks'] = [
    {
      label: 'freshness',
      expected: exp.freshness,
      actual: actualFreshness,
      passed: actualFreshness === exp.freshness
    },
    {
      label: 'error_code',
      expected: exp.error_code,
      actual: actualErrorCode,
      passed: actualErrorCode === exp.error_code
    },
    {
      label: 'row_count',
      expected: exp.row_count,
      actual: actualRowCount,
      passed: actualRowCount === exp.row_count
    },
    {
      label: 'stored_value',
      expected: exp.stored_value,
      actual: actualStoredValue,
      passed: actualStoredValue === exp.stored_value
    },
    {
      label: 'delta',
      expected: exp.delta,
      actual: actualDelta,
      passed: actualDelta === exp.delta
    },
    {
      label: 'preserve_last_good',
      expected: exp.preserve_last_good,
      actual: actualPreserveLastGood,
      passed: actualPreserveLastGood === exp.preserve_last_good
    }
  ];

  if (exp.record_date) {
    checks.push({
      label: 'record_date',
      expected: exp.record_date,
      actual: actualRecordDate,
      passed: actualRecordDate === exp.record_date
    });
  }

  if (exp.same_record_id_as && baselineRecordId) {
    const currentRecordId = state.daily_readings[0]?.record_id ?? null;
    checks.push({
      label: `same_record_id_as (${exp.same_record_id_as})`,
      expected: baselineRecordId,
      actual: currentRecordId,
      passed: currentRecordId === baselineRecordId
    });
  }

  return {
    fixtureId: fixture.fixture_id,
    passed: checks.every((c) => c.passed),
    checks
  };
}

export interface SequenceStepLog {
  stepNumber: number;
  actionLabel: string;
  fixtureId: string | null;
  stateSnapshot: EvaluationState;
  assertion: FixtureAssertionResult | null;
}

export function runSequenceSteps(fixtureIds: string[]): {
  finalState: EvaluationState;
  steps: SequenceStepLog[];
  beforeRetrySnapshot?: EvaluationState;
  afterRetrySnapshot?: EvaluationState;
} {
  let state = resetEvaluationState();
  const steps: SequenceStepLog[] = [
    {
      stepNumber: 0,
      actionLabel: 'Reset (초기화)',
      fixtureId: null,
      stateSnapshot: state,
      assertion: null
    }
  ];

  let d1aRecordId: string | null = null;
  let beforeRetrySnapshot: EvaluationState | undefined;
  let afterRetrySnapshot: EvaluationState | undefined;

  fixtureIds.forEach((id, idx) => {
    const fixture = FIXTURE_MAP[id];
    if (!fixture) {
      throw new Error(`Unknown fixture_id: ${id}`);
    }
    state = runFixture(state, fixture);
    if (id === 'T04-NORMAL-D1-A') {
      d1aRecordId = state.daily_readings[0]?.record_id ?? null;
    }
    if (FAILURE_FIXTURE_IDS.includes(id as (typeof FAILURE_FIXTURE_IDS)[number])) {
      beforeRetrySnapshot = state;
    }
    if (id === 'T04-RECOVER-D2') {
      afterRetrySnapshot = state;
    }
    const assertion = verifyFixtureState(state, fixture, d1aRecordId);
    steps.push({
      stepNumber: idx + 1,
      actionLabel: `${fixture.fixture_id} (${fixture.description_ko})`,
      fixtureId: fixture.fixture_id,
      stateSnapshot: state,
      assertion
    });
  });

  return {
    finalState: state,
    steps,
    beforeRetrySnapshot,
    afterRetrySnapshot
  };
}

export interface SyntheticClockStep {
  step: number;
  label: string;
  fetchedAtUtc: string;
  kstRecordDate: string;
  value: number;
  rowCountBefore: number;
  rowCountAfter: number;
  recordId: string;
  delta: number | null;
}

/**
 * 카드 4 — 하루 한 줄:
 * 같은 날짜 세 번(D1 3회)과 다음 날짜 한 번(D2 1회)을 합성 시계로 시험합니다.
 */
export function runSyntheticClockDailyKeyTest(): {
  steps: SyntheticClockStep[];
  finalState: EvaluationState;
  passedC20: boolean;
  passedC21: boolean;
} {
  let state = resetEvaluationState();
  const rawInputs: { label: string; reading: NormalizedReading }[] = [
    {
      label: '같은 날짜 1회차 (2026-08-24 09:00 KST)',
      reading: {
        signal_id: 'aleph-demo-index',
        normalized_value: 100,
        unit: 'pt',
        source_name: 'ALEPH 합성 시계 시험',
        source_url: 'https://fixtures.aleph.invalid/t04/demo-index',
        source_time: '2026-08-23T23:59:00.000Z',
        fetched_at: '2026-08-24T00:00:00.000Z',
        record_timezone: 'Asia/Seoul',
        record_date: '2026-08-24'
      }
    },
    {
      label: '같은 날짜 2회차 (2026-08-24 14:00 KST)',
      reading: {
        signal_id: 'aleph-demo-index',
        normalized_value: 103,
        unit: 'pt',
        source_name: 'ALEPH 합성 시계 시험',
        source_url: 'https://fixtures.aleph.invalid/t04/demo-index',
        source_time: '2026-08-24T04:59:00.000Z',
        fetched_at: '2026-08-24T05:00:00.000Z',
        record_timezone: 'Asia/Seoul',
        record_date: '2026-08-24'
      }
    },
    {
      label: '같은 날짜 3회차 (2026-08-24 18:00 KST, 자정 전)',
      reading: {
        signal_id: 'aleph-demo-index',
        normalized_value: 105,
        unit: 'pt',
        source_name: 'ALEPH 합성 시계 시험',
        source_url: 'https://fixtures.aleph.invalid/t04/demo-index',
        source_time: null,
        fetched_at: '2026-08-24T09:00:00.000Z',
        record_timezone: 'Asia/Seoul',
        record_date: '2026-08-24'
      }
    },
    {
      label: '다음 날짜 1회차 (2026-08-25 09:00 KST)',
      reading: {
        signal_id: 'aleph-demo-index',
        normalized_value: 120,
        unit: 'pt',
        source_name: 'ALEPH 합성 시계 시험',
        source_url: 'https://fixtures.aleph.invalid/t04/demo-index',
        source_time: '2026-08-24T23:59:00.000Z',
        fetched_at: '2026-08-25T00:00:00.000Z',
        record_timezone: 'Asia/Seoul',
        record_date: '2026-08-25'
      }
    }
  ];

  const steps: SyntheticClockStep[] = [];
  for (let i = 0; i < rawInputs.length; i++) {
    const item = rawInputs[i];
    const rowCountBefore = state.daily_readings.length;
    state = applySuccessfulReading(state, item.reading, {
      fixture_id: `CLOCK-TEST-${i + 1}`,
      virtual_now: item.reading.fetched_at
    });
    const rowCountAfter = state.daily_readings.length;
    const matchingRow = state.daily_readings.find((r) => r.record_date === item.reading.record_date)!;
    steps.push({
      step: i + 1,
      label: item.label,
      fetchedAtUtc: item.reading.fetched_at,
      kstRecordDate: item.reading.record_date,
      value: item.reading.normalized_value,
      rowCountBefore,
      rowCountAfter,
      recordId: matchingRow.record_id,
      delta: state.last_delta
    });
  }

  const passedC20 =
    steps[0].rowCountAfter === 1 &&
    steps[1].rowCountAfter === 1 &&
    steps[2].rowCountAfter === 1 &&
    steps[0].recordId === steps[1].recordId &&
    steps[1].recordId === steps[2].recordId;
  const passedC21 =
    steps[3].rowCountAfter === 2 &&
    steps[3].recordId !== steps[2].recordId &&
    steps[3].delta === 15;

  return {
    steps,
    finalState: state,
    passedC20,
    passedC21
  };
}

