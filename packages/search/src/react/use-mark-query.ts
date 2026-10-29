// Mark the searched words on the page a search result opened.
//
// The query travels in a URL parameter (`?q=` by default) — the query string,
// not the fragment, so it can sit alongside a `#p12` deep link rather than
// competing with it. The arrived-at page has no index in hand, so the caller
// passes the tokenizer configuration its index was built with (in practice,
// `{ locale }` of the text ON THE PAGE — which is not always the locale in the
// URL, since an untranslated page serves the original).
//
// The marking is done on the live DOM after render by `markText`; `dep` re-runs
// it when the rendered content changes.

import { useEffect, type RefObject } from 'react'

import { locate, markText } from '../dom.ts'
import { parseQuery } from '../query.ts'
import { resolveTokenizer, type TokenizerConfig } from '../tokenizer.ts'

export { locate }

export interface MarkQueryOptions {
  /** How the index that produced the link was tokenized — `{ locale }` at least. */
  tokenizer: TokenizerConfig
  /** URL parameter carrying the query. Default 'q'. */
  param?: string
  /** Class for each mark element. */
  className?: string
  /**
   * 'auto' (default) scrolls the first mark into view UNLESS the URL has a
   * fragment — a `#p12` deep link means the browser has already put the reader
   * at the passage the result was about, which is chosen from the index and is
   * not always the page's first match. 'never' leaves scrolling to the caller.
   */
  scroll?: 'auto' | 'never'
  /** Re-run the marking pass when this changes (e.g. the page's slug). */
  dep?: unknown
  /** Called with the marks made, in document order, when there were any. */
  onMarked?: (marks: HTMLElement[]) => void
}

export function useMarkQuery(
  ref: RefObject<HTMLElement | null>,
  options: MarkQueryOptions,
): void {
  const { param = 'q', className, scroll = 'auto', dep, onMarked } = options
  // Keyed by value, not identity: callers pass the config as a literal, and a
  // fresh object every render would re-run the pass and nest marks in marks.
  const tokenizerKey = JSON.stringify(options.tokenizer)

  useEffect(() => {
    const container = ref.current
    if (!container) return
    const text = new URLSearchParams(window.location.search).get(param)?.trim()
    if (!text) return

    const tokenizer = resolveTokenizer(
      JSON.parse(tokenizerKey) as TokenizerConfig,
    )
    const query = parseQuery(tokenizer, text)
    const marks = markText(container, query, tokenizer, { className })
    if (marks.length === 0) return
    if (scroll === 'auto' && !window.location.hash) {
      marks[0].scrollIntoView({ block: 'center' })
    }
    onMarked?.(marks)
    // `onMarked` is a callback prop; re-running on its identity would re-mark.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ref, dep, tokenizerKey, param, className, scroll])
}
