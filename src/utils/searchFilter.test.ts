import { describe, it, expect } from 'vitest';
import { filterArticles, ArticleItem } from './searchFilter';

describe('searchFilter - 키워드 실시간 검색 및 필터링 기능 (10대 고정 검사)', () => {
  const mockArticles: ArticleItem[] = [
    { article: '문화방송', views: 52430, rank: 1 },
    { article: '대한민국', views: 24310, rank: 2 },
    { article: '한글', views: 19850, rank: 3 },
    { article: 'Wikipedia:Sandbox', views: 15300, rank: 4 },
    { article: '위키백과:대문', views: 12000, rank: 5 },
    { article: 'wiki_test', views: 8500, rank: 6 },
    { article: '(*.?)_문서', views: 3200, rank: 7 }
  ];

  // -------------------------------------------------------------
  // [초기 통과 대상: TC-01, TC-02, TC-03]
  // -------------------------------------------------------------
  it('TC-01: 빈 문자열 검색 시 전체 목록 반환', () => {
    const result = filterArticles(mockArticles, '');
    expect(result).toEqual(mockArticles);
    expect(result).toHaveLength(7);
  });

  it('TC-02: 공백 문자열 검색 시 앞뒤 공백 제거 후 전체 반환', () => {
    const result = filterArticles(mockArticles, '   ');
    expect(result).toEqual(mockArticles);
    expect(result).toHaveLength(7);
  });

  it('TC-03: 정확한 제목 일치 검색 ("문화방송")', () => {
    const result = filterArticles(mockArticles, '문화방송');
    expect(result).toEqual([{ article: '문화방송', views: 52430, rank: 1 }]);
  });

  // -------------------------------------------------------------
  // [미완성 대상: TC-04 ~ TC-10 (현재 의도적으로 실패해야 함)]
  // -------------------------------------------------------------
  it('TC-04: 부분 일치 검색 ("문화")', () => {
    const result = filterArticles(mockArticles, '문화');
    expect(result).toEqual([{ article: '문화방송', views: 52430, rank: 1 }]);
  });

  it('TC-05: 영문 대소문자 무시 검색 ("wiki")', () => {
    const result = filterArticles(mockArticles, 'wiki');
    expect(result).toEqual([
      { article: 'Wikipedia:Sandbox', views: 15300, rank: 4 },
      { article: 'wiki_test', views: 8500, rank: 6 }
    ]);
  });

  it('TC-06: 일치 결과 없을 때 빈 배열 반환 ("xyz없는문서")', () => {
    const result = filterArticles(mockArticles, 'xyz없는문서');
    expect(result).toEqual([]);
  });

  it('TC-07: 특수문자 포함 검색 ("위키백과:대문")', () => {
    const result = filterArticles(mockArticles, '위키백과:대문');
    expect(result).toEqual([{ article: '위키백과:대문', views: 12000, rank: 5 }]);
  });

  it('TC-08: 정규식 메타문자 입력 시 안전 처리 ("(*.?)")', () => {
    const result = filterArticles(mockArticles, '(*.?)');
    expect(result).toEqual([{ article: '(*.?)_문서', views: 3200, rank: 7 }]);
  });

  it('TC-09: 최소 조회수 필터링 (minViews: 10000)', () => {
    const result = filterArticles(mockArticles, '', { minViews: 10000 });
    expect(result).toEqual([
      { article: '문화방송', views: 52430, rank: 1 },
      { article: '대한민국', views: 24310, rank: 2 },
      { article: '한글', views: 19850, rank: 3 },
      { article: 'Wikipedia:Sandbox', views: 15300, rank: 4 },
      { article: '위키백과:대문', views: 12000, rank: 5 }
    ]);
  });

  it('TC-10: null/undefined 목록 입력 시 안전하게 빈 배열 반환', () => {
    expect(filterArticles(null, '문화')).toEqual([]);
    expect(filterArticles(undefined, '문화')).toEqual([]);
  });
});

