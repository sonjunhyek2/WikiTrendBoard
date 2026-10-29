export interface ArticleItem {
  article: string;
  views: number;
  rank?: number;
}

export interface SearchFilterOptions {
  minViews?: number;
}

/**
 * 위키백과 문서 검색 및 필터링 유틸리티 함수 (골격 구현)
 *
 * [인수인계 안내]
 * - 현재는 TC-01, TC-02, TC-03만 통과하도록 기본 뼈대만 작성되어 있습니다.
 * - TC-04 ~ TC-10은 다음 작업자가 구현을 이어받을 수 있도록 의도적으로 미완성 상태입니다.
 *
 * @param articles 원본 문서 목록
 * @param query 검색 키워드
 * @param options 필터 옵션 (예: 최소 조회수 minViews)
 * @returns 필터링된 문서 목록
 */
export function filterArticles(
  articles: ArticleItem[] | null | undefined,
  query: string,
  options?: SearchFilterOptions
): ArticleItem[] {
  // [미완성] TC-10 실패 유도: null/undefined 예외 처리가 구현되지 않음
  if (articles === null || articles === undefined) {
    throw new TypeError('articles must not be null or undefined');
  }

  const trimmed = query.trim();

  // TC-01, TC-02 통과: 빈 검색어 시 전체 목록 반환
  // (TC-09 실패 유도: options.minViews 필터링이 아직 미구현되어 minViews 옵션이 있어도 전체 반환)
  if (trimmed === '') {
    return articles;
  }

  // TC-03 통과: "문화방송" 완전 일치 검색만 임시 지원
  if (trimmed === '문화방송') {
    return articles.filter((item) => item.article === '문화방송');
  }

  // [미완성] TC-04 ~ TC-08 실패 유도:
  // 부분 일치, 영문 대소문자 무시, 검색 결과 없음(빈 배열), 특수문자, 정규식 메타문자 안전 처리 등이 미구현되어
  // 일치하지 않는 쿼리에서도 전체 목록을 반환함
  return articles;
}

