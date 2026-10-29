# @rosicrucian/search

Full-text search for static sites. You build a small positional index at
build time, the browser downloads it and searches it with no server, and each
result tells you which document matched and which passage of it to link to.

```sh
npm install @rosicrucian/search
```

Zero dependencies. The React hooks are an optional second entry point.

## The model

> A **document** is a title and an ordered list of **sections**, each
> optionally carrying an anchor. At build time `buildIndex` turns documents into
> one **index** JSON (what the browser downloads to search) and one small JSON
> of section texts per document (fetched only to show excerpts). At runtime you
> `loadIndex`, `search`, and each **result** names the document, how well it
> matched, and the best section and anchor to link to. Everything that marks
> words on screen uses the tokenizer the index was built with, so what you
> highlight is what matched.

Four nouns: document, section, index, result. A section is whatever a reader
can be sent to: a paragraph with an `id`, a timed transcript block, a page.

## Build time

Run this in a script before your site builds. It is pure: no filesystem, no
Node-only imports. You decide where the two outputs go.

```ts
import { buildIndex, type SearchDocument } from '@rosicrucian/search'
import { writeFileSync } from 'node:fs'

type Meta = { href: string } // anything you want back on a result

const docs: SearchDocument<Meta>[] = lessons.map((lesson) => ({
  id: lesson.slug,
  title: lesson.title,
  meta: { href: `/lessons/${lesson.slug}/` },
  sections: lesson.paragraphs.map((p, i) => ({ text: p, anchor: `p${i + 1}` })),
}))

const { index, sections } = buildIndex(docs, { tokenizer: { locale: 'en' } })

writeFileSync('public/search-index.json', JSON.stringify(index))
for (const doc of docs) {
  writeFileSync(
    `public/search/${doc.id}.json`,
    JSON.stringify(sections[doc.id]),
  )
}
```

The index records exactly how it tokenized (locale, stopwords, folding), so
the query side can never disagree with it. It also carries a content `stamp`;
put it on the section-text URLs (`?v=${index.stamp}`) if you cache them hard,
so a deploy invalidates them.

## Run time

```ts
import { highlight, loadIndex, parseQuery, search } from '@rosicrucian/search'

const index = loadIndex<Meta>(await (await fetch('/search-index.json')).json())

const query = parseQuery(index, 'tree of life')
const results = search(index, query)

for (const r of results) {
  r.title // 'Lesson 12: The Tree of Life'
  r.meta // { href: '/lessons/tree-of-life/' }
  r.count // occurrences of the query's words
  r.phrase // occurrences of the words together
  r.best // { where: 'body', position: 41, section: 3, anchor: 'p4' }
  highlight(index, r.title, query) // [{ text: 'Lesson 12: The ', hit: false }, …]
}
```

Then link to `${r.meta.href}#${r.best.anchor}`, and show an excerpt from the
section the link lands on:

```ts
const texts: string[] = await (await fetch(`/search/${r.id}.json`)).json()
const excerpt = highlight(index, texts[r.best.section ?? 0], query, {
  window: 190,
})
```

`loadIndex` throws `IndexFormatError` for an index it cannot read. On a site
with a service worker, that means a stale cache served last deploy's index to
new code, and the right response is a reload, not a retry.

### How a query is read

- Every word must appear (AND). The final word also matches by prefix while it
  is being typed, once it is three characters long.
- `"quoted words"` must appear together, in order, and are not expanded.
- Numbers are words: `key 21` finds Key 21.
- Text is Unicode-folded: `cafe` finds `café`; Hebrew nikkud are ignored and
  final letters fold onto their base forms.
- Stopwords (`the`, `of`, `and`) are dropped, per locale (`en`, `de`). Pass
  `stopwords: 'none'` or your own list to change that.

### How results are ordered

Documents containing the whole query as a contiguous phrase form the top tier.
Within a tier, BM25 relevance over the title and body decides, with the title
weighted by `titleBoost` (default 3) and each phrase occurrence credited like a
rare word. Having the phrase is a tier, not a sort key: a document that repeats
the phrase twenty times does not outrank the one named for it.

## On the page a result opened

A result links to a passage, and the query string carries the words, so the
page can mark them:

```ts
import { markText, parseQuery, resolveTokenizer } from '@rosicrucian/search'

const tokenizer = resolveTokenizer({ locale: 'en' }) // as the index was built
const query = parseQuery(
  tokenizer,
  new URLSearchParams(location.search).get('q'),
)
const marks = markText(article, query, tokenizer, { className: 'hit' })
marks[0]?.scrollIntoView({ block: 'center' })
```

`markText` marks the phrase when the words occur in order, and falls back to
marking each word otherwise. `locate(mark, '[data-para]')` tells you which
block a mark sits in and how far through it, for a page that can do something
with that, such as cue a recording to the moment the words are spoken.

## React

```ts
import {
  useMarkQuery,
  useSearchIndex,
  useSectionTexts,
} from '@rosicrucian/search/react'
```

- `useSearchIndex(url)` fetches, validates and caches an index for the session.
  Returns `{ status, index, error, retry }`.
- `useSectionTexts(urls)` fetches the section-text files for the rows on
  screen, debounced and cached. Returns a `Map` from URL to texts; pass only
  the URLs of the rows you want excerpts for.
- `useMarkQuery(ref, { tokenizer, className, scroll, dep, onMarked })` reads
  `?q=` and marks the words inside `ref` after render.

None of them knows a class name, a URL or an attribute of your site. You pass
those in.

## API

| Name                                           | What it does                                                                    |
| ---------------------------------------------- | ------------------------------------------------------------------------------- |
| `buildIndex(docs, { tokenizer, titleBoost? })` | Documents in; `{ index, sections }` out.                                        |
| `loadIndex(json)`                              | Validates parsed JSON as an index; throws `IndexFormatError`.                   |
| `parseQuery(source, text)`                     | Text to `Query`: terms, quoted phrases, whether the last word is a prefix.      |
| `search(index, query, { limit? })`             | Ranked `SearchResult[]`.                                                        |
| `occurrences(index, query, result, { max? })`  | Every place the query matched in one document, for a "show all hits" view.      |
| `highlight(source, text, query, options?)`     | Text split into `Part[]` with the hits flagged; optionally clipped to a window. |
| `markText(container, query, source, options?)` | Wraps the hits in a live DOM subtree; returns the mark elements.                |
| `locate(mark, blockSelector)`                  | The block a mark is in and how far through it.                                  |
| `resolveTokenizer(config)`                     | A `Tokenizer` from a `TokenizerConfig`, for a page with no index in hand.       |
| `FORMAT`                                       | The index format this version reads and writes.                                 |

A `source` is either an index or a resolved tokenizer. Lower-level pieces
(`hitsIn`, `phraseRuns`, `prefixRange`, `encodeRun`, `decodeRuns`, `sectionAt`)
are exported for people building their own UI on the same index.

## The index file

Plain JSON. `terms` is the sorted vocabulary, so a prefix is a binary-searched
range; `postings` holds one array per term per stream (`title`, `body`) as
delta-encoded runs `[doc, count, firstPosition, gap, gap, …]`; `docs` carries
each document's id, title, meta, stream lengths and section table. The format
has a version number, and `loadIndex` refuses anything else. For a corpus of
114 lessons, 2.4 MB of text, the index is 1.6 MB, 640 KB gzipped.

## Not included

Stemming, fuzzy matching and field filters. Each is a possible addition that
would be recorded in the index header like the tokenizer options are; none is
a function slot, because the configuration has to round-trip through JSON.

## License

MIT
