// The search engine — a positional full-text index for static sites.
//
// A document is a TITLE and an ordered list of SECTIONS, each optionally
// carrying an ANCHOR. At build time `buildIndex` turns documents into one INDEX
// (what the browser downloads to search) and one small list of section texts
// per document (fetched only to show excerpts). At runtime you `loadIndex`,
// `search`, and each RESULT names the document, how well it matched, and the
// best section and anchor to link to. Everything that marks words on screen
// uses the tokenizer the index was built with, so what you highlight is what
// matched.
//
//   build      buildIndex                        (./build)
//   format     FORMAT, SearchDocument, SearchIndex, …   (./format)
//   query      loadIndex, parseQuery, search, occurrences   (./query)
//   text       highlight                         (./text)
//   dom        markText, locate                  (./dom; browser only)
//   react      useSearchIndex, useSectionTexts, useMarkQuery   (./react/*)
//
// The React hooks are not re-exported here so that a Node generator script can
// import this module without pulling React in. Import them from
// `@rosicrucian/search/react`.

export { buildIndex, type BuildOptions, type BuildResult } from './build.ts'
export {
  FORMAT,
  decodeRuns,
  encodeRun,
  sectionAt,
  type IndexDoc,
  type Postings,
  type SearchDocument,
  type SearchIndex,
  type SectionTable,
  type Stream,
} from './format.ts'
export {
  IndexFormatError,
  loadIndex,
  occurrences,
  parseQuery,
  prefixRange,
  search,
  tokenizerOf,
  type Match,
  type Query,
  type QuerySegment,
  type SearchResult,
  type TokenSource,
} from './query.ts'
export {
  highlight,
  hitsIn,
  phraseRuns,
  type HighlightOptions,
  type Part,
} from './text.ts'
export {
  resolveTokenizer,
  type ResolvedTokenizerConfig,
  type Span,
  type Tokenizer,
  type TokenizerConfig,
} from './tokenizer.ts'
