// The React hooks, as a separate entry point (`@rosicrucian/search/react`) so
// that the engine itself never depends on React: a Node generator script
// imports `@rosicrucian/search` and pulls in nothing it does not need.

export { useSearchIndex, type SearchIndexState } from './use-search-index.ts'
export { useSectionTexts } from './use-section-texts.ts'
export {
  locate,
  useMarkQuery,
  type MarkQueryOptions,
} from './use-mark-query.ts'
