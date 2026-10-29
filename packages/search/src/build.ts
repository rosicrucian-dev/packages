// Build an index (and the section texts beside it) from documents.
//
// Pure: no filesystem, no Node-only imports, so a generator script can call it
// under `node --experimental-strip-types` and a test can call it on three short
// strings. The caller writes the two outputs wherever its site serves them.

import {
  encodeRun,
  FORMAT,
  type IndexDoc,
  type Postings,
  type SearchDocument,
  type SearchIndex,
  type Stream,
} from './format.ts'
import { resolveTokenizer, type TokenizerConfig } from './tokenizer.ts'

export interface BuildOptions {
  tokenizer: TokenizerConfig
  /** Weight of a title hit relative to a body hit. Default 3: enough that a
   *  document NAMED for the query comes first, not so much that titles swamp
   *  genuinely relevant passages. */
  titleBoost?: number
}

export interface BuildResult<Meta> {
  index: SearchIndex<Meta>
  /** Each document's section texts (whitespace-normalized), by id, parallel to
   *  its `sections` table — the small per-document files a dialog fetches to
   *  show excerpts. Kept OUT of the index on purpose: they are the whole corpus,
   *  and every reader downloads the index merely to type. */
  sections: Record<string, string[]>
}

export function buildIndex<Meta>(
  docs: SearchDocument<Meta>[],
  options: BuildOptions,
): BuildResult<Meta> {
  const tokenizer = resolveTokenizer(options.tokenizer)
  const titleBoost = options.titleBoost ?? 3

  // term → flat runs, appended in doc order (which keeps each term's runs
  // sorted by doc without a later sort).
  const runs: Record<Stream, Map<string, number[]>> = {
    title: new Map(),
    body: new Map(),
  }
  const indexDocs: IndexDoc<Meta>[] = []
  const sectionTexts: Record<string, string[]> = {}
  const seen = new Set<string>()
  const hashes: string[] = []

  const addStream = (
    stream: Stream,
    docIdx: number,
    tokens: Array<[token: string, position: number]>,
  ) => {
    const positions = new Map<string, number[]>()
    for (const [t, pos] of tokens) {
      const arr = positions.get(t)
      if (arr) arr.push(pos)
      else positions.set(t, [pos])
    }
    for (const [term, pos] of positions) {
      const run = encodeRun(docIdx, pos)
      const target = runs[stream].get(term)
      if (!target) runs[stream].set(term, run)
      else for (const n of run) target.push(n)
    }
  }

  docs.forEach((doc, docIdx) => {
    if (seen.has(doc.id)) {
      throw new Error(
        `buildIndex: duplicate document id ${JSON.stringify(doc.id)}`,
      )
    }
    seen.add(doc.id)

    // A document with no sections still has a body stream (empty) and one
    // section, so nothing downstream needs a special case.
    const sections = doc.sections.length ? doc.sections : [{ text: '' }]

    const titleTokens = tokenizer.tokenize(doc.title)
    const body: Array<[string, number]> = []
    const start: number[] = []
    const anchor: (string | null)[] = []
    const texts: string[] = []
    // Body positions leave a one-position GAP between sections, so the last
    // word of one paragraph and the first of the next are never consecutive: a
    // phrase cannot straddle a section. `start` is in the same gapped space.
    let position = 0
    sections.forEach((section, i) => {
      if (i > 0) position++
      start.push(position)
      anchor.push(section.anchor ?? null)
      for (const token of tokenizer.tokenize(section.text)) {
        body.push([token, position++])
      }
      const text = section.text.replace(/\s+/g, ' ').trim()
      texts.push(text)
      hashes.push(hash(text))
    })

    addStream(
      'title',
      docIdx,
      titleTokens.map((t, i) => [t, i]),
    )
    addStream('body', docIdx, body)
    sectionTexts[doc.id] = texts
    indexDocs.push({
      id: doc.id,
      title: doc.title,
      ...(doc.meta === undefined ? {} : { meta: doc.meta }),
      len: { title: titleTokens.length, body: body.length },
      sections: { start, anchor },
    })
  })

  const terms = [...new Set([...runs.title.keys(), ...runs.body.keys()])].sort()
  const postings: Postings = {
    title: terms.map((t) => runs.title.get(t) ?? []),
    body: terms.map((t) => runs.body.get(t) ?? []),
  }

  return {
    index: {
      format: FORMAT,
      tokenizer: tokenizer.config,
      titleBoost,
      stamp: hash(hashes.join(',')),
      terms,
      postings,
      docs: indexDocs,
    },
    sections: sectionTexts,
  }
}

// A 53-bit string hash (cyrb53), as hex. The stamp only has to CHANGE when the
// text changes so a cached file is retired; it is not a security boundary, and
// a dependency-free hash keeps this module importable from a browser bundle.
function hash(str: string): string {
  let h1 = 0xdeadbeef
  let h2 = 0x41c6ce57
  for (let i = 0; i < str.length; i++) {
    const ch = str.charCodeAt(i)
    h1 = Math.imul(h1 ^ ch, 2654435761)
    h2 = Math.imul(h2 ^ ch, 1597334677)
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507)
  h1 ^= Math.imul(h2 ^ (h2 >>> 13), 3266489909)
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507)
  h2 ^= Math.imul(h1 ^ (h1 >>> 13), 3266489909)
  const n = 4294967296 * (2097151 & h2) + (h1 >>> 0)
  return n.toString(16).padStart(14, '0')
}
