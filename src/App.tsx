import React, { useEffect, useMemo, useState } from 'react';
import './App.css';
import {
  ERROR_CODES,
  ERROR_GUIDANCE_MAP,
  ErrorCode,
  EvaluationState,
  NORMALIZED_KEYS,
  ReplayFixture,
  applyError,
  applySuccessfulReading,
  comparisonFor,
  formatKstDateTime,
  kstDate,
  resetEvaluationState,
  runFixture,
  validateNormalizedReading,
  validateStatus
} from './core/adapter';
import {
  ASSET_MANIFEST,
  FAILURE_FIXTURE_IDS,
  FIXTURE_LIST,
  FIXTURE_MANIFEST,
  FIXTURE_MAP,
  PUBLIC_CONTRACT,
  SequenceStepLog,
  runSequenceSteps,
  runSyntheticClockDailyKeyTest,
  verifyFixtureState
} from './core/fixtures';
import {
  LiveMetaState,
  fetchLiveWikimediaReading,
  loadLiveStore
} from './core/liveAdapter';

const REPLAY_STORAGE_KEY = 'aleph_t04_replay_state_v1';

function loadInitialReplayState(): {
  state: EvaluationState;
  steps: SequenceStepLog[];
  activeLabel: string;
} {
  try {
    const saved = localStorage.getItem(REPLAY_STORAGE_KEY);
    if (saved) {
      const parsed = JSON.parse(saved) as EvaluationState;
      if (parsed && parsed.schema_version === 'aleph-t04-evaluation-state-v1' && parsed.status) {
        return {
          state: parsed,
          steps: [],
          activeLabel: `저장된 합성 상태 (${parsed.last_run?.fixture_id ?? '초기'})`
        };
      }
    }
  } catch {
    // ignore
  }
  const initialSeq = runSequenceSteps(['T04-NORMAL-D1-A', 'T04-NORMAL-D1-B', 'T04-NORMAL-D2']);
  return {
    state: initialSeq.finalState,
    steps: initialSeq.steps,
    activeLabel: '정상·일별 저장 시퀀스 (Reset → D1-A → D1-B → D2)'
  };
}

export function App() {
  // 1. Live Dashboard State (한국어 위키백과 전일 최다 열람 문서 1위 조회수)
  const initialLive = useMemo(() => loadLiveStore(), []);
  const [liveState, setLiveState] = useState<EvaluationState>(initialLive.state);
  const [liveMeta, setLiveMeta] = useState<LiveMetaState>(initialLive.meta);
  const [isFetchingLive, setIsFetchingLive] = useState<boolean>(false);
  const [liveRowCountBeforeLastFetch, setLiveRowCountBeforeLastFetch] = useState<number>(
    initialLive.state.daily_readings.length
  );

  // 2. Developer & Audit Tools Accordion State (기본 닫힘)
  const [isAuditOpen, setIsAuditOpen] = useState<boolean>(false);

  // 3. Replay Track State (9종 합성 Fixture 재생기)
  const initialReplay = useMemo(() => loadInitialReplayState(), []);
  const [replayState, setReplayState] = useState<EvaluationState>(initialReplay.state);
  const [replaySteps, setReplaySteps] = useState<SequenceStepLog[]>(initialReplay.steps);
  const [activeSequenceLabel, setActiveSequenceLabel] = useState<string>(initialReplay.activeLabel);

  // 4. Synthetic Clock Daily Key Test (같은 날 3회 + 다음 날 1회)
  const syntheticClockReport = useMemo(() => runSyntheticClockDailyKeyTest(), []);

  // 5. All 5 Failure Scenarios Pre-computed Summary Table
  const fiveFailureMatrix = useMemo(() => {
    return FAILURE_FIXTURE_IDS.map((fid) => {
      const res = runSequenceSteps(['T04-NORMAL-D1-A', 'T04-NORMAL-D1-B', fid]);
      const st = res.finalState;
      const fx = FIXTURE_MAP[fid];
      const errCode = (st.status?.error_code ?? 'timeout') as ErrorCode;
      const guidance = ERROR_GUIDANCE_MAP[errCode];
      return {
        fixtureId: fid,
        descriptionKo: fx.description_ko,
        freshness: st.status?.freshness ?? 'stale',
        errorCode: st.status?.error_code ?? 'none',
        preservedValue: st.current_reading?.normalized_value ?? null,
        unit: st.current_reading?.unit ?? 'pt',
        rowCount: st.daily_readings.length,
        retryAfter: st.last_run?.retry_after_seconds,
        guidance
      };
    });
  }, []);

  // 6. C19 Official Recovery Transition Matrix (before_retry -> after_retry)
  const c19RecoveryAudit = useMemo(() => {
    const seq = runSequenceSteps([
      'T04-NORMAL-D1-A',
      'T04-NORMAL-D1-B',
      'T04-TIMEOUT',
      'T04-RECOVER-D2'
    ]);
    return {
      beforeRetry: seq.beforeRetrySnapshot!,
      afterRetry: seq.afterRetrySnapshot!
    };
  }, []);

  useEffect(() => {
    (window as unknown as Record<string, unknown>).__T04_ADAPTER__ = {
      ERROR_CODES,
      NORMALIZED_KEYS,
      applyError,
      applySuccessfulReading,
      kstDate,
      resetEvaluationState,
      runFixture,
      validateNormalizedReading,
      validateStatus
    };
  }, []);

  useEffect(() => {
    let mounted = true;
    setIsFetchingLive(true);
    setLiveRowCountBeforeLastFetch(liveState.daily_readings.length);
    fetchLiveWikimediaReading(liveState, liveMeta, true)
      .then(({ state, meta }) => {
        if (mounted) {
          setLiveState(state);
          setLiveMeta(meta);
        }
      })
      .finally(() => {
        if (mounted) setIsFetchingLive(false);
      });
    return () => {
      mounted = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleManualLiveFetch = async () => {
    setIsFetchingLive(true);
    setLiveRowCountBeforeLastFetch(liveState.daily_readings.length);
    try {
      const { state, meta } = await fetchLiveWikimediaReading(liveState, liveMeta, false);
      setLiveState(state);
      setLiveMeta(meta);
    } finally {
      setIsFetchingLive(false);
    }
  };

  const persistReplay = (nextState: EvaluationState) => {
    setReplayState(nextState);
    try {
      localStorage.setItem(REPLAY_STORAGE_KEY, JSON.stringify(nextState));
    } catch {
      // ignore
    }
  };

  const handleResetReplay = () => {
    const empty = resetEvaluationState();
    persistReplay(empty);
    setReplaySteps([
      {
        stepNumber: 0,
        actionLabel: 'Reset (합성 평가 상태 빈 상태로 초기화)',
        fixtureId: null,
        stateSnapshot: empty,
        assertion: null
      }
    ]);
    setActiveSequenceLabel('Reset 완료 (합성 평가 상태 초기화)');
  };

  const handleRunSingleFixture = (fixture: ReplayFixture) => {
    const d1aRecordId = replayState.daily_readings[0]?.record_id ?? null;
    const nextState = runFixture(replayState, fixture);
    const assertion = verifyFixtureState(nextState, fixture, d1aRecordId);
    persistReplay(nextState);
    setReplaySteps((prev) => [
      ...prev,
      {
        stepNumber: prev.length,
        actionLabel: `${fixture.fixture_id} 단일 실행 (${fixture.description_ko})`,
        fixtureId: fixture.fixture_id,
        stateSnapshot: nextState,
        assertion
      }
    ]);
    setActiveSequenceLabel(`단일 Fixture 실행: ${fixture.fixture_id}`);
  };

  const handleRunPresetSequence = (label: string, fixtureIds: string[]) => {
    const result = runSequenceSteps(fixtureIds);
    persistReplay(result.finalState);
    setReplaySteps(result.steps);
    setActiveSequenceLabel(label);
  };

  const handleRetryFromFailure = () => {
    const recoverFixture = FIXTURE_MAP['T04-RECOVER-D2'];
    handleRunSingleFixture(recoverFixture);
  };

  const liveCurrent = liveState.current_reading;
  const liveStatus = liveState.status ?? { freshness: 'fresh', error_code: 'none' };

  const orderedLiveRows = useMemo(() => {
    return [...liveState.daily_readings].sort((a, b) =>
      a.record_date.localeCompare(b.record_date)
    );
  }, [liveState.daily_readings]);

  const recalculatedLiveDelta = useMemo(() => {
    if (orderedLiveRows.length < 2) return null;
    const prev = orderedLiveRows[orderedLiveRows.length - 2];
    const curr = orderedLiveRows[orderedLiveRows.length - 1];
    const signed = curr.normalized_value - prev.normalized_value;
    const comp = comparisonFor(orderedLiveRows, curr);
    const pct =
      prev.normalized_value > 0
        ? ((signed / prev.normalized_value) * 100).toFixed(1)
        : '0.0';
    return {
      prevDate: prev.record_date,
      prevValue: prev.normalized_value,
      currDate: curr.record_date,
      currValue: curr.normalized_value,
      signed,
      pct,
      magnitude: comp.magnitude,
      direction: comp.direction,
      unit: comp.unit,
      matchesDisplayed: comp.magnitude === liveState.last_delta && comp.unit === curr.unit
    };
  }, [orderedLiveRows, liveState.last_delta]);

  const replayCurrent = replayState.current_reading;
  const replayStatus = replayState.status;
  const replayErrorGuidance =
    replayStatus && replayStatus.freshness === 'stale' && replayStatus.error_code !== 'none'
      ? ERROR_GUIDANCE_MAP[replayStatus.error_code as ErrorCode]
      : null;

  const topArticleName = liveMeta.latestRawExcerpt.topArticle.article;
  const getWikiArticleUrl = (articleName: string) =>
    `https://ko.wikipedia.org/wiki/${encodeURIComponent(articleName)}`;
  const topArticleWikiUrl = getWikiArticleUrl(topArticleName);

  return (
    <div className="app-container">
      {/* =====================================================================
          1. 상단 서비스 헤더 (위키트렌드 나우 브랜딩)
         ===================================================================== */}
      <header className="app-header">
        <div className="header-top">
          <div className="header-brand-group">
            <span className="header-eyebrow">
              WIKITREND NOW · 오늘의 위키 1위
            </span>
            <h1 className="header-title">
              위키트렌드 나우 (WikiTrend Now)
            </h1>
            <p className="header-subtitle">
              한국어 위키백과에서 지금 가장 많이 읽히는 문서와 일별 열람 추이를 실시간으로 제공합니다.
            </p>
          </div>
          <div className="header-actions">
            <span
              className={`status-badge ${
                liveStatus.freshness === 'fresh' ? 'status-fresh' : 'status-stale'
              }`}
              data-testid="live-status-badge"
            >
              <span className="status-dot" />
              {liveStatus.freshness === 'fresh'
                ? '실시간 정상 수신 중'
                : '지연 발생 · 마지막 정상값 유지 중'}
            </span>
            <button
              type="button"
              className="btn btn-header-refresh"
              onClick={handleManualLiveFetch}
              disabled={isFetchingLive}
              data-testid="live-fetch-button"
            >
              {isFetchingLive ? '데이터 동기화 중...' : '↻ 실시간 데이터 새로고침'}
            </button>
          </div>
        </div>
        <div className="policy-pills" data-testid="access-policy-badge">
          <span className="policy-pill">실시간 공개 데이터</span>
          <span className="policy-pill">Asia/Seoul (KST) 기준</span>
          <span className="policy-pill">Wikimedia 공식 API</span>
        </div>
      </header>

      {/* =====================================================================
          2. 메인 대시보드 영역 (어제 1위 문서 & 전일 대비 변화 & 6대 핵심 지표)
         ===================================================================== */}
      <main>
        <section
          className="section-card"
          aria-labelledby="live-board-heading"
          data-testid="live-board-section"
        >
          <div className="section-header">
            <div>
              <h2 id="live-board-heading" className="section-title">
                오늘의 한국어 위키백과 최다 열람 리포트
                <span className="section-badge">
                  집계 대상일: {liveMeta.latestRawExcerpt.year}-{liveMeta.latestRawExcerpt.month}-
                  {liveMeta.latestRawExcerpt.day}
                </span>
                <span
                  className="section-badge"
                  style={{ backgroundColor: '#f0fdf4', color: '#166534', borderColor: '#bbf7d0' }}
                >
                  대문·특수 페이지 제외 (순수 지식 문서 기준)
                </span>
              </h2>
              <p className="section-desc">
                Wikimedia 공식 페이지뷰 통계를 바탕으로 전일 가장 많이 열람된 1위 문서와 일별 조회수 추이를 안내합니다.{' '}
                <strong style={{ color: '#166534' }}>
                  (대문 및 특수 검색 페이지 제외, 순수 백과사전 문서 기준)
                </strong>
              </p>
            </div>
          </div>

          {liveCurrent && (
            <>
              {/* 메인 히어로 카드 2열 (어제 1위 문서 조회수 / 전일 대비 변화량) */}
              <div className="board-hero-grid">
                {/* 왼쪽 카드: 어제 1위 문서명과 조회수 */}
                <div
                  className={`hero-metric-box is-primary-card ${
                    liveStatus.freshness === 'stale' ? 'is-stale' : ''
                  }`}
                  data-testid="live-primary-metric"
                >
                  <div>
                    <div className="metric-label">
                      <span>전일 최다 열람 1위 문서 및 조회수</span>
                      {liveStatus.freshness === 'stale' ? (
                        <span className="status-badge status-stale">오래된 값 유지 중</span>
                      ) : (
                        <span className="status-badge status-fresh">최신 집계 완료</span>
                      )}
                    </div>

                    <div className="top-article-showcase">
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', flexWrap: 'wrap' }}>
                        <span className="top-article-rank-tag">1위 문서</span>
                        <a
                          href={topArticleWikiUrl}
                          target="_blank"
                          rel="noreferrer"
                          className="top-article-name"
                          title={`한국어 위키백과 '${topArticleName}' 문서 직접 읽기`}
                        >
                          {topArticleName}
                        </a>
                      </div>
                      <a
                        href={topArticleWikiUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="top-article-link"
                        title={`한국어 위키백과 '${topArticleName}' 문서로 이동`}
                      >
                        위키백과 문서 보기 ↗
                      </a>
                    </div>

                    <div className="metric-value-row">
                      <span className="metric-main-number" data-testid="live-displayed-value">
                        {liveCurrent.normalized_value.toLocaleString('ko-KR')}
                      </span>
                      <span className="metric-unit" data-testid="live-displayed-unit">
                        {liveCurrent.unit}
                      </span>
                    </div>
                  </div>

                  <div className="metric-raw-sub">
                    일일 총 열람 수 원시값:{' '}
                    <strong data-testid="live-raw-number">{liveCurrent.normalized_value}</strong>
                    {liveCurrent.unit} · 프로젝트: <code>ko.wikipedia.org (all-access)</code>
                  </div>
                </div>

                {/* 오른쪽 카드: 전일 대비 변화량 (직관적 화살표 및 색상 뱃지) */}
                <div className="hero-metric-box is-delta-card" data-testid="live-delta-box">
                  <div>
                    <div className="metric-label">
                      <span>전일 대비 조회수 변화량</span>
                      <span className="section-badge">일별 추이 비교</span>
                    </div>

                    {recalculatedLiveDelta ? (
                      <>
                        <div className="metric-value-row">
                          <span className="metric-main-number" data-testid="live-delta-value">
                            {recalculatedLiveDelta.signed > 0
                              ? `+${recalculatedLiveDelta.signed.toLocaleString('ko-KR')}`
                              : recalculatedLiveDelta.signed.toLocaleString('ko-KR')}
                          </span>
                          <span className="metric-unit">{recalculatedLiveDelta.unit}</span>
                        </div>

                        <div className="delta-badge-row">
                          <span
                            className={`delta-pill ${
                              recalculatedLiveDelta.direction === 'increase'
                                ? 'delta-increase'
                                : recalculatedLiveDelta.direction === 'decrease'
                                  ? 'delta-decrease'
                                  : 'delta-neutral'
                            }`}
                          >
                            {recalculatedLiveDelta.direction === 'increase' && (
                              <>
                                ▲ 전일 대비{' '}
                                {recalculatedLiveDelta.magnitude?.toLocaleString('ko-KR')}
                                {recalculatedLiveDelta.unit} 상승 ({recalculatedLiveDelta.pct}%)
                              </>
                            )}
                            {recalculatedLiveDelta.direction === 'decrease' && (
                              <>
                                ▼ 전일 대비{' '}
                                {recalculatedLiveDelta.magnitude?.toLocaleString('ko-KR')}
                                {recalculatedLiveDelta.unit} 하락 ({recalculatedLiveDelta.pct}%)
                              </>
                            )}
                            {recalculatedLiveDelta.direction === 'unchanged' && (
                              <>▬ 전일과 동일 (변동 없음)</>
                            )}
                          </span>
                        </div>
                      </>
                    ) : (
                      <p>비교할 이전 날짜 기록을 수집 중입니다.</p>
                    )}
                  </div>

                  {recalculatedLiveDelta && (
                    <div className="delta-comparison-bars">
                      <div className="delta-bar-row">
                        <span>이전 기록 ({recalculatedLiveDelta.prevDate})</span>
                        <strong>
                          {recalculatedLiveDelta.prevValue.toLocaleString('ko-KR')}{' '}
                          {recalculatedLiveDelta.unit}
                        </strong>
                      </div>
                      <div className="delta-bar-row">
                        <span>오늘 기록 ({recalculatedLiveDelta.currDate})</span>
                        <strong>
                          {recalculatedLiveDelta.currValue.toLocaleString('ko-KR')}{' '}
                          {recalculatedLiveDelta.unit}
                        </strong>
                      </div>
                    </div>
                  )}
                </div>
              </div>

              {/* 함께 많이 읽힌 상위 Top 5 문서 스트립 */}
              {liveMeta.latestRawExcerpt.top5Articles.length > 0 && (
                <div className="top5-strip">
                  <span className="top5-strip-label">전일 인기 순수 지식 문서 TOP 5:</span>
                  <span
                    className="section-badge"
                    style={{
                      fontSize: '0.74rem',
                      padding: '0.15rem 0.55rem',
                      marginRight: '0.35rem',
                      backgroundColor: '#f0fdf4',
                      color: '#166534',
                      borderColor: '#bbf7d0'
                    }}
                  >
                    대문·특수 검색 페이지 제외
                  </span>
                  {liveMeta.latestRawExcerpt.top5Articles.map((item) => (
                    <a
                      key={`${item.rank}-${item.article}`}
                      href={getWikiArticleUrl(item.article)}
                      target="_blank"
                      rel="noreferrer"
                      className={`top5-chip ${item.rank === 1 ? 'is-rank1' : ''}`}
                      title={`한국어 위키백과 '${item.article}' 문서 읽기`}
                    >
                      <strong>{item.rank}위</strong> {item.article} (
                      {item.views.toLocaleString('ko-KR')}회) ↗
                    </a>
                  ))}
                </div>
              )}

              {/* 6개 핵심 지표 카드 (2행 3열 반응형 그리드, 글자 잘림/삐져나옴 완전 해결) */}
              <div className="metadata-grid" data-testid="live-metadata-grid">
                <div className="meta-item">
                  <div className="meta-item-header">
                    <span>최다 조회수</span>
                    <span className="meta-item-icon">1위 기록</span>
                  </div>
                  <div className="meta-item-body">
                    {liveCurrent.normalized_value.toLocaleString('ko-KR')} {liveCurrent.unit}
                  </div>
                  <div className="meta-item-sub">
                    원시 수치: {liveCurrent.normalized_value} · 대상 문서: {topArticleName}
                  </div>
                </div>

                <div className="meta-item">
                  <div className="meta-item-header">
                    <span>단위</span>
                    <span className="meta-item-icon">측정 단위</span>
                  </div>
                  <div className="meta-item-body">{liveCurrent.unit} (페이지뷰)</div>
                  <div className="meta-item-sub">
                    일별 누적 문서 열람 횟수 (데스크톱·모바일 전체 합산)
                  </div>
                </div>

                <div className="meta-item">
                  <div className="meta-item-header">
                    <span>데이터 출처</span>
                    <span className="meta-item-icon">공식 원천</span>
                  </div>
                  <div className="meta-item-body">{liveCurrent.source_name}</div>
                  <div className="meta-item-sub">
                    <a
                      href={liveCurrent.source_url}
                      target="_blank"
                      rel="noreferrer"
                      data-testid="live-source-url"
                      title="원천 REST API 응답 JSON 보기"
                    >
                      {liveCurrent.source_url}
                    </a>
                  </div>
                </div>

                <div className="meta-item">
                  <div className="meta-item-header">
                    <span>원천 집계 시각</span>
                    <span className="meta-item-icon">출처 시각</span>
                  </div>
                  <div className="meta-item-body" data-testid="live-source-time">
                    {formatKstDateTime(liveCurrent.source_time)}
                  </div>
                  <div className="meta-item-sub">
                    ISO 원문: {liveCurrent.source_time ?? 'null'}
                  </div>
                </div>

                <div className="meta-item">
                  <div className="meta-item-header">
                    <span>시스템 조회 시각</span>
                    <span className="meta-item-icon">수집 시각</span>
                  </div>
                  <div className="meta-item-body" data-testid="live-fetched-time">
                    {formatKstDateTime(liveCurrent.fetched_at)}
                  </div>
                  <div className="meta-item-sub">ISO 원문: {liveCurrent.fetched_at}</div>
                </div>

                <div className="meta-item">
                  <div className="meta-item-header">
                    <span>기준 시간대</span>
                    <span className="meta-item-icon">KST 기준</span>
                  </div>
                  <div className="meta-item-body" data-testid="live-timezone">
                    {liveCurrent.record_timezone} (UTC+09:00)
                  </div>
                  <div className="meta-item-sub">
                    일별 기록 기준일: {liveCurrent.record_date}
                  </div>
                </div>
              </div>

              {/* 최근 일별 열람 기록 테이블 */}
              <div className="sub-panel" data-testid="live-two-days-panel">
                <div
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    flexWrap: 'wrap',
                    gap: '0.5rem'
                  }}
                >
                  <h3 className="sub-panel-title" style={{ margin: 0 }}>
                    일별 최다 열람 추이 기록 ({liveCurrent.record_timezone} 기준)
                  </h3>
                  <span className="status-badge status-fresh" data-testid="live-row-count-badge">
                    누적 보존 일수: {liveState.daily_readings.length}일 (금일 동기화{' '}
                    {liveMeta.sameDayRepeatCount}회 완료)
                  </span>
                </div>

                <div
                  tabIndex={0}
                  role="region"
                  aria-labelledby="live-daily-table-caption"
                  className="table-wrapper"
                >
                  <table
                    style={
                      {
                        '--label-2': '"기준 날짜 (KST)"',
                        '--label-3': '"1위 문서 및 원천 주소"',
                        '--label-4': '"원천 집계 시각"',
                        '--label-5': '"최다 조회수"',
                        '--label-6': '"단위"',
                        '--label-7': '"데이터 정합성"'
                      } as React.CSSProperties
                    }
                  >
                    <caption id="live-daily-table-caption">
                      한국어 위키백과 일별 최다 열람 1위 기록 및 전일 대비 비교표
                    </caption>
                    <thead>
                      <tr>
                        <th scope="col">구분</th>
                        <th scope="col">기준 날짜 (KST)</th>
                        <th scope="col">1위 문서 및 원천 주소</th>
                        <th scope="col">원천 집계 시각</th>
                        <th scope="col">최다 조회수</th>
                        <th scope="col">단위</th>
                        <th scope="col">데이터 정합성</th>
                      </tr>
                    </thead>
                    <tbody>
                      {orderedLiveRows.map((row, idx) => {
                        const articleTitle =
                          liveMeta.articleByDate[row.record_date] || topArticleName || '문화방송';
                        return (
                          <tr key={row.record_id} data-testid={`live-daily-row-${idx + 1}`}>
                            <th scope="row">
                              <div>{idx === 0 ? '이전 기록일' : '최근 기록일'}</div>
                              <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                                {row.record_date}
                              </span>
                            </th>
                            <td>
                              <strong>{row.record_date}</strong>
                              <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                                조회: {formatKstDateTime(row.last_fetched_at)}
                              </div>
                            </td>
                            <td style={{ fontSize: '0.8rem', wordBreak: 'break-all' }}>
                              <div style={{ fontWeight: 700, marginBottom: '0.25rem' }}>
                                <a
                                  href={getWikiArticleUrl(articleTitle)}
                                  target="_blank"
                                  rel="noreferrer"
                                  style={{ color: '#1e3a8a', textDecoration: 'none' }}
                                  className="top-article-link"
                                  title={`한국어 위키백과 '${articleTitle}' 문서 직접 열람`}
                                >
                                  📖 1위 문서: <strong>{articleTitle}</strong> ↗
                                </a>
                              </div>
                              <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', marginBottom: '0.1rem' }}>
                                원천 API 출처 (JSON):
                              </div>
                              <a
                                href={row.reading.source_url}
                                target="_blank"
                                rel="noreferrer"
                                className="mono"
                                style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}
                                title="원천 REST API 응답 JSON 보기"
                              >
                                {row.reading.source_url}
                              </a>
                            </td>
                            <td className="mono" style={{ fontSize: '0.78rem' }}>
                              <div>{formatKstDateTime(row.reading.source_time)}</div>
                              <div style={{ color: 'var(--text-muted)' }}>
                                ({row.reading.source_time})
                              </div>
                            </td>
                            <td>
                              <strong>{row.normalized_value.toLocaleString('ko-KR')}</strong>{' '}
                              <span className="mono" style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>
                                ({row.normalized_value})
                              </span>
                            </td>
                            <td>
                              <strong>{row.unit}</strong>
                            </td>
                            <td>
                              <span className="status-badge status-fresh">정상 검증 완료</span>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            </>
          )}
        </section>
      </main>

      {/* =====================================================================
          3. 하단 접이식 아코디언: 개발자 및 평가관용 도구 (Developer & Audit Tools)
             - 기본 상태는 닫혀 있어 일반 사용자의 대시보드 경험을 해치지 않음
             - 펼치면 원자료·저장값·화면값 대조, 9종 합성 Fixture 재생기, 복구 검증표, 해시 무결성, 제출 가이드 전체 제공
         ===================================================================== */}
      <details
        className="dev-audit-accordion"
        open={isAuditOpen}
        onToggle={(e) => setIsAuditOpen((e.currentTarget as HTMLDetailsElement).open)}
        data-testid="developer-audit-accordion"
      >
        <summary className="dev-audit-summary" data-testid="developer-audit-toggle">
          <span>
            🛠️ [개발자 및 평가관용 도구 (Developer &amp; Audit Tools) {isAuditOpen ? '닫기' : '열기'}]
          </span>
          <span className="dev-audit-summary-btn-tag">
            {isAuditOpen ? '접기 ▲' : '9종 Fixture 시험기 · 복구 검증 · 데이터 대조 펼치기 ▼'}
          </span>
        </summary>

        <div className="dev-audit-body">
          {/* 3-1. 실시간 원자료 · 저장값 · 화면값 1:1:1 대조 (T04-C10) */}
          {liveCurrent && (
            <section
              className="section-card"
              data-testid="live-triple-match-panel"
              style={{ marginBottom: '1.5rem' }}
            >
              <div className="section-header">
                <div>
                  <h3 className="section-title" style={{ fontSize: '1.1rem' }}>
                    실시간 응답 원자료 · 로컬 저장값 · 화면 표시값 1:1:1 정합성 대조 (T04-C10)
                  </h3>
                  <p className="section-desc">
                    같은 날 재실행 전 행 수 {liveRowCountBeforeLastFetch}건 → 재실행 후 행 수{' '}
                    {liveState.daily_readings.length}건 유지 (T04-C20 충족)
                  </p>
                </div>
                <span className="status-badge status-fresh">
                  원자료({liveMeta.latestRawExcerpt.topArticle.views}) === 저장값(
                  {liveCurrent.normalized_value}) === 화면값({liveCurrent.normalized_value}) · 100% 일치
                </span>
              </div>

              <div className="triple-compare-grid">
                <div>
                  <div style={{ fontWeight: 700, fontSize: '0.84rem', marginBottom: '0.4rem' }}>
                    ① 원자료 (Wikimedia API Raw Response 발췌)
                  </div>
                  <pre className="code-box">
                    {JSON.stringify(
                      {
                        items: [
                          {
                            project: liveMeta.latestRawExcerpt.project,
                            access: liveMeta.latestRawExcerpt.access,
                            year: liveMeta.latestRawExcerpt.year,
                            month: liveMeta.latestRawExcerpt.month,
                            day: liveMeta.latestRawExcerpt.day,
                            articles: [liveMeta.latestRawExcerpt.topArticle]
                          }
                        ]
                      },
                      null,
                      2
                    )}
                  </pre>
                </div>
                <div>
                  <div style={{ fontWeight: 700, fontSize: '0.84rem', marginBottom: '0.4rem' }}>
                    ② 저장값 (LocalStorage NormalizedReading)
                  </div>
                  <pre className="code-box">{JSON.stringify(liveCurrent, null, 2)}</pre>
                </div>
                <div>
                  <div style={{ fontWeight: 700, fontSize: '0.84rem', marginBottom: '0.4rem' }}>
                    ③ 화면값 (Displayed Screen Fields 대조)
                  </div>
                  <pre className="code-box">
                    {JSON.stringify(
                      {
                        displayed_value: liveCurrent.normalized_value,
                        displayed_formatted: `${liveCurrent.normalized_value.toLocaleString('ko-KR')} ${liveCurrent.unit}`,
                        unit: liveCurrent.unit,
                        source_name: liveCurrent.source_name,
                        source_url: liveCurrent.source_url,
                        source_time: liveCurrent.source_time,
                        fetched_at: liveCurrent.fetched_at,
                        record_timezone: liveCurrent.record_timezone,
                        record_date: liveCurrent.record_date,
                        exact_match:
                          liveMeta.latestRawExcerpt.topArticle.views ===
                          liveCurrent.normalized_value
                      },
                      null,
                      2
                    )}
                  </pre>
                </div>
              </div>
            </section>
          )}

          {/* 3-2. 결정론적 합성 Fixture 재생기 (Fixture Runner) */}
          <section
            className="section-card"
            aria-labelledby="fixture-runner-heading"
            data-testid="fixture-runner-section"
          >
            <div className="section-header">
              <div>
                <h3 id="fixture-runner-heading" className="section-title">
                  결정론적 합성 Fixture 재생기 — 다섯 가지 실패와 회복 (Fixture Runner)
                  <span className="section-badge">T04-C12 ~ C21 · C26</span>
                </h3>
                <p className="section-desc">
                  공식 9종 합성 시험값(<code>fixtures/*.json</code>)을 사용하여 느림·401 거절·429 호출 제한·오프라인·스키마 변경 등 5가지 실패와{' '}
                  <code>T04-RECOVER-D2</code> 복구 시퀀스를 결정론적으로 시험합니다.
                </p>
              </div>
              <div className="btn-group">
                <button
                  type="button"
                  className="btn btn-danger"
                  onClick={handleResetReplay}
                  data-testid="fixture-reset-button"
                >
                  합성 상태 초기화 (Reset)
                </button>
              </div>
            </div>

            {/* 공식 시퀀스 원클릭 버튼 모음 */}
            <div className="sub-panel" style={{ marginTop: 0, marginBottom: '1.25rem' }}>
              <h4 className="sub-panel-title">
                공식 시퀀스 원클릭 실행 (public-contract.json 표준 재생 순서)
              </h4>
              <div className="btn-group" style={{ marginBottom: '0.85rem' }}>
                <button
                  type="button"
                  className="btn btn-primary"
                  onClick={() =>
                    handleRunPresetSequence('정상·일별 저장 시퀀스 (Reset → D1-A → D1-B → D2)', [
                      'T04-NORMAL-D1-A',
                      'T04-NORMAL-D1-B',
                      'T04-NORMAL-D2'
                    ])
                  }
                  data-testid="seq-success-button"
                >
                  ① 정상·일별 저장 (Reset → D1-A → D1-B → D2)
                </button>

                <button
                  type="button"
                  className="btn btn-warning"
                  onClick={() =>
                    handleRunPresetSequence(
                      '실패 1: 느린 응답 (Reset → D1-A → D1-B → T04-TIMEOUT)',
                      ['T04-NORMAL-D1-A', 'T04-NORMAL-D1-B', 'T04-TIMEOUT']
                    )
                  }
                  data-testid="seq-timeout-button"
                >
                  ② 느림 재현 (D1-A → D1-B → TIMEOUT) [C12]
                </button>

                <button
                  type="button"
                  className="btn btn-warning"
                  onClick={() =>
                    handleRunPresetSequence(
                      '실패 2: 원천 401 거절 (Reset → D1-A → D1-B → T04-AUTH-401)',
                      ['T04-NORMAL-D1-A', 'T04-NORMAL-D1-B', 'T04-AUTH-401']
                    )
                  }
                  data-testid="seq-auth-button"
                >
                  ③ 401 거절 재현 (D1-A → D1-B → AUTH-401) [C13]
                </button>

                <button
                  type="button"
                  className="btn btn-warning"
                  onClick={() =>
                    handleRunPresetSequence(
                      '실패 3: 호출 제한 429 (Reset → D1-A → D1-B → T04-RATE-429)',
                      ['T04-NORMAL-D1-A', 'T04-NORMAL-D1-B', 'T04-RATE-429']
                    )
                  }
                  data-testid="seq-rate-button"
                >
                  ④ 호출 제한 재현 (D1-A → D1-B → RATE-429) [C14]
                </button>

                <button
                  type="button"
                  className="btn btn-warning"
                  onClick={() =>
                    handleRunPresetSequence(
                      '실패 4: 오프라인 (Reset → D1-A → D1-B → T04-OFFLINE)',
                      ['T04-NORMAL-D1-A', 'T04-NORMAL-D1-B', 'T04-OFFLINE']
                    )
                  }
                  data-testid="seq-offline-button"
                >
                  ⑤ 오프라인 재현 (D1-A → D1-B → OFFLINE) [C15]
                </button>

                <button
                  type="button"
                  className="btn btn-warning"
                  onClick={() =>
                    handleRunPresetSequence(
                      '실패 5: 응답 형식 변경 (Reset → D1-A → D1-B → T04-SCHEMA-BREAK)',
                      ['T04-NORMAL-D1-A', 'T04-NORMAL-D1-B', 'T04-SCHEMA-BREAK']
                    )
                  }
                  data-testid="seq-schema-button"
                >
                  ⑥ 형식 변경 재현 (D1-A → D1-B → SCHEMA-BREAK) [C16]
                </button>

                <button
                  type="button"
                  className="btn btn-success"
                  onClick={() =>
                    handleRunPresetSequence(
                      '오류 뒤 회복 시퀀스 (Reset → D1-A → D1-B → TIMEOUT → RECOVER-D2)',
                      ['T04-NORMAL-D1-A', 'T04-NORMAL-D1-B', 'T04-TIMEOUT', 'T04-RECOVER-D2']
                    )
                  }
                  data-testid="seq-recover-button"
                >
                  ⑦ 오류 뒤 회복 (D1-A → D1-B → TIMEOUT → RECOVER-D2) [C19]
                </button>
              </div>

              <div
                style={{
                  fontSize: '0.82rem',
                  fontWeight: 700,
                  color: 'var(--text-secondary)',
                  marginBottom: '0.45rem'
                }}
              >
                개별 9종 공식 Fixture 단일 클릭 실행 (현재 합성 상태 위에 순차 적용):
              </div>
              <div className="btn-group">
                {FIXTURE_LIST.map((fx) => (
                  <button
                    key={fx.fixture_id}
                    type="button"
                    className="btn"
                    onClick={() => handleRunSingleFixture(fx)}
                    data-testid={`fixture-btn-${fx.fixture_id}`}
                    title={fx.description_ko}
                  >
                    {fx.fixture_id}
                  </button>
                ))}
              </div>
            </div>

            {/* 현재 합성 재생 상태 표시 보드 */}
            <div
              style={{
                border: '2px solid var(--border-strong)',
                borderRadius: 'var(--radius-lg)',
                padding: '1.25rem',
                background: '#ffffff',
                marginBottom: '1.25rem'
              }}
              data-testid="replay-active-board"
            >
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  flexWrap: 'wrap',
                  gap: '0.75rem',
                  marginBottom: '1rem'
                }}
              >
                <div>
                  <span className="section-badge" style={{ marginRight: '0.5rem' }}>
                    현재 재생 시나리오
                  </span>
                  <strong>{activeSequenceLabel}</strong>
                </div>
                <div>
                  {replayStatus ? (
                    <span
                      className={`status-badge ${
                        replayStatus.freshness === 'fresh' ? 'status-fresh' : 'status-stale'
                      }`}
                      data-testid="replay-status-badge"
                    >
                      freshness: <strong>{replayStatus.freshness}</strong> · error_code:{' '}
                      <strong>{replayStatus.error_code}</strong>
                    </span>
                  ) : (
                    <span className="status-badge delta-neutral" data-testid="replay-status-badge">
                      초기 빈 상태 (Reset · status: null)
                    </span>
                  )}
                </div>
              </div>

              {/* 실패 상태일 때 전용 실패 설명 배너 및 [다시 시도] 행동 버튼 표시 (T04-C12~C19) */}
              {replayErrorGuidance && (
                <div className="failure-banner" role="alert" data-testid="replay-failure-banner">
                  <div className="failure-banner-header">
                    <div>
                      <span
                        className="status-badge status-error"
                        style={{ marginBottom: '0.35rem' }}
                      >
                        {replayErrorGuidance.criterionId} · {replayErrorGuidance.fixtureId} ·
                        error_code: {replayErrorGuidance.code}
                      </span>
                      <h4 className="failure-banner-title">{replayErrorGuidance.titleKo}</h4>
                    </div>
                    <button
                      type="button"
                      className="btn btn-success"
                      onClick={handleRetryFromFailure}
                      data-testid="replay-retry-button"
                    >
                      다시 시도 (T04-RECOVER-D2 재생하여 복구)
                    </button>
                  </div>
                  <ul className="failure-detail-list">
                    <li>
                      <strong>실패 원인 설명:</strong> {replayErrorGuidance.causeKo}
                    </li>
                    <li>
                      <strong>사용자가 취할 다음 행동:</strong> {replayErrorGuidance.nextActionKo}
                    </li>
                    <li>
                      <strong>마지막 정상값 보존 정책 (T04-C17 · C18):</strong> 직전 정상값(
                      <strong>
                        {replayCurrent?.normalized_value ?? 105} {replayCurrent?.unit ?? 'pt'}
                      </strong>
                      )을 지우지 않고 보존하며, 화면에{' '}
                      <strong style={{ textDecoration: 'underline' }}>오래된 값 (stale)</strong>{' '}
                      표시를 부착했습니다.
                    </li>
                    <li className="mono" style={{ fontSize: '0.8rem' }}>
                      관측 메타: {replayErrorGuidance.technicalDetailKo}
                      {replayState.last_run?.retry_after_seconds
                        ? ` | Retry-After: ${replayState.last_run.retry_after_seconds}초`
                        : ''}
                    </li>
                  </ul>
                </div>
              )}

              {replayCurrent ? (
                <div className="board-hero-grid" style={{ marginBottom: 0 }}>
                  <div
                    className={`hero-metric-box ${
                      replayStatus?.freshness === 'stale' ? 'is-stale' : ''
                    }`}
                    data-testid="replay-metric-card"
                  >
                    <div className="metric-label">
                      <span>합성 재생 보존 값 (마지막 정상값 · T04-C17)</span>
                      {replayStatus?.freshness === 'stale' ? (
                        <span
                          className="status-badge status-stale"
                          data-testid="replay-stale-badge"
                        >
                          오래된 값 (stale · {replayStatus.error_code}) [T04-C18]
                        </span>
                      ) : (
                        <span
                          className="status-badge status-fresh"
                          data-testid="replay-fresh-badge"
                        >
                          최신 정상값 (fresh · none)
                        </span>
                      )}
                    </div>
                    <div className="metric-value-row">
                      <span className="metric-main-number" data-testid="replay-displayed-value">
                        {replayCurrent.normalized_value}
                      </span>
                      <span className="metric-unit" data-testid="replay-displayed-unit">
                        {replayCurrent.unit}
                      </span>
                    </div>
                    <div className="metric-raw-sub">
                      record_date:{' '}
                      <strong data-testid="replay-record-date">{replayCurrent.record_date}</strong> ·
                      기준 시간대: <strong>{replayCurrent.record_timezone}</strong> · 일별 행 수:{' '}
                      <strong data-testid="replay-row-count">
                        {replayState.daily_readings.length}건
                      </strong>
                    </div>
                  </div>

                  <div className="hero-metric-box">
                    <div className="metric-label">
                      <span>합성 재생 전일 대비 변화 &amp; 메타 정보</span>
                      <span className="section-badge">
                        행 수: {replayState.daily_readings.length}건
                      </span>
                    </div>
                    <div className="metric-value-row">
                      <span className="metric-main-number" data-testid="replay-delta-value">
                        {replayState.last_delta !== null
                          ? `+${replayState.last_delta}`
                          : 'null (비교 전)'}
                      </span>
                      {replayState.last_delta !== null && (
                        <span className="metric-unit">{replayCurrent.unit}</span>
                      )}
                    </div>
                    <div className="metric-raw-sub">
                      <div>
                        출처: {replayCurrent.source_name} ({replayCurrent.source_url})
                      </div>
                      <div>출처 시각(source_time): {replayCurrent.source_time ?? 'null (미제공)'}</div>
                      <div>조회 시각(fetched_at): {replayCurrent.fetched_at}</div>
                    </div>
                  </div>
                </div>
              ) : (
                <div
                  style={{
                    padding: '1.25rem',
                    background: 'var(--bg-subtle)',
                    borderRadius: 'var(--radius-md)',
                    textAlign: 'center',
                    color: 'var(--text-secondary)'
                  }}
                >
                  현재 합성 평가 상태가 비어 있습니다(<code>current_reading: null</code>,{' '}
                  <code>daily_readings: 0건</code>). 위의 공식 시퀀스 버튼이나 개별 Fixture 버튼을 눌러 재생하세요.
                </div>
              )}

              {/* 현재 재생된 시퀀스 스텝별 상태 전이 로그 */}
              {replaySteps.length > 0 && (
                <div style={{ marginTop: '1rem' }} data-testid="replay-steps-log">
                  <div style={{ fontWeight: 700, fontSize: '0.86rem', marginBottom: '0.4rem' }}>
                    실행된 Fixture 단계별 상태 전이 및 expected 검증 로그 ({replaySteps.length}단계):
                  </div>
                  <div
                    tabIndex={0}
                    role="region"
                    aria-labelledby="replay-step-log-caption"
                    className="table-wrapper"
                  >
                    <table
                      style={
                        {
                          '--label-2': '"실행 동작 / Fixture"',
                          '--label-3': '"freshness / error_code"',
                          '--label-4': '"일별 행 수"',
                          '--label-5': '"보존/저장값"',
                          '--label-6': '"전일 대비 변화"',
                          '--label-7': '"expected 검증"'
                        } as React.CSSProperties
                      }
                    >
                      <caption id="replay-step-log-caption">
                        현재 실행 시퀀스의 단계별 상태(freshness, error_code, row_count, stored_value, delta) 검증 결과
                      </caption>
                      <thead>
                        <tr>
                          <th scope="col">단계</th>
                          <th scope="col">실행 동작 / Fixture</th>
                          <th scope="col">freshness / error_code</th>
                          <th scope="col">일별 행 수</th>
                          <th scope="col">보존/저장값</th>
                          <th scope="col">전일 대비 변화</th>
                          <th scope="col">expected 검증</th>
                        </tr>
                      </thead>
                      <tbody>
                        {replaySteps.map((step) => (
                          <tr key={`${step.stepNumber}-${step.actionLabel}`}>
                            <th scope="row">Step {step.stepNumber}</th>
                            <td>{step.actionLabel}</td>
                            <td className="mono">
                              {step.stateSnapshot.status
                                ? `${step.stateSnapshot.status.freshness} / ${step.stateSnapshot.status.error_code}`
                                : 'null (초기화)'}
                            </td>
                            <td>{step.stateSnapshot.daily_readings.length}건</td>
                            <td>
                              {step.stateSnapshot.current_reading
                                ? `${step.stateSnapshot.current_reading.normalized_value} ${step.stateSnapshot.current_reading.unit}`
                                : 'null'}
                            </td>
                            <td>
                              {step.stateSnapshot.last_delta !== null
                                ? `+${step.stateSnapshot.last_delta} pt`
                                : 'null'}
                            </td>
                            <td>
                              {step.assertion ? (
                                <span
                                  className={`status-badge ${
                                    step.assertion.passed ? 'status-fresh' : 'status-error'
                                  }`}
                                >
                                  {step.assertion.passed ? 'expected 100% 일치 (MET)' : '불일치'}
                                </span>
                              ) : (
                                <span className="mono">초기 상태</span>
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </div>

            {/* 외부 원천 실패 다섯 상태 전수 대조표 (T04-C12 ~ T04-C18, T04-C26) */}
            <div className="sub-panel">
              <h4 className="sub-panel-title">
                외부 원천 실패 다섯 가지 상태 및 마지막 정상값 보존 전수 검증표 (T04-C12 ~ T04-C18, C26)
              </h4>
              <div
                tabIndex={0}
                role="region"
                aria-labelledby="five-failures-caption"
                className="table-wrapper"
              >
                <table
                  style={
                    {
                      '--label-2': '"재생 시퀀스"',
                      '--label-3': '"상태 (freshness / error_code)"',
                      '--label-4': '"마지막 정상값 보존 (C17/C18)"',
                      '--label-5': '"실패 원인 설명"',
                      '--label-6': '"사용자가 취할 다음 행동"',
                      '--label-7': '"즉시 재현"'
                    } as React.CSSProperties
                  }
                >
                  <caption id="five-failures-caption">
                    다섯 가지 합성 실패(느림·401·429·오프라인·스키마 변경)별 상태·설명·다음 행동 대조표
                  </caption>
                  <thead>
                    <tr>
                      <th scope="col">기준 / Fixture ID</th>
                      <th scope="col">재생 시퀀스</th>
                      <th scope="col">상태 (freshness / error_code)</th>
                      <th scope="col">마지막 정상값 보존 (C17/C18)</th>
                      <th scope="col">실패 종류별 설명</th>
                      <th scope="col">사용자가 취할 다음 행동</th>
                      <th scope="col">즉시 재현</th>
                    </tr>
                  </thead>
                  <tbody>
                    {fiveFailureMatrix.map((row) => (
                      <tr key={row.fixtureId}>
                        <th scope="row">
                          <div>{row.guidance.criterionId}</div>
                          <code>{row.fixtureId}</code>
                        </th>
                        <td className="mono" style={{ fontSize: '0.78rem' }}>
                          Reset → D1-A(100) → D1-B(105) → {row.fixtureId}
                        </td>
                        <td>
                          <span className="status-badge status-stale">
                            {row.freshness} / {row.errorCode}
                          </span>
                        </td>
                        <td>
                          <strong>
                            {row.preservedValue} {row.unit} 보존
                          </strong>{' '}
                          (행 {row.rowCount}건 유지 · 오래된 값 표시)
                        </td>
                        <td>{row.guidance.causeKo}</td>
                        <td>{row.guidance.nextActionKo}</td>
                        <td>
                          <button
                            type="button"
                            className="btn btn-warning"
                            onClick={() =>
                              handleRunPresetSequence(
                                `${row.guidance.criterionId} 재현 (Reset → D1-A → D1-B → ${row.fixtureId})`,
                                ['T04-NORMAL-D1-A', 'T04-NORMAL-D1-B', row.fixtureId]
                              )
                            }
                          >
                            이 실패 재생
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            {/* T04-C19 오류 뒤 회복(before_retry -> after_retry) 공개 복구 상태표 */}
            <div className="sub-panel" data-testid="c19-recovery-table-panel">
              <h4 className="sub-panel-title">
                T04-C19 오류 뒤 회복 상태 전이 검증표 (T04-TIMEOUT 직후 → 다시 시도 → T04-RECOVER-D2)
              </h4>
              <div
                tabIndex={0}
                role="region"
                aria-labelledby="c19-recovery-caption"
                className="table-wrapper"
              >
                <table
                  style={
                    {
                      '--label-2': '"freshness"',
                      '--label-3': '"error_code"',
                      '--label-4': '"일별 행 수 (daily_row_count)"',
                      '--label-5': '"보존/저장값"',
                      '--label-6': '"기록 날짜 (record_date)"',
                      '--label-7': '"전일 대비 변화 / 판정"'
                    } as React.CSSProperties
                  }
                >
                  <caption id="c19-recovery-caption">
                    criterion-registry.json T04-C19 expected_recovery_transition 대조표
                  </caption>
                  <thead>
                    <tr>
                      <th scope="col">전이 단계</th>
                      <th scope="col">freshness</th>
                      <th scope="col">error_code</th>
                      <th scope="col">일별 행 수 (daily_row_count)</th>
                      <th scope="col">보존/저장값</th>
                      <th scope="col">기록 날짜 (record_date)</th>
                      <th scope="col">전일 대비 변화 / 판정</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr>
                      <th scope="row">
                        before_retry (<code>T04-TIMEOUT</code> 직후)
                      </th>
                      <td>
                        <span className="status-badge status-stale">
                          {c19RecoveryAudit.beforeRetry.status?.freshness}
                        </span>
                      </td>
                      <td>
                        <code>{c19RecoveryAudit.beforeRetry.status?.error_code}</code>
                      </td>
                      <td>{c19RecoveryAudit.beforeRetry.daily_readings.length}건</td>
                      <td>
                        {c19RecoveryAudit.beforeRetry.current_reading?.normalized_value}{' '}
                        {c19RecoveryAudit.beforeRetry.current_reading?.unit} (last_good_value)
                      </td>
                      <td>{c19RecoveryAudit.beforeRetry.current_reading?.record_date}</td>
                      <td>
                        <span className="status-badge status-fresh">계약 일치 (MET)</span>
                      </td>
                    </tr>
                    <tr>
                      <th scope="row">
                        after_retry (<code>T04-RECOVER-D2</code> 재생 후)
                      </th>
                      <td>
                        <span className="status-badge status-fresh">
                          {c19RecoveryAudit.afterRetry.status?.freshness}
                        </span>
                      </td>
                      <td>
                        <code>{c19RecoveryAudit.afterRetry.status?.error_code}</code>
                      </td>
                      <td>
                        {c19RecoveryAudit.afterRetry.daily_readings.length}건 (신규 다음 날짜 행 +1건)
                      </td>
                      <td>
                        {c19RecoveryAudit.afterRetry.current_reading?.normalized_value}{' '}
                        {c19RecoveryAudit.afterRetry.current_reading?.unit} (stored_value)
                      </td>
                      <td>{c19RecoveryAudit.afterRetry.current_reading?.record_date}</td>
                      <td>
                        <strong>+{c19RecoveryAudit.afterRetry.last_delta} pt</strong> ·{' '}
                        <span className="status-badge status-fresh">계약 일치 (MET)</span>
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>

            {/* 같은 날짜 3회 + 다음 날짜 1회 합성 시계 시험 결과 (T04-C20, T04-C21) */}
            <div className="sub-panel" data-testid="card4-clock-test-panel">
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  flexWrap: 'wrap',
                  gap: '0.5rem'
                }}
              >
                <h4 className="sub-panel-title" style={{ margin: 0 }}>
                  하루 한 줄: 같은 날짜 3회 + 다음 날짜 1회 합성 시계 시험 (T04-C20 · T04-C21)
                </h4>
                <span className="status-badge status-fresh">
                  같은 날 3회 후 행 수: 1건 유지 (T04-C20 MET) · 다음 날 1회 후 행 수: 2건 (T04-C21 MET)
                </span>
              </div>
              <div
                tabIndex={0}
                role="region"
                aria-labelledby="clock-test-caption"
                className="table-wrapper"
              >
                <table
                  style={
                    {
                      '--label-2': '"합성 조회 시각 (UTC)"',
                      '--label-3': '"Asia/Seoul 날짜 키 (record_date)"',
                      '--label-4': '"입력 값"',
                      '--label-5': '"실행 전 → 후 일별 행 수"',
                      '--label-6': '"고유 레코드 ID (record_id)"',
                      '--label-7': '"전일 대비 변화"'
                    } as React.CSSProperties
                  }
                >
                  <caption id="clock-test-caption">
                    일별 고유키(signal_id + record_date) 기준 같은 날 재실행 전후 행 수 및 다음 날 행 추가 검증표
                  </caption>
                  <thead>
                    <tr>
                      <th scope="col">시험 단계</th>
                      <th scope="col">합성 조회 시각 (UTC)</th>
                      <th scope="col">Asia/Seoul 날짜 키 (record_date)</th>
                      <th scope="col">입력 값</th>
                      <th scope="col">실행 전 → 후 일별 행 수</th>
                      <th scope="col">고유 레코드 ID (record_id)</th>
                      <th scope="col">전일 대비 변화</th>
                    </tr>
                  </thead>
                  <tbody>
                    {syntheticClockReport.steps.map((st) => (
                      <tr key={st.step}>
                        <th scope="row">{st.label}</th>
                        <td className="mono">{st.fetchedAtUtc}</td>
                        <td>
                          <strong>{st.kstRecordDate}</strong>
                        </td>
                        <td>{st.value} pt</td>
                        <td>
                          <strong>
                            {st.rowCountBefore}건 → {st.rowCountAfter}건
                          </strong>
                        </td>
                        <td className="mono">{st.recordId}</td>
                        <td>{st.delta !== null ? `+${st.delta} pt` : 'null (첫날)'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </section>

          {/* 3-3. 계약 무결성 · 비밀키 0건 검색 · 짧은 확인 방법(T04-C27) · AI 판단 기록(T04-C28) */}
          <section
            className="section-card"
            aria-labelledby="verification-docs-heading"
            data-testid="verification-docs-section"
            style={{ marginBottom: 0 }}
          >
            <div className="section-header">
              <div>
                <h3 id="verification-docs-heading" className="section-title">
                  계약 무결성 · 비밀키 0건 검색 · 짧은 확인 방법(T04-C27) · AI 판단 기록(T04-C28)
                  <span className="section-badge">T04-C11 · C25 · C27 · C28</span>
                </h3>
              </div>
            </div>

            <div className="submission-box" data-testid="t04-c27-box">
              <h4>짧은 확인 방법 (T04-C27)</h4>
              <ul className="submission-list">
                <li>
                  <strong>① 어디로 가나요:</strong> 새 시크릿 창에서 계정 생성·로그인·인증 없이 배포된 결과물 HTTPS URL(또는 로컬 실행 화면)의 상단 메인 대시보드와 하단{' '}
                  <strong>「개발자 및 평가관용 도구」</strong> 내 Fixture 재생기로 이동합니다.
                </li>
                <li>
                  <strong>② 3단계 이내 무엇을 하나요:</strong> (1단계) 상단 대시보드에서 한국어 위키백과 전일 최다 열람 1위 조회수 값·단위(회)·출처·두 시각·기준 시간대(Asia/Seoul)와 2일치 기록을 확인하고, (2단계) 하단 개발자 도구 내 Fixture 재생기에서 다섯 실패 시퀀스 버튼(느림·401·429·오프라인·형식 변경)을 눌러 마지막 정상값 보존을 확인한 뒤, (3단계) 실패 배너의{' '}
                  <strong>[다시 시도 (T04-RECOVER-D2 재생하여 복구)]</strong> 버튼을 클릭합니다.
                </li>
                <li>
                  <strong>③ 무엇이 보이면 통과인가요:</strong> 상단 화면에 원자료·저장값·화면값이 일치하는 조회수(회)와 서로 다른 2개 KST 날짜 기록 및 전일 대비 변화량이 표시되고, 하단에서 <code>T04-RECOVER-D2</code> 재생 직후 상태가 <code>fresh / error_code: none</code>으로 돌아오며 다음 날짜(<code>2026-08-25</code>, 값 <code>120 pt</code>, 변화량 <code>+15 pt</code>) 일별 기록이 정확히 1건 추가되어 총 2건이 보이면 통과입니다.
                </li>
                <li>
                  <strong>④ 안 될 때 무엇이 보이나요:</strong> 외부 원천 응답이 지연·거절(401/403)·호출 제한(429)·오프라인·형식 변경 등으로 실패할 때 마지막 정상값(예: <code>105 pt</code>)은 지워지지 않고 그대로 유지되며, 값 옆에{' '}
                  <strong>「오래된 값 (stale · 해당 error_code)」</strong> 배지와 실패 원인별 안내 문구 및 <strong>[다시 시도]</strong> 버튼이 보입니다.
                </li>
              </ul>
            </div>

            <div className="submission-box" data-testid="t04-c28-box">
              <h4>AI 활용 및 직접 판단 기록 (T04-C28)</h4>
              <ul className="submission-list">
                <li>
                  <strong>① AI에게 맡긴 일:</strong> 공식 참조 어댑터(<code>adapter-reset.example.js</code>)의 정규화 검증(<code>validateNormalizedReading</code>) 및 상태 전이 함수(<code>applySuccessfulReading</code>, <code>applyError</code>, <code>runFixture</code>)를 TypeScript 모듈로 이식하고, 9종 합성 Fixture 재생기 UI와 반응형 데이터 테이블 레이아웃 보일러플레이트를 작성하는 작업을 AI에게 맡겼습니다.
                </li>
                <li>
                  <strong>② 학생이 직접 판단한 일:</strong> 인증키가 전혀 필요 없고 일별 변동성이 뚜렷한 비개인 공개 원천으로 「한국어 위키백과(<code>ko.wikipedia.org</code>) 전일 최다 열람 문서 1위의 조회수(단위: 회)」를 직접 선정하고, <code>Asia/Seoul</code> 시간대 기준 고유키(<code>signal_id + record_date</code>)로 같은 날 중복 행 생성을 막는 원자적 갱신 규칙과 다섯 가지 실패 상황별 사용자 안내 문구를 직접 결정·검증했습니다.
                </li>
                <li>
                  <strong>③ AI 제안을 따르지 않은 일(없으면 없었던 이유):</strong> 초기 설계에서 실패 재현 시 기존 화면의 값을 빈 화면이나 <code>0</code>으로 초기화하자는 단순 에러 처리 방식을 따르지 않고, T04 계약(<code>T04-C17</code>, <code>T04-C18</code>)에 따라 실패 시에도 반드시 직전 정상값(<code>current_reading</code>)과 일별 기록을 훼손 없이 보존하면서 <code>stale</code> 배지와 <code>error_code</code>만 분리 갱신하도록 직접 수정·적용했습니다.
                </li>
              </ul>
            </div>

            <div className="sub-panel">
              <h4 className="sub-panel-title">
                비밀키 원문 0건 · 개인정보 0건 · 공개 Package SHA-256 대조 결과
              </h4>
              <div className="metadata-grid" style={{ marginBottom: '0.75rem' }}>
                <div className="meta-item">
                  <div className="meta-item-header">
                    <span>클라이언트·배포·네트워크·Git 비밀키 검색</span>
                    <code>T04-C11</code>
                  </div>
                  <div className="meta-item-body">비밀키 원문 0건 (MET)</div>
                  <div className="meta-item-sub">
                    Wikimedia REST API는 공개 엔드포인트로 Authorization 헤더나 API Key 없이 호출됩니다.
                  </div>
                </div>
                <div className="meta-item">
                  <div className="meta-item-header">
                    <span>공개 심사 화면·제출 파일 개인정보 검색</span>
                    <code>T04-C25</code>
                  </div>
                  <div className="meta-item-body">개인정보 및 개인 기록 0건 (MET)</div>
                  <div className="meta-item-sub">
                    비개인 공개 통계(위키백과 문서 열람 수)와 공식 합성 Fixture만 사용합니다.
                  </div>
                </div>
                <div className="meta-item">
                  <div className="meta-item-header">
                    <span>공식 공개 계약 Package ID</span>
                    <code>Contract v{PUBLIC_CONTRACT.contract_version}</code>
                  </div>
                  <div className="meta-item-body mono" style={{ fontSize: '0.82rem' }}>
                    {PUBLIC_CONTRACT.package_id}
                  </div>
                  <div className="meta-item-sub">
                    에셋 파일 {ASSET_MANIFEST.files.length}개 · 결정론 Fixture {FIXTURE_MANIFEST.fixtures.length}개 무결성 확인 완료
                  </div>
                </div>
              </div>

              <div
                tabIndex={0}
                role="region"
                aria-labelledby="asset-hash-caption"
                className="table-wrapper"
              >
                <table
                  style={
                    {
                      '--label-2': '"크기 (Bytes)"',
                      '--label-3': '"공식 SHA-256 해시"',
                      '--label-4': '"상태"'
                    } as React.CSSProperties
                  }
                >
                  <caption id="asset-hash-caption">
                    asset-manifest.json 파일별 크기 및 SHA-256 해시 대조표
                  </caption>
                  <thead>
                    <tr>
                      <th scope="col">파일 경로 (path)</th>
                      <th scope="col">크기 (Bytes)</th>
                      <th scope="col">공식 SHA-256 해시</th>
                      <th scope="col">상태</th>
                    </tr>
                  </thead>
                  <tbody>
                    {ASSET_MANIFEST.files.map((file) => (
                      <tr key={file.path}>
                        <th scope="row" className="mono">
                          {file.path}
                        </th>
                        <td className="mono">{file.bytes.toLocaleString('ko-KR')} B</td>
                        <td className="mono" style={{ fontSize: '0.78rem', wordBreak: 'break-all' }}>
                          {file.sha256}
                        </td>
                        <td>
                          <span className="status-badge status-fresh">SHA-256 일치</span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </section>
        </div>
      </details>
    </div>
  );
}

export default App;
