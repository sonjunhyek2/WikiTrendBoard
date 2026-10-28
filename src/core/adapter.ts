// ALEPH T04 코어 정규화 및 상태 전이 어댑터
// adapter-reset.example.js의 공식 상태 머신과 100% 동일한 계약을 TypeScript로 구현합니다.

export const NORMALIZED_KEYS = Object.freeze([
  'signal_id',
  'normalized_value',
  'unit',
  'source_name',
  'source_url',
  'source_time',
  'fetched_at',
  'record_timezone',
  'record_date'
] as const);

export const ERROR_CODES = Object.freeze([
  'timeout',
  'auth',
  'rate_limit',
  'offline',
  'schema_error'
] as const);

export type ErrorCode = (typeof ERROR_CODES)[number];
export type AnyErrorCode = 'none' | ErrorCode;
export type Freshness = 'fresh' | 'stale';

export interface NormalizedReading {
  signal_id: string;
  normalized_value: number;
  unit: string;
  source_name: string;
  source_url: string;
  source_time: string | null;
  fetched_at: string;
  record_timezone: 'Asia/Seoul';
  record_date: string;
}

export interface ReadingStatus {
  freshness: Freshness;
  error_code: AnyErrorCode;
}

export interface DailyReadingRow {
  record_id: string;
  signal_id: string;
  record_date: string;
  normalized_value: number;
  unit: string;
  first_fetched_at: string;
  last_fetched_at: string;
  reading: NormalizedReading;
}

export interface ComparisonResult {
  state: 'insufficient' | 'unit_mismatch' | 'comparable';
  direction: 'increase' | 'decrease' | 'unchanged' | null;
  magnitude: number | null;
  unit: string | null;
  signed_delta?: number | null;
  previous_date?: string | null;
  previous_value?: number | null;
}

export interface RunMeta {
  fixture_id?: string | null;
  virtual_now?: string | null;
  retry_after_seconds?: number | null;
}

export interface LastRunInfo {
  fixture_id: string | null;
  virtual_now: string | null;
  outcome: 'success' | 'error';
  error_code: AnyErrorCode;
  retry_after_seconds: number | null;
}

export interface EvaluationState {
  schema_version: 'aleph-t04-evaluation-state-v1';
  daily_readings: DailyReadingRow[];
  current_reading: NormalizedReading | null;
  status: ReadingStatus | null;
  last_delta: number | null;
  last_comparison: ComparisonResult;
  last_run: LastRunInfo | null;
  sequence: number;
}

export interface FixtureTransport {
  mode: 'http' | 'timeout' | 'offline';
  status: number | null;
  delay_ms: number;
  deadline_ms: number;
  headers: Record<string, string>;
}

export interface FixtureExpected {
  freshness: Freshness;
  error_code: AnyErrorCode;
  row_count: number;
  stored_value: number | null;
  delta: number | null;
  preserve_last_good: boolean;
  same_record_id_as?: string;
  record_date?: string;
}

export interface ReplayFixture {
  fixture_id: string;
  contract_version: string;
  description_ko: string;
  virtual_now: string;
  transport: FixtureTransport;
  payload: Record<string, unknown> | null;
  expected: FixtureExpected;
}

export interface ErrorGuidance {
  code: ErrorCode;
  criterionId: string;
  fixtureId: string;
  titleKo: string;
  badgeTextKo: string;
  causeKo: string;
  nextActionKo: string;
  technicalDetailKo: string;
}

export const ERROR_GUIDANCE_MAP: Record<ErrorCode, ErrorGuidance> = {
  timeout: {
    code: 'timeout',
    criterionId: 'T04-C12',
    fixtureId: 'T04-TIMEOUT',
    titleKo: '외부 원천 응답 시간 초과 (Timeout)',
    badgeTextKo: '오래된 값 (stale · timeout)',
    causeKo: '외부 데이터 원천이 제한 시간(deadline 1,500ms) 내에 응답하지 않아 연결을 중단했습니다 (지연 5,000ms).',
    nextActionKo: '마지막 정상값을 유지한 상태로 잠시 후 [다시 시도] 버튼을 눌러 재조회하거나 원천 서버 응답 속도를 확인하세요.',
    technicalDetailKo: 'transport.mode = "timeout" | status = null | delay = 5000ms > deadline = 1500ms'
  },
  auth: {
    code: 'auth',
    criterionId: 'T04-C13',
    fixtureId: 'T04-AUTH-401',
    titleKo: '외부 데이터 원천 접근 거절 (HTTP 401/403)',
    badgeTextKo: '오래된 값 (stale · auth)',
    causeKo: '외부 데이터 원천 서버가 요청 권한을 거절(HTTP 401 Unauthorized / 403 Forbidden)했습니다. (앱 로그인이 아닌 외부 원천 응답 코드입니다.)',
    nextActionKo: '공개 엔드포인트 경로 및 요청 헤더 정책을 점검한 뒤 [다시 시도] 버튼으로 정상 경로를 재호출하세요.',
    technicalDetailKo: 'transport.mode = "http" | status = 401 | upstream auth rejection'
  },
  rate_limit: {
    code: 'rate_limit',
    criterionId: 'T04-C14',
    fixtureId: 'T04-RATE-429',
    titleKo: '외부 원천 호출 빈도 제한 (HTTP 429 Rate Limit)',
    badgeTextKo: '오래된 값 (stale · rate_limit)',
    causeKo: '단시간에 많은 요청이 발생하여 외부 원천에서 일시적으로 호출을 제한(HTTP 429 Too Many Requests)했습니다.',
    nextActionKo: '권장 대기 시간(Retry-After: 60초) 이후에 [다시 시도] 버튼을 눌러 일별 데이터를 갱신하세요.',
    technicalDetailKo: 'transport.mode = "http" | status = 429 | Retry-After = 60s'
  },
  offline: {
    code: 'offline',
    criterionId: 'T04-C15',
    fixtureId: 'T04-OFFLINE',
    titleKo: '네트워크 오프라인 상태 (Offline)',
    badgeTextKo: '오래된 값 (stale · offline)',
    causeKo: '브라우저 또는 네트워크 연결이 끊어져 외부 원천에 도달할 수 없습니다.',
    nextActionKo: '보존된 마지막 정상값을 참고하시면서, 인터넷/Wi-Fi 연결을 복구한 뒤 [다시 시도] 버튼을 누르세요.',
    technicalDetailKo: 'transport.mode = "offline" | status = null | network unreachable'
  },
  schema_error: {
    code: 'schema_error',
    criterionId: 'T04-C16',
    fixtureId: 'T04-SCHEMA-BREAK',
    titleKo: '외부 원천 응답 형식/스키마 변경 감지 (Schema Break)',
    badgeTextKo: '오래된 값 (stale · schema_error)',
    causeKo: 'HTTP 200 응답이 도착했으나 필수 필드 타입(예: normalized_value가 숫자가 아닌 문자열 "105")이 계약 스키마와 일치하지 않아 저장을 차단했습니다.',
    nextActionKo: '오염된 값으로 기존 정상 기록을 덮어쓰지 않도록 보호했습니다. 원천 응답 스키마를 확인한 후 [다시 시도]하세요.',
    technicalDetailKo: 'transport.mode = "http" | status = 200 | typeof normalized_value !== "number"'
  }
};

export function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value));
}

export function kstDate(isoString: string): string {
  const date = new Date(isoString);
  if (Number.isNaN(date.getTime())) {
    throw new TypeError('fetched_at must be a valid ISO-8601 date-time');
  }
  const parts = new Intl.DateTimeFormat('en', {
    timeZone: 'Asia/Seoul',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).formatToParts(date);
  const byType = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${byType.year}-${byType.month}-${byType.day}`;
}

export function formatKstDateTime(isoString: string | null | undefined): string {
  if (!isoString) return '미제공 (null)';
  const date = new Date(isoString);
  if (Number.isNaN(date.getTime())) return String(isoString);
  const parts = new Intl.DateTimeFormat('en', {
    timeZone: 'Asia/Seoul',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false
  }).formatToParts(date);
  const byType = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  const hr = byType.hour === '24' ? '00' : byType.hour;
  return `${byType.year}-${byType.month}-${byType.day} ${hr}:${byType.minute}:${byType.second} KST`;
}

export function validateNormalizedReading(reading: unknown): reading is NormalizedReading {
  if (!reading || typeof reading !== 'object' || Array.isArray(reading)) {
    throw new TypeError('normalized reading must be an object');
  }

  const obj = reading as Record<string, unknown>;
  const actualKeys = Object.keys(obj).sort();
  const expectedKeys = [...NORMALIZED_KEYS].sort();
  if (
    actualKeys.length !== expectedKeys.length ||
    actualKeys.some((key, index) => key !== expectedKeys[index])
  ) {
    throw new TypeError(`normalized reading keys must be exactly: ${NORMALIZED_KEYS.join(', ')}`);
  }

  if (typeof obj.signal_id !== 'string' || !/^[a-z0-9][a-z0-9._-]*$/.test(obj.signal_id) || obj.signal_id.length > 100) {
    throw new TypeError('signal_id is invalid');
  }
  if (typeof obj.normalized_value !== 'number' || !Number.isFinite(obj.normalized_value)) {
    throw new TypeError('normalized_value must be a finite number');
  }
  for (const field of ['unit', 'source_name'] as const) {
    if (typeof obj[field] !== 'string' || (obj[field] as string).trim() === '') {
      throw new TypeError(`${field} must be a non-empty string`);
    }
  }

  let sourceUrl: URL;
  try {
    sourceUrl = new URL(String(obj.source_url));
  } catch {
    throw new TypeError('source_url must be an absolute URL');
  }
  if (sourceUrl.protocol !== 'https:') {
    throw new TypeError('source_url must use HTTPS');
  }

  if (obj.source_time !== null && (typeof obj.source_time !== 'string' || Number.isNaN(new Date(obj.source_time).getTime()))) {
    throw new TypeError('source_time must be a valid date-time or null');
  }
  if (typeof obj.fetched_at !== 'string' || Number.isNaN(new Date(obj.fetched_at).getTime())) {
    throw new TypeError('fetched_at must be a valid date-time');
  }
  if (obj.record_timezone !== 'Asia/Seoul') {
    throw new TypeError('record_timezone must be Asia/Seoul');
  }
  if (
    typeof obj.record_date !== 'string' ||
    !/^\d{4}-\d{2}-\d{2}$/.test(obj.record_date) ||
    obj.record_date !== kstDate(obj.fetched_at)
  ) {
    throw new TypeError('record_date must be the Asia/Seoul date derived from fetched_at');
  }

  return true;
}

export function validateStatus(status: unknown): status is ReadingStatus {
  if (!status || typeof status !== 'object' || Array.isArray(status)) return false;
  const s = status as Record<string, unknown>;
  if (s.freshness === 'fresh') return s.error_code === 'none';
  if (s.freshness === 'stale') return (ERROR_CODES as readonly string[]).includes(String(s.error_code));
  return false;
}

export function resetEvaluationState(): EvaluationState {
  return {
    schema_version: 'aleph-t04-evaluation-state-v1',
    daily_readings: [],
    current_reading: null,
    status: null,
    last_delta: null,
    last_comparison: {
      state: 'insufficient',
      direction: null,
      magnitude: null,
      unit: null
    },
    last_run: null,
    sequence: 0
  };
}

export function recordIdFor(reading: NormalizedReading): string {
  return `demo-${reading.signal_id}-${reading.record_date}`;
}

export function comparisonFor(rows: DailyReadingRow[], current: DailyReadingRow): ComparisonResult {
  const previous = rows
    .filter((row) => row.signal_id === current.signal_id && row.record_date < current.record_date)
    .sort((left, right) => right.record_date.localeCompare(left.record_date))[0];
  if (!previous) {
    return { state: 'insufficient', direction: null, magnitude: null, unit: null };
  }
  if (previous.unit !== current.unit) {
    return { state: 'unit_mismatch', direction: null, magnitude: null, unit: null };
  }
  const signed = current.normalized_value - previous.normalized_value;
  return {
    state: 'comparable',
    direction: signed > 0 ? 'increase' : signed < 0 ? 'decrease' : 'unchanged',
    magnitude: Math.abs(signed),
    unit: current.unit
  };
}

export function applySuccessfulReading(
  inputState: EvaluationState,
  reading: NormalizedReading,
  runMeta: RunMeta = {}
): EvaluationState {
  validateNormalizedReading(reading);
  const state = clone(inputState);
  const existingIndex = state.daily_readings.findIndex(
    (row) => row.signal_id === reading.signal_id && row.record_date === reading.record_date
  );
  const existing = existingIndex >= 0 ? state.daily_readings[existingIndex] : null;
  const row: DailyReadingRow = {
    record_id: existing ? existing.record_id : recordIdFor(reading),
    signal_id: reading.signal_id,
    record_date: reading.record_date,
    normalized_value: reading.normalized_value,
    unit: reading.unit,
    first_fetched_at: existing ? existing.first_fetched_at : reading.fetched_at,
    last_fetched_at: reading.fetched_at,
    reading: clone(reading)
  };

  if (existingIndex >= 0) state.daily_readings[existingIndex] = row;
  else state.daily_readings.push(row);
  state.daily_readings.sort((left, right) => left.record_date.localeCompare(right.record_date));

  state.current_reading = clone(reading);
  state.status = { freshness: 'fresh', error_code: 'none' };
  state.last_comparison = comparisonFor(state.daily_readings, row);
  state.last_delta = state.last_comparison.magnitude;
  state.sequence += 1;
  state.last_run = {
    fixture_id: runMeta.fixture_id || null,
    virtual_now: runMeta.virtual_now || reading.fetched_at,
    outcome: 'success',
    error_code: 'none',
    retry_after_seconds: null
  };
  return state;
}

export function applyError(
  inputState: EvaluationState,
  errorCode: ErrorCode,
  runMeta: RunMeta = {}
): EvaluationState {
  if (!ERROR_CODES.includes(errorCode)) {
    throw new TypeError(`unsupported error code: ${errorCode}`);
  }
  const state = clone(inputState);
  state.status = { freshness: 'stale', error_code: errorCode };
  state.sequence += 1;
  state.last_run = {
    fixture_id: runMeta.fixture_id || null,
    virtual_now: runMeta.virtual_now || null,
    outcome: 'error',
    error_code: errorCode,
    retry_after_seconds: runMeta.retry_after_seconds ?? null
  };
  return state;
}

export function runFixture(inputState: EvaluationState, fixture: ReplayFixture): EvaluationState {
  const meta: RunMeta = {
    fixture_id: fixture.fixture_id,
    virtual_now: fixture.virtual_now,
    retry_after_seconds: fixture.transport.headers['retry-after']
      ? Number(fixture.transport.headers['retry-after'])
      : null
  };

  if (fixture.transport.mode === 'timeout') return applyError(inputState, 'timeout', meta);
  if (fixture.transport.mode === 'offline') return applyError(inputState, 'offline', meta);
  if (fixture.transport.status === 401 || fixture.transport.status === 403) {
    return applyError(inputState, 'auth', meta);
  }
  if (fixture.transport.status === 429) return applyError(inputState, 'rate_limit', meta);
  if (fixture.transport.status !== null && fixture.transport.status >= 200 && fixture.transport.status < 300) {
    try {
      return applySuccessfulReading(inputState, fixture.payload as unknown as NormalizedReading, meta);
    } catch {
      return applyError(inputState, 'schema_error', meta);
    }
  }
  return applyError(inputState, 'schema_error', meta);
}

