// Tests for the shared search engine's query side.
//
//   npm test
//
// ⚠ KEEP BYTE-IDENTICAL with the sibling project (botatoolbox ⇄ agelesswisdom);
//   `npm run check:shared` verifies the whole test/search-engine/ directory.
//
// What's deliberately locked here, because breaking any of it is silent:
//   - stopwords are dropped on both sides, which is what lets a quoted
//     "tree of life" match text where "of" was never indexed;
//   - prefix expansion applies to the last LOOSE word only, so a closed quote
//     pins the spelling;
//   - a quoted group is a hard filter, not a ranking nudge;
//   - `best` points at the first phrase hit, else the rarest word — it is what
//     a deep link is built from;
//   - a title hit outranks an equal body hit (the title boost);
//   - an index of another format is refused, not misread.

import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  buildIndex,
  IndexFormatError,
  loadIndex,
  occurrences,
  parseQuery,
  prefixRange,
  search,
} from '../src/index.ts'

// ---- fixture ------------------------------------------------------------------
// Three short docs whose token streams are small enough to reason about by
// hand. Stopwords are dropped at index time, so the body streams are:
//   a: tree life symbol
//   b: life power flows through tree
//   c: tree life | tree knowledge        (two sections)
const CORPUS = [
  {
    id: 'a',
    title: 'Alpha',
    sections: [{ text: 'the tree of life is a symbol', anchor: 'p1' }],
  },
  {
    id: 'b',
    title: 'Beta',
    sections: [{ text: 'life power flows through the tree', anchor: 'p1' }],
  },
  {
    id: 'c',
    title: 'Gamma',
    sections: [
      { text: 'the tree of life', anchor: 'p1' },
      { text: 'and the tree of knowledge', anchor: 'p2' },
    ],
  },
]
const index = buildIndex(CORPUS, { tokenizer: { locale: 'en' } }).index

const ids = (results: Array<{ id: string }>) => results.map((r) => r.id)

// ---- loadIndex ------------------------------------------------------------------

test('loadIndex accepts what buildIndex made, after a JSON round trip', () => {
  const loaded = loadIndex(JSON.parse(JSON.stringify(index)))
  assert.equal(loaded.docs.length, 3)
})

test('loadIndex refuses another format version', () => {
  assert.throws(() => loadIndex({ ...index, format: 2 }), IndexFormatError)
})

test('loadIndex refuses the pre-format index shape', () => {
  assert.throws(
    () => loadIndex({ docs: [], words: {}, lengths: [] }),
    (e: unknown) => {
      assert.ok(e instanceof IndexFormatError)
      assert.equal(e.code, 'format')
      return true
    },
  )
  assert.throws(() => loadIndex(null), IndexFormatError)
  assert.throws(() => loadIndex({ format: 1 }), IndexFormatError)
})

// ---- parseQuery -------------------------------------------------------------------

test('parseQuery splits quoted groups from the loose words around them', () => {
  const q = parseQuery(index, 'tarot "tree of life"')
  assert.deepEqual(q.segments, [
    { terms: ['tarot'], quoted: false },
    { terms: ['tree', 'life'], quoted: true },
  ])
  assert.deepEqual(q.terms, ['tarot', 'tree', 'life'])
  assert.deepEqual(q.phrases, [[1, 3]])
  assert.equal(q.prefixLast, false)
})

test('curly quotes delimit; apostrophes do not', () => {
  assert.deepEqual(parseQuery(index, '“tree life”').phrases, [[0, 2]])
  assert.deepEqual(parseQuery(index, "Case's tree").terms, ['case', 'tree'])
})

test('an unterminated quote stays loose while it is being typed', () => {
  const q = parseQuery(index, '"tree of li')
  assert.deepEqual(q.phrases, [])
  assert.equal(q.prefixLast, false) // "li" is too short to expand
  assert.equal(parseQuery(index, '"tree of lif').prefixLast, true)
})

test('a one-word quote pins the spelling but is not a phrase', () => {
  const q = parseQuery(index, '"trees"')
  assert.deepEqual(q.phrases, [])
  assert.equal(q.prefixLast, false)
})

test('prefixLast needs a loose final word of three letters or more', () => {
  assert.equal(parseQuery(index, 'tree li').prefixLast, false)
  assert.equal(parseQuery(index, 'tree lif').prefixLast, true)
  assert.equal(parseQuery(index, 'lif "tree"').prefixLast, false)
})

// ---- prefixRange -------------------------------------------------------------------

test('prefixRange is the half-open range of terms starting with the prefix', () => {
  const terms = ['alpha', 'tree', 'treeline', 'trees', 'trust', 'zeta']
  assert.deepEqual(prefixRange(terms, 'tre'), [1, 4])
  assert.deepEqual(prefixRange(terms, 'tru'), [4, 5])
  assert.deepEqual(prefixRange(terms, 'zz'), [6, 6])
  assert.deepEqual(prefixRange(terms, 'a'), [0, 1])
})

// ---- search: matching ------------------------------------------------------------

test('every word must appear (AND)', () => {
  assert.deepEqual(ids(search(index, 'tree power')).sort(), ['b'])
  assert.deepEqual(ids(search(index, 'tree knowledge')).sort(), ['c'])
})

test('a word matches in the title or in the body', () => {
  assert.deepEqual(ids(search(index, 'gamma')), ['c'])
  assert.deepEqual(ids(search(index, 'gamma tree')), ['c'])
})

test('stopwords in the query are ignored, so "tree of life" finds docs that never indexed "of"', () => {
  assert.deepEqual(ids(search(index, 'the tree of life')).sort(), [
    'a',
    'b',
    'c',
  ])
})

test('a query of only stopwords matches nothing', () => {
  assert.deepEqual(search(index, 'the of and'), [])
  assert.deepEqual(search(index, ''), [])
})

test('the last loose word matches by prefix while being typed', () => {
  assert.deepEqual(ids(search(index, 'tree sym')), ['a'])
  assert.deepEqual(ids(search(index, 'know')), ['c'])
})

test('a closed quote pins the spelling: no prefix expansion', () => {
  assert.deepEqual(ids(search(index, '"sym"')), [])
  assert.deepEqual(ids(search(index, 'tree "sym"')), [])
})

test('a quoted group is a hard filter: words present but never together are dropped', () => {
  // b has both words, but "power … tree" never consecutively.
  assert.deepEqual(ids(search(index, '"tree life"')).sort(), ['a', 'c'])
  assert.deepEqual(ids(search(index, '"power tree"')), [])
})

// ---- search: ranking and counts ---------------------------------------------------

test('phrase matches rank above scattered matches', () => {
  const results = search(index, 'tree life')
  // a and c have "tree life" consecutively; b has the words apart.
  assert.equal(results[results.length - 1].id, 'b')
  assert.equal(results[results.length - 1].phrase, 0)
  assert.ok(results[0].phrase > 0)
})

test('having the phrase is a tier, not a count: within it, relevance decides', () => {
  // The lesson NAMED "The Life Power" uses the phrase twice; another lesson
  // repeats it six times. Ordering by phrase count buried the titled lesson
  // (measured: 20th of 102 on the real corpus); the title boost must decide.
  const idx = buildIndex(
    [
      {
        id: 'repeats',
        title: 'Bondage',
        sections: [
          {
            text: 'life power life power life power life power life power life power',
          },
        ],
      },
      {
        id: 'named',
        title: 'The Life Power',
        sections: [{ text: 'the life power is one; the life power is all' }],
      },
      {
        id: 'scattered',
        title: 'Water',
        // "is the" are stopwords, so "life force power form" is the stream:
        // the two words are present but never adjacent.
        sections: [{ text: 'life is the force, power is the form' }],
      },
    ],
    { tokenizer: { locale: 'en' } },
  ).index
  const results = search(idx, 'life power')
  assert.deepEqual(ids(results), ['named', 'repeats', 'scattered'])
  assert.ok(results[0].phrase < results[1].phrase)
  assert.equal(results[2].phrase, 0)
})

test('within the tier, more occurrences of the phrase itself rank higher', () => {
  // Same words, same scattered counts; one document has them together six
  // times, the other once. The phrase is evidence beyond its words.
  const once = 'tree life ' + 'tree stands. life flows. '.repeat(5)
  const often = 'tree life '.repeat(6)
  const idx = buildIndex(
    [
      { id: 'once', title: 'A', sections: [{ text: once }] },
      { id: 'often', title: 'B', sections: [{ text: often }] },
    ],
    { tokenizer: { locale: 'en' } },
  ).index
  const results = search(idx, 'tree life')
  assert.deepEqual(ids(results), ['often', 'once'])
  assert.equal(results[0].phrase, 6)
  assert.equal(results[1].phrase, 1)
})

test('count is every occurrence of every word; phrase is the contiguous ones', () => {
  const c = search(index, 'tree life').find((r) => r.id === 'c')!
  assert.equal(c.count, 3) // tree ×2, life ×1
  assert.equal(c.phrase, 1)
  const b = search(index, 'tree life').find((r) => r.id === 'b')!
  assert.equal(b.count, 2)
  assert.equal(b.phrase, 0)
})

test('for a single word, phrase equals count', () => {
  const c = search(index, 'tree').find((r) => r.id === 'c')!
  assert.equal(c.phrase, c.count)
  assert.equal(c.count, 2)
})

test('a phrase cannot straddle a section boundary', () => {
  // c's sections end "… life" and begin "tree …": adjacent in reading order,
  // but the body positions leave a gap between sections, so "life tree" is not
  // a phrase here. Loose, the two words still match c (scattered).
  assert.deepEqual(ids(search(index, '"life tree"')), [])
  assert.equal(search(index, 'life tree').find((r) => r.id === 'c')!.phrase, 0)
})

test('a title hit outranks an otherwise equal body hit', () => {
  const idx = buildIndex(
    [
      {
        id: 'titled',
        title: 'The Life Power',
        sections: [{ text: 'an essay on breathing' }],
      },
      {
        id: 'body',
        title: 'Essay Two',
        sections: [{ text: 'the life power is breath' }],
      },
    ],
    { tokenizer: { locale: 'en' } },
  ).index
  const results = search(idx, 'life power')
  assert.deepEqual(ids(results), ['titled', 'body'])
  assert.ok(results[0].score > results[1].score)
})

test('results expose docIndex, id, title, meta and score', () => {
  const idx = buildIndex(
    [
      {
        id: 'x',
        title: 'X',
        sections: [{ text: 'tree' }],
        meta: { href: '/x' },
      },
    ],
    { tokenizer: { locale: 'en' } },
  ).index
  const [r] = search(idx, 'tree')
  assert.equal(r.docIndex, 0)
  assert.equal(r.id, 'x')
  assert.equal(r.title, 'X')
  assert.deepEqual(r.meta, { href: '/x' })
  assert.ok(r.score > 0)
})

test('limit truncates after ranking; the default is everything', () => {
  assert.equal(search(index, 'tree').length, 3)
  assert.equal(search(index, 'tree', { limit: 2 }).length, 2)
})

test('a parsed Query can be passed instead of text', () => {
  const q = parseQuery(index, 'tree life')
  assert.deepEqual(ids(search(index, q)), ids(search(index, 'tree life')))
})

// ---- search: best ------------------------------------------------------------------

test('best is the first contiguous occurrence, with its section and anchor', () => {
  // c's body positions: tree 0, life 1, (gap), tree 3, knowledge 4.
  const c = search(index, 'tree knowledge').find((r) => r.id === 'c')!
  assert.deepEqual(c.best, {
    where: 'body',
    position: 3,
    section: 1,
    anchor: 'p2',
  })
})

test('best falls back to the rarest word when the words are scattered', () => {
  // In b, "power" is rarer (only b) than "tree" (all three): best is "power" at 1.
  const b = search(index, 'tree power').find((r) => r.id === 'b')!
  assert.deepEqual(b.best, {
    where: 'body',
    position: 1,
    section: 0,
    anchor: 'p1',
  })
})

test('best prefers the body over the title, and reports a title hit as such', () => {
  const idx = buildIndex(
    [{ id: 'x', title: 'Tree', sections: [{ text: 'a tree', anchor: 'p1' }] }],
    { tokenizer: { locale: 'en' } },
  ).index
  assert.deepEqual(search(idx, 'tree')[0].best, {
    where: 'body',
    position: 0,
    section: 0,
    anchor: 'p1',
  })
  const titleOnly = buildIndex(
    [{ id: 'x', title: 'Tree', sections: [{ text: 'a forest' }] }],
    { tokenizer: { locale: 'en' } },
  ).index
  assert.deepEqual(search(titleOnly, 'tree')[0].best, {
    where: 'title',
    position: 0,
  })
})

test('best follows the first quoted group in a mixed query', () => {
  const c = search(index, 'tree "tree knowledge"').find((r) => r.id === 'c')!
  assert.equal(c.best.position, 3)
})

test('a prefix-expanded word contributes positions, so a phrase is found mid-word', () => {
  const c = search(index, 'tree know').find((r) => r.id === 'c')!
  assert.equal(c.phrase, 1)
  assert.equal(c.best.position, 3)
})

// ---- occurrences ------------------------------------------------------------------

test('occurrences lists every hit, body then title, ascending, with sections', () => {
  const idx = buildIndex(
    [
      {
        id: 'x',
        title: 'Tree of Trees',
        sections: [
          { text: 'a tree', anchor: 'p1' },
          { text: 'another tree and a tree', anchor: 'p2' },
        ],
      },
    ],
    { tokenizer: { locale: 'en' } },
  ).index
  // Body positions: tree 0, (gap), another 2, tree 3, tree 4.
  const [r] = search(idx, 'tree')
  assert.deepEqual(occurrences(idx, 'tree', r), [
    { where: 'body', position: 0, section: 0, anchor: 'p1' },
    { where: 'body', position: 3, section: 1, anchor: 'p2' },
    { where: 'body', position: 4, section: 1, anchor: 'p2' },
    { where: 'title', position: 0 },
    { where: 'title', position: 1 },
  ])
  assert.equal(occurrences(idx, 'tree', r, { max: 2 }).length, 2)
})

// ---- locale ------------------------------------------------------------------------

test('the index decides the tokenizer: a German index drops German stopwords', () => {
  const de = buildIndex(
    [{ id: 'd', title: 'Baum', sections: [{ text: 'Der Baum des Lebens' }] }],
    {
      tokenizer: { locale: 'de' },
    },
  ).index
  assert.deepEqual(parseQuery(de, 'der Baum').terms, ['baum'])
  assert.equal(search(de, 'des').length, 0)
})
