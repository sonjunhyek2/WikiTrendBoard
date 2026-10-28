'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const adapter = require('../adapter-reset.example.js');
const assetManifest = require('../asset-manifest.json');
const publicContract = require('../public-contract.json');
const criterionRegistry = require('../criterion-registry.json');

function assert(cond, msg) {
  if (!cond) {
    console.error('[FAIL]', msg);
    process.exitCode = 1;
  } else {
    console.log('[PASS]', msg);
  }
}

// 1. Official Asset SHA-256 Verification
console.log('=== 1. Official Asset SHA-256 Verification ===');
for (const item of assetManifest.files) {
  const archiveCopyPath = path.join(
    __dirname,
    '..',
    'assets',
    'studio-task-assets',
    't04-real-information-board',
    item.path
  );
  const buf = fs.readFileSync(archiveCopyPath);
  const sha = crypto.createHash('sha256').update(buf).digest('hex');
  assert(
    sha === item.sha256 && buf.length === item.bytes,
    `Asset ${item.path} SHA-256 (${sha.slice(0, 12)}...) & bytes (${buf.length}) match manifest`
  );
}

// 2. Official Fixture Sequences Verification
console.log('\n=== 2. Official 9 Fixtures & Sequences Verification ===');
function loadFixture(id) {
  const map = {
    'T04-NORMAL-D1-A': 'normal-d1-a.json',
    'T04-NORMAL-D1-B': 'normal-d1-b.json',
    'T04-NORMAL-D2': 'normal-d2.json',
    'T04-TIMEOUT': 'timeout.json',
    'T04-AUTH-401': 'auth-401.json',
    'T04-RATE-429': 'rate-429.json',
    'T04-OFFLINE': 'offline.json',
    'T04-SCHEMA-BREAK': 'schema-break.json',
    'T04-RECOVER-D2': 'recover-d2.json'
  };
  return JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'fixtures', map[id]), 'utf8'));
}

// Success sequence: D1-A -> D1-B -> D2
let state = adapter.resetEvaluationState();
for (const fid of publicContract.fixture_contract.success_sequence) {
  const fx = loadFixture(fid);
  state = adapter.runFixture(state, fx);
  assert(
    state.status.freshness === fx.expected.freshness &&
      state.status.error_code === fx.expected.error_code &&
      state.daily_readings.length === fx.expected.row_count &&
      state.current_reading.normalized_value === fx.expected.stored_value &&
      state.last_delta === fx.expected.delta,
    `Success sequence step ${fid} matches expected state`
  );
}

// 5 Failure scenarios: D1-A -> D1-B -> Failure
for (const failId of publicContract.fixture_contract.failure_fixtures) {
  let st = adapter.resetEvaluationState();
  for (const baseId of publicContract.fixture_contract.failure_baseline_sequence) {
    st = adapter.runFixture(st, loadFixture(baseId));
  }
  const fx = loadFixture(failId);
  st = adapter.runFixture(st, fx);
  assert(
    st.status.freshness === 'stale' &&
      st.status.error_code === fx.expected.error_code &&
      st.daily_readings.length === 1 &&
      st.current_reading.normalized_value === 105,
    `Failure scenario ${failId} preserves last good value (105) with stale/${fx.expected.error_code}`
  );
}

// Recovery sequence: D1-A -> D1-B -> TIMEOUT -> RECOVER-D2 (T04-C19)
const c19Spec = criterionRegistry.criteria.find((c) => c.id === 'T04-C19').expected_recovery_transition;
let recState = adapter.resetEvaluationState();
recState = adapter.runFixture(recState, loadFixture('T04-NORMAL-D1-A'));
recState = adapter.runFixture(recState, loadFixture('T04-NORMAL-D1-B'));
recState = adapter.runFixture(recState, loadFixture('T04-TIMEOUT'));
assert(
  recState.status.freshness === c19Spec.before_retry.freshness &&
    recState.status.error_code === c19Spec.before_retry.error_code &&
    recState.daily_readings.length === c19Spec.before_retry.daily_row_count &&
    recState.current_reading.normalized_value === c19Spec.before_retry.last_good_value &&
    recState.current_reading.record_date === c19Spec.before_retry.record_date,
  'T04-C19 before_retry transition state matches registry specification'
);
recState = adapter.runFixture(recState, loadFixture('T04-RECOVER-D2'));
assert(
  recState.status.freshness === c19Spec.after_retry.freshness &&
    recState.status.error_code === c19Spec.after_retry.error_code &&
    recState.daily_readings.length === c19Spec.after_retry.daily_row_count &&
    recState.current_reading.normalized_value === c19Spec.after_retry.stored_value &&
    recState.current_reading.record_date === c19Spec.after_retry.record_date,
  'T04-C19 after_retry transition state matches registry specification'
);

// 3. README.md T04-C27 & T04-C28 Verification
console.log('\n=== 3. README.md T04-C27 & T04-C28 Verification ===');
const readmeText = fs.readFileSync(path.join(__dirname, '..', 'README.md'), 'utf8');
assert(
  readmeText.includes('① 어디로 가나요') &&
    readmeText.includes('② 3단계 이내 무엇을 하나요') &&
    readmeText.includes('③ 무엇이 보이면 통과인가요') &&
    readmeText.includes('④ 안 될 때 무엇이 보이나요'),
  'README.md contains all 4 required sections of T04-C27'
);
assert(
  readmeText.includes('① AI에게 맡긴 일') &&
    readmeText.includes('② 학생이 직접 판단한 일') &&
    readmeText.includes('③ AI 제안을 따르지 않은 일'),
  'README.md contains all 3 required sections of T04-C28'
);

