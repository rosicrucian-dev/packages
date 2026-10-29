// Marking the query's words in a piece of text: a result title, an excerpt.
//
// A hit is decided from the tokenizer's SPANS, never from a regex over the raw
// text, so folding, numbers and the prefix rule behave exactly as they do in
// the index: "cafe" marks "café", "color" marks "colors" only when it is the
// last word being typed, and nothing is marked that the index would not have
// matched.

import { tokenizerOf, type Query, type TokenSource } from './query.ts'
import type { Span } from './tokenizer.ts'

/** A run of text, flagged when it is one of the matched words. */
export interface Part {
  text: string
  hit: boolean
}

/** The spans of `spans` that the query matches. */
export function hitsIn(spans: Span[], query: Query): Span[] {
  const terms = new Set(query.terms)
  const last = query.prefixLast ? query.terms[query.terms.length - 1] : null
  return spans.filter(
    (s) => terms.has(s.token) || (last !== null && s.token.startsWith(last)),
  )
}

/** Character ranges where the query's words occur in order, as a run: for the
 *  whole query (two or more words), the span of the first word through the span
 *  of the last. Intervening stopwords were never tokens, so "tree of life"
 *  marks the whole phrase, "of" included. */
export function phraseRuns(
  spans: Span[],
  query: Query,
): Array<[number, number]> {
  const n = query.terms.length
  if (n < 2) return []
  const last = query.prefixLast ? query.terms[n - 1] : null
  const matches = (token: string, i: number) =>
    token === query.terms[i] ||
    (i === n - 1 && last !== null && token.startsWith(last))
  const out: Array<[number, number]> = []
  for (let i = 0; i + n <= spans.length; i++) {
    let ok = true
    for (let k = 0; k < n && ok; k++) ok = matches(spans[i + k].token, k)
    if (ok) {
      out.push([spans[i].start, spans[i + n - 1].end])
      i += n - 1
    }
  }
  return out
}

export interface HighlightOptions {
  /** Clip to about this many characters around the first hit. Omit to mark the
   *  whole text (a title, a heading). */
  window?: number
  /** With `window`: how far before the first hit the excerpt starts. */
  leadIn?: number
  ellipsis?: string
}

/**
 * `text` split into runs with the matched words flagged. Without `window` the
 * whole text is returned (what a result title needs); with it, a readable
 * excerpt around the first hit, falling back to the opening of the text when
 * nothing in it matches.
 */
export function highlight(
  source: TokenSource,
  text: string,
  query: Query,
  options: HighlightOptions = {},
): Part[] {
  const hits = hitsIn(tokenizerOf(source).spans(text), query)
  const { window, leadIn = 60, ellipsis = '…' } = options

  let start = 0
  let end = text.length
  if (window !== undefined) {
    const from = hits.length ? Math.max(0, hits[0].start - leadIn) : 0
    start = from
    if (start > 0) {
      // Don't start mid-word.
      const space = text.indexOf(' ', start)
      start = space < 0 || space - start > 20 ? start : space + 1
    }
    end = Math.min(text.length, start + window)
  }

  const parts: Part[] = []
  let cursor = start
  for (const h of hits) {
    if (h.end <= start || h.start >= end) continue
    const from = Math.max(h.start, start)
    const to = Math.min(h.end, end)
    if (from > cursor)
      parts.push({ text: text.slice(cursor, from), hit: false })
    parts.push({ text: text.slice(from, to), hit: true })
    cursor = to
  }
  if (cursor < end) parts.push({ text: text.slice(cursor, end), hit: false })
  if (parts.length === 0) parts.push({ text: '', hit: false })

  if (start > 0) parts[0] = { ...parts[0], text: ellipsis + parts[0].text }
  if (end < text.length) {
    const tail = parts[parts.length - 1]
    parts[parts.length - 1] = { ...tail, text: tail.text + ellipsis }
  }
  return parts
}
