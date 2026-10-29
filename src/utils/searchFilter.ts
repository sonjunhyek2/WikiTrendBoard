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
  if (articles === null || articles === undefined) {
    return [];
  }

  const trimmed = query.trim();
  const normalizedQuery = trimmed.toLocaleLowerCase();

  return articles.filter((item) => {
    const matchesQuery =
      normalizedQuery === '' ||
      item.article.toLocaleLowerCase().includes(normalizedQuery);

    const matchesMinViews =
      options?.minViews === undefined || item.views >= options.minViews;

    return matchesQuery && matchesMinViews;
  });
}
