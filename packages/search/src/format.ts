// The index format: what the browser downloads to search.
//
// A document is a TITLE and an ordered list of SECTIONS, each optionally
// carrying an ANCHOR. The index keeps two positional token streams per
// document — the title and the body (every section's text, in order) — so a
// phrase can be found, a title hit can be boosted, and a body position can be
// turned back into the section (and anchor) it falls in.
//
// `format` is the version of THIS SHAPE. Anything that changes how a stored
// index must be read bumps it, and `loadIndex` refuses what it does not know,
// so a reader holding last deploy's index gets a clear error instead of
// garbage results.

import type { ResolvedTokenizerConfig } from './tokenizer.ts'

export const FORMAT = 1 as const

/** What a caller gives `buildIndex`. */
export interface SearchDocument<Meta = unknown> {
  /** Stable identity, unique within the index. */
  id: string
  title: string
  /** The body, divided wherever the reader can be sent: paragraphs, timed
   *  transcript blocks, pages. `anchor` is what a deep link needs (`p12`);
   *  omit it where the section's INDEX is already the join (as a transcript's
   *  paragraph number is). */
  sections: Array<{ text: string; anchor?: string }>
  /** Anything the site needs back on a result (a URL, a subtitle); carried
   *  through untouched and never searched. */
  meta?: Meta
}

export type Stream = 'title' | 'body'

/** Where each section of a document begins in its body token stream, with the
 *  section's anchor (null where it has none). Parallel arrays, ascending.
 *  Body positions skip one between sections, so a phrase can never run from the
 *  end of one section into the start of the next. */
export interface SectionTable {
  start: number[]
  anchor: (string | null)[]
}

export interface IndexDoc<Meta = unknown> {
  id: string
  title: string
  meta?: Meta
  /** Token count of each stream, for BM25's length normalization. */
  len: Record<Stream, number>
  sections: SectionTable
}

/** For each stream, one postings array per term (aligned with `terms`), each a
 *  flat sequence of runs `[doc, count, p0, Δ1, Δ2, …]` — the doc index, how many
 *  positions follow, the first position, then the gaps. Empty where the term
 *  never occurs in that stream. */
export type Postings = Record<Stream, number[][]>

export interface SearchIndex<Meta = unknown> {
  format: typeof FORMAT
  /** Exactly how the text was tokenized; the query side uses this and nothing
   *  else, so the two can never disagree. */
  tokenizer: ResolvedTokenizerConfig
  /** Weight of a title hit relative to a body hit. */
  titleBoost: number
  /** Content stamp of every section text in the index. Sites put it on the
   *  URLs of the section-text files so a deploy invalidates cached copies. */
  stamp: string
  /** The vocabulary, sorted, so a prefix is a binary-searched range. */
  terms: string[]
  postings: Postings
  docs: IndexDoc<Meta>[]
}

// ---- codec ----------------------------------------------------------------

/** One run: the doc, how many positions, the first, then the gaps. Positions
 *  must be ascending. */
export function encodeRun(doc: number, positions: number[]): number[] {
  const run = [doc, positions.length]
  let prev = 0
  for (let i = 0; i < positions.length; i++) {
    run.push(i === 0 ? positions[0] : positions[i] - prev)
    prev = positions[i]
  }
  return run
}

/** All runs of one term in one stream → doc index → its ascending positions. */
export function decodeRuns(runs: number[]): Map<number, number[]> {
  const out = new Map<number, number[]>()
  for (let i = 0; i < runs.length;) {
    const doc = runs[i]
    const count = runs[i + 1]
    const positions = new Array<number>(count)
    let at = 0
    for (let k = 0; k < count; k++) {
      at += runs[i + 2 + k]
      positions[k] = at
    }
    out.set(doc, positions)
    i += 2 + count
  }
  return out
}

/** Index of the section a body position falls in: the last section whose start
 *  is at or before it. -1 only for an empty table. */
export function sectionAt(sections: SectionTable, position: number): number {
  const { start } = sections
  let lo = 0
  let hi = start.length - 1
  let found = -1
  while (lo <= hi) {
    const mid = (lo + hi) >> 1
    if (start[mid] <= position) {
      found = mid
      lo = mid + 1
    } else {
      hi = mid - 1
    }
  }
  return found
}
