// Querying an index: parse, rank, and say where each hit is.
//
// Ranking: documents containing a contiguous PHRASE (the quoted groups if the
// query has any, else the whole query) form the top tier; within a tier,
// documents are ordered by a BM25 relevance score over the title and body
// streams, with the title weighted by the index's `titleBoost` and each
// occurrence of the phrase itself credited like a rare word. Having the
// phrase is a tier, not a sort key: a document that repeats the phrase twenty
// times does not automatically outrank the one NAMED for it, because the title
// boost gets its say within the tier (ordering by phrase count was tried, and
// buried the titled document under long ones that merely repeat the words).
// Every query word must
// appear (AND), and the final word also matches by prefix while it is still
// being typed. A `"quoted group"` is a hard filter — a document that has the
// words but never together is dropped, not demoted — and pins the spelling (no
// prefix expansion).

import {
  decodeRuns,
  FORMAT,
  sectionAt,
  type SearchIndex,
  type Stream,
} from './format.ts'
import { resolveTokenizer, type Tokenizer } from './tokenizer.ts'

// ---- loading -----------------------------------------------------------------

export class IndexFormatError extends Error {
  readonly code = 'format' as const
  constructor(message: string) {
    super(message)
    this.name = 'IndexFormatError'
  }
}

/**
 * Check that parsed JSON is an index this code can read. Throws
 * `IndexFormatError` for anything else — including an index from before this
 * format existed — so a dialog can tell "reload the page" from "network down".
 */
export function loadIndex<Meta = unknown>(json: unknown): SearchIndex<Meta> {
  const o = json as Partial<SearchIndex<Meta>> | null
  if (!o || typeof o !== 'object') {
    throw new IndexFormatError('search index: not an object')
  }
  if (o.format !== FORMAT) {
    throw new IndexFormatError(
      `search index: format ${JSON.stringify(o.format)} — this code reads format ${FORMAT}`,
    )
  }
  if (
    !o.tokenizer ||
    typeof o.tokenizer !== 'object' ||
    !Array.isArray(o.terms) ||
    !o.postings ||
    !Array.isArray(o.postings.title) ||
    !Array.isArray(o.postings.body) ||
    !Array.isArray(o.docs) ||
    typeof o.stamp !== 'string'
  ) {
    throw new IndexFormatError('search index: malformed')
  }
  return o as SearchIndex<Meta>
}

// Per-index working state, built on first use and kept for the life of the
// index object: the resolved tokenizer, a term → position map, decoded postings
// (so repeated keystrokes don't re-parse the same runs) and average stream
// lengths for BM25.
interface Prepared {
  tokenizer: Tokenizer
  termIndex: Map<string, number>
  decoded: Record<Stream, Map<number, Map<number, number[]>>>
  avgLen: Record<Stream, number>
}

const PREPARED = new WeakMap<object, Prepared>()

function prepare(index: SearchIndex): Prepared {
  let p = PREPARED.get(index)
  if (p) return p
  const n = index.docs.length || 1
  const avg = (s: Stream) =>
    index.docs.reduce((a, d) => a + d.len[s], 0) / n || 1
  p = {
    tokenizer: resolveTokenizer(index.tokenizer),
    termIndex: new Map(index.terms.map((t, i) => [t, i])),
    decoded: { title: new Map(), body: new Map() },
    avgLen: { title: avg('title'), body: avg('body') },
  }
  PREPARED.set(index, p)
  return p
}

function postings(
  prep: Prepared,
  index: SearchIndex,
  stream: Stream,
  termIdx: number,
): Map<number, number[]> {
  const cache = prep.decoded[stream]
  let m = cache.get(termIdx)
  if (!m) {
    m = decodeRuns(index.postings[stream][termIdx])
    cache.set(termIdx, m)
  }
  return m
}

/** Either an index (whose header says how it was tokenized) or a tokenizer
 *  resolved from the same configuration — for a page that has no index in hand
 *  but must mark the words a result was clicked for. */
export type TokenSource = SearchIndex | Tokenizer

export function tokenizerOf(source: TokenSource): Tokenizer {
  return 'spans' in source ? source : prepare(source).tokenizer
}

// ---- the query -----------------------------------------------------------------

/** One run of query words: a `"quoted"` group, or the loose words around it. */
export interface QuerySegment {
  terms: string[]
  quoted: boolean
}

export interface Query {
  /** The text as typed. */
  text: string
  segments: QuerySegment[]
  /** Every term, in order. */
  terms: string[]
  /** Quoted groups of two or more words, as [start, end) into `terms`. A
   *  one-word quote pins the spelling but constrains no order. */
  phrases: Array<[number, number]>
  /** Whether the last term also matches by prefix: it is loose (not quoted)
   *  and long enough to be worth expanding. */
  prefixLast: boolean
}

// Expanding a one- or two-letter prefix would match a large slice of the
// vocabulary for no gain in precision.
const PREFIX_MIN = 3

// Straight and curly double quotes both count. Apostrophes are NOT delimiters:
// "Case's" and "don't" are words.
const QUOTED = /["“”]([^"“”]*)["“”]/g

/**
 * Split a query into quoted groups and the loose words around them:
 *   tarot "tree of life"  →  [{tarot, loose}, {tree life, quoted}]
 *
 * An UNTERMINATED trailing quote stays loose on purpose: the phrase filter must
 * not kick in halfway through typing it, or results would vanish until the
 * closing quote lands. They snap to phrase-only the moment the quote closes.
 */
export function parseQuery(source: TokenSource, text: string): Query {
  const { tokenize } = tokenizerOf(source)
  const segments: QuerySegment[] = []
  const push = (part: string, quoted: boolean) => {
    const terms = tokenize(part)
    if (terms.length) segments.push({ terms, quoted })
  }
  let last = 0
  QUOTED.lastIndex = 0
  for (let m = QUOTED.exec(text); m; m = QUOTED.exec(text)) {
    push(text.slice(last, m.index), false)
    push(m[1], true)
    last = QUOTED.lastIndex
  }
  push(text.slice(last), false)

  const terms = segments.flatMap((s) => s.terms)
  const phrases: Array<[number, number]> = []
  let at = 0
  for (const seg of segments) {
    if (seg.quoted && seg.terms.length > 1)
      phrases.push([at, at + seg.terms.length])
    at += seg.terms.length
  }
  const tail = segments[segments.length - 1]
  const prefixLast =
    !!tail && !tail.quoted && terms[terms.length - 1].length >= PREFIX_MIN
  return { text, segments, terms, phrases, prefixLast }
}

function asQuery(index: SearchIndex, query: Query | string): Query {
  return typeof query === 'string' ? parseQuery(index, query) : query
}

// ---- postings per query term ------------------------------------------------------

/** [lo, hi) into the sorted terms: every term starting with `prefix`. */
export function prefixRange(terms: string[], prefix: string): [number, number] {
  const lowerBound = (target: string) => {
    let lo = 0
    let hi = terms.length
    while (lo < hi) {
      const mid = (lo + hi) >> 1
      if (terms[mid] < target) lo = mid + 1
      else hi = mid
    }
    return lo
  }
  // '￿' is the largest UTF-16 code unit, so prefix + '￿' sorts after
  // every string that starts with prefix.
  return [lowerBound(prefix), lowerBound(prefix + '￿')]
}

/** For one query term: doc → ascending positions, per stream — with the prefix
 *  expansion merged in when this is the last loose term. */
type TermHits = Record<Stream, Map<number, number[]>>

function hitsFor(index: SearchIndex, query: Query): TermHits[] {
  const prep = prepare(index)
  const streams: Stream[] = ['title', 'body']
  return query.terms.map((term, i) => {
    const hits: TermHits = { title: new Map(), body: new Map() }
    const exact = prep.termIndex.get(term)
    const expand = query.prefixLast && i === query.terms.length - 1
    const range = expand ? prefixRange(index.terms, term) : null
    for (const stream of streams) {
      const target = hits[stream]
      if (exact !== undefined) {
        for (const [d, pos] of postings(prep, index, stream, exact)) {
          target.set(d, pos)
        }
      }
      if (!range) continue
      // The expanded words contribute their POSITIONS as well as their count,
      // so a phrase is found while its final word is still being typed. Merged
      // runs are re-sorted because phrase scanning and `best` both read the
      // first hit in document order.
      const merged = new Set<number>()
      for (let t = range[0]; t < range[1]; t++) {
        if (t === exact) continue
        for (const [d, pos] of postings(prep, index, stream, t)) {
          const have = target.get(d)
          if (have) {
            // Never mutate `have`: it may be the cached decoded array.
            target.set(d, [...have, ...pos])
            merged.add(d)
          } else target.set(d, pos)
        }
      }
      for (const d of merged) {
        target.set(
          d,
          target.get(d)!.sort((a, b) => a - b),
        )
      }
    }
    return hits
  })
}

// ---- phrases -----------------------------------------------------------------------

/** How many times the tokens occur at consecutive positions — token[0] at p,
 *  token[1] at p+1, … A single token counts every hit. */
function countPhrases(perToken: number[][]): number {
  if (perToken.length === 0) return 0
  if (perToken.length === 1) return perToken[0].length
  if (perToken.some((p) => p.length === 0)) return 0
  const later = perToken.slice(1).map((p) => new Set(p))
  let n = 0
  for (const p of perToken[0]) {
    if (later.every((set, k) => set.has(p + k + 1))) n++
  }
  return n
}

/** Position of the FIRST contiguous occurrence, or -1. */
function firstPhraseAt(perToken: number[][]): number {
  if (perToken.length === 0) return -1
  if (perToken.length === 1) return perToken[0][0] ?? -1
  if (perToken.some((p) => p.length === 0)) return -1
  const later = perToken.slice(1).map((p) => new Set(p))
  for (const p of perToken[0]) {
    if (later.every((set, k) => set.has(p + k + 1))) return p
  }
  return -1
}

// ---- results -------------------------------------------------------------------------

/** One place a query matched. */
export interface Match {
  where: Stream
  /** Token offset in that stream. */
  position: number
  /** Body only: the section the position falls in … */
  section?: number
  /** … and its anchor, when that section has one. */
  anchor?: string
}

export interface SearchResult<Meta = unknown> {
  /** Position of the document in `index.docs`. */
  docIndex: number
  id: string
  title: string
  meta?: Meta
  /** BM25 over both streams, title boosted. Higher is better. */
  score: number
  /** Occurrences of all the query's words, title and body together. */
  count: number
  /** Contiguous-phrase occurrences: of the quoted groups if the query has any
   *  (always > 0 — non-matches are dropped), else of the whole query (0 =
   *  scattered match; equals `count` for a single word). Documents with any
   *  rank above documents with none; the number itself is for display. */
  phrase: number
  /** Where to send a reader: the first phrase hit in the body, else in the
   *  title, else the first occurrence of the rarest query word — the one that
   *  makes the passage distinctive rather than the one that appears everywhere. */
  best: Match
}

// BM25 parameters. k1 is term-frequency saturation (higher = more credit for
// repeated mentions before it flattens); b is length normalization (1 = fully
// penalize long documents, 0 = ignore length). The textbook 1.2 / 0.75 was
// measured on both corpora and over-rewarded short documents: with lessons
// beside one-page tableaus and 28-minute lectures beside 3-minute tracks, a
// talk mentioning the word six times outranked one named for it with
// twenty-eight. 2.0 / 0.3 keeps a gentle length correction while letting the
// count of mentions, which the dialog also shows, carry its weight.
const BM25_K1 = 2.0
const BM25_B = 0.3

function matchAt(
  index: SearchIndex,
  docIdx: number,
  where: Stream,
  position: number,
): Match {
  if (where === 'title') return { where, position }
  const { sections } = index.docs[docIdx]
  const section = sectionAt(sections, position)
  const anchor = section >= 0 ? sections.anchor[section] : null
  return {
    where,
    position,
    ...(section >= 0 ? { section } : {}),
    ...(anchor ? { anchor } : {}),
  }
}

export function search<Meta>(
  index: SearchIndex<Meta>,
  query: Query | string,
  options: { limit?: number } = {},
): SearchResult<Meta>[] {
  const q = asQuery(index, query)
  if (q.terms.length === 0) return []
  const prep = prepare(index)
  const hits = hitsFor(index, q)
  const streams: Stream[] = ['body', 'title']
  const boost: Record<Stream, number> = { body: 1, title: index.titleBoost }

  // Inverse document frequency per term: how many docs have it in EITHER stream.
  const N = index.docs.length || 1
  const idf = hits.map((h) => {
    const docs = new Set([...h.title.keys(), ...h.body.keys()])
    const df = docs.size
    return Math.log(1 + (N - df + 0.5) / (df + 0.5))
  })

  // Candidates: docs having every term in title or body.
  const first = new Set([...hits[0].title.keys(), ...hits[0].body.keys()])
  const results: SearchResult<Meta>[] = []
  for (const d of first) {
    let inAll = true
    for (let i = 1; i < hits.length && inAll; i++) {
      inAll = hits[i].title.has(d) || hits[i].body.has(d)
    }
    if (!inAll) continue

    const perToken = (stream: Stream, span: [number, number]) =>
      hits.slice(span[0], span[1]).map((h) => h[stream].get(d) ?? [])

    let count = 0
    for (const h of hits) {
      count += (h.title.get(d)?.length ?? 0) + (h.body.get(d)?.length ?? 0)
    }

    // Every quoted group must occur contiguously somewhere (title or body), or
    // the doc is not a match at all.
    let phrase = 0
    if (q.phrases.length) {
      let all = true
      for (const span of q.phrases) {
        let n = 0
        for (const s of streams) n += countPhrases(perToken(s, span))
        if (n === 0) {
          all = false
          break
        }
        phrase += n
      }
      if (!all) continue
    } else {
      const whole: [number, number] = [0, q.terms.length]
      for (const s of streams) phrase += countPhrases(perToken(s, whole))
    }

    const doc = index.docs[d]
    let score = 0
    hits.forEach((h, i) => {
      for (const s of streams) {
        const tf = h[s].get(d)?.length ?? 0
        if (!tf) continue
        const norm = 1 - BM25_B + (BM25_B * doc.len[s]) / prep.avgLen[s]
        score +=
          idf[i] * boost[s] * ((tf * (BM25_K1 + 1)) / (tf + BM25_K1 * norm))
      }
    })
    // The phrase itself is evidence beyond its words: a document that says
    // "tree of life" six times is about it in a way one that says "tree" and
    // "life" apart thirty times and together once is not. Credit each
    // contiguous occurrence like a term of the rarest word's weight, with the
    // same saturation. Single-word queries skip this — their phrase IS the word.
    if (q.terms.length > 1 && phrase > 0) {
      score +=
        Math.max(...idf) * ((phrase * (BM25_K1 + 1)) / (phrase + BM25_K1))
    }

    // The first phrase hit — of the first quoted group if any, else the whole
    // query — body before title; failing that, the rarest term's first
    // occurrence, body before title.
    const span = q.phrases[0] ?? [0, q.terms.length]
    let best: Match | null = null
    for (const s of streams) {
      const at = firstPhraseAt(perToken(s, span))
      if (at >= 0) {
        best = matchAt(index, d, s, at)
        break
      }
    }
    if (!best) {
      let rarest = -1
      let where: Stream = 'body'
      let position = 0
      for (const s of streams) {
        hits.forEach((h, i) => {
          const pos = h[s].get(d)
          if (pos?.length && idf[i] > rarest) {
            rarest = idf[i]
            where = s
            position = pos[0]
          }
        })
        if (rarest >= 0) break
      }
      best = matchAt(index, d, where, position)
    }

    results.push({
      docIndex: d,
      id: doc.id,
      title: doc.title,
      ...(doc.meta === undefined ? {} : { meta: doc.meta }),
      score,
      count,
      phrase,
      best,
    })
  }

  results.sort(
    (a, b) => Number(b.phrase > 0) - Number(a.phrase > 0) || b.score - a.score,
  )
  return options.limit === undefined ? results : results.slice(0, options.limit)
}

/**
 * Every place the query's words occur in one result's document — body first
 * (with each hit's section and anchor), then title — ascending. For a dialog
 * that lists each matching passage rather than only the best one.
 */
export function occurrences<Meta>(
  index: SearchIndex<Meta>,
  query: Query | string,
  result: SearchResult<Meta>,
  options: { max?: number } = {},
): Match[] {
  const q = asQuery(index, query)
  if (q.terms.length === 0) return []
  const max = options.max ?? 200
  const hits = hitsFor(index, q)
  const out: Match[] = []
  for (const stream of ['body', 'title'] as Stream[]) {
    const positions = new Set<number>()
    for (const h of hits) {
      for (const p of h[stream].get(result.docIndex) ?? []) positions.add(p)
    }
    for (const p of [...positions].sort((a, b) => a - b)) {
      if (out.length >= max) return out
      out.push(matchAt(index, result.docIndex, stream, p))
    }
  }
  return out
}
