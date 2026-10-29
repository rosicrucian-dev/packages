// Tests for the shared search engine's index format and builder.
//
//   npm test
//
// ⚠ KEEP BYTE-IDENTICAL with the sibling project (botatoolbox ⇄ agelesswisdom);
//   `npm run check:shared` verifies the whole test/search-engine/ directory.

import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  buildIndex,
  decodeRuns,
  encodeRun,
  FORMAT,
  sectionAt,
} from '../src/index.ts'

// ---- codec ------------------------------------------------------------------

test('a run is the doc, the count, the first position, then the gaps', () => {
  assert.deepEqual(encodeRun(7, [3, 10, 11, 40]), [7, 4, 3, 7, 1, 29])
  assert.deepEqual(encodeRun(2, []), [2, 0])
})

test('decodeRuns inverts encodeRun across several docs', () => {
  const runs = [
    ...encodeRun(0, [5]),
    ...encodeRun(3, [1, 2, 9]),
    ...encodeRun(4, []),
  ]
  const m = decodeRuns(runs)
  assert.deepEqual(
    [...m.entries()],
    [
      [0, [5]],
      [3, [1, 2, 9]],
      [4, []],
    ],
  )
})

// ---- sectionAt --------------------------------------------------------------

test('sectionAt finds the section whose span contains a position', () => {
  const table = { start: [0, 27, 106], anchor: ['p1', 'p2', 'p5'] }
  assert.equal(sectionAt(table, 0), 0)
  assert.equal(sectionAt(table, 26), 0)
  assert.equal(sectionAt(table, 27), 1)
  assert.equal(sectionAt(table, 105), 1)
  assert.equal(sectionAt(table, 106), 2)
  assert.equal(sectionAt(table, 9999), 2)
})

test('sectionAt is -1 only for an empty table', () => {
  assert.equal(sectionAt({ start: [], anchor: [] }, 5), -1)
})

// ---- buildIndex -------------------------------------------------------------

const DOCS = [
  {
    id: 'a',
    title: 'The Tree',
    sections: [
      { text: 'the tree of life is a symbol', anchor: 'p1' },
      { text: 'life power flows', anchor: 'p2' },
    ],
    meta: { href: '/a' },
  },
  {
    id: 'b',
    title: 'Knowledge',
    sections: [{ text: 'the tree of knowledge' }],
  },
]

test('buildIndex writes the header: format, resolved tokenizer, boost, stamp', () => {
  const { index } = buildIndex(DOCS, { tokenizer: { locale: 'en' } })
  assert.equal(index.format, FORMAT)
  assert.equal(index.tokenizer.locale, 'en')
  assert.equal(index.tokenizer.numbers, true)
  assert.equal(index.titleBoost, 3)
  assert.match(index.stamp, /^[0-9a-f]{14}$/)
})

test('terms are sorted and postings are aligned with them per stream', () => {
  const { index } = buildIndex(DOCS, { tokenizer: { locale: 'en' } })
  assert.deepEqual(index.terms, [...index.terms].sort())
  assert.equal(index.postings.title.length, index.terms.length)
  assert.equal(index.postings.body.length, index.terms.length)
  const tree = index.terms.indexOf('tree')
  // "tree" is in both titles-or-bodies: title of a, body of a and b.
  assert.deepEqual([...decodeRuns(index.postings.title[tree]).keys()], [0])
  assert.deepEqual([...decodeRuns(index.postings.body[tree]).keys()], [0, 1])
  // "knowledge" never occurs in a body of a, and its title posting is doc 1.
  const knowledge = index.terms.indexOf('knowledge')
  assert.deepEqual([...decodeRuns(index.postings.title[knowledge]).keys()], [1])
})

test('section starts are body token offsets; anchors are kept or null', () => {
  const { index } = buildIndex(DOCS, { tokenizer: { locale: 'en' } })
  // a: "tree life symbol" (positions 0–2), a gap, then "life power flows"
  // from 4. `len` counts tokens, not the gap.
  assert.deepEqual(index.docs[0].sections, {
    start: [0, 4],
    anchor: ['p1', 'p2'],
  })
  assert.deepEqual(index.docs[0].len, { title: 1, body: 6 })
  assert.deepEqual(index.docs[1].sections, { start: [0], anchor: [null] })
})

test('meta is carried through untouched and omitted when absent', () => {
  const { index } = buildIndex(DOCS, { tokenizer: { locale: 'en' } })
  assert.deepEqual(index.docs[0].meta, { href: '/a' })
  assert.equal('meta' in index.docs[1], false)
})

test('section texts are returned whitespace-normalized, parallel to the table', () => {
  const { sections } = buildIndex(
    [
      {
        id: 'x',
        title: 't',
        sections: [{ text: '  two\n\nlines  ' }, { text: 'b' }],
      },
    ],
    { tokenizer: { locale: 'en' } },
  )
  assert.deepEqual(sections, { x: ['two lines', 'b'] })
})

test('a document with no sections gets one empty section', () => {
  const { index, sections } = buildIndex(
    [{ id: 'x', title: 'Only a title', sections: [] }],
    {
      tokenizer: { locale: 'en' },
    },
  )
  assert.deepEqual(index.docs[0].sections, { start: [0], anchor: [null] })
  assert.deepEqual(sections, { x: [''] })
})

test('the stamp changes with section text and not with meta', () => {
  const base = buildIndex(DOCS, { tokenizer: { locale: 'en' } }).index.stamp
  const sameText = buildIndex(
    DOCS.map((d) => ({ ...d, meta: { href: '/elsewhere' } })),
    { tokenizer: { locale: 'en' } },
  ).index.stamp
  const changed = buildIndex(
    [DOCS[0], { ...DOCS[1], sections: [{ text: 'the tree of wisdom' }] }],
    { tokenizer: { locale: 'en' } },
  ).index.stamp
  assert.equal(sameText, base)
  assert.notEqual(changed, base)
})

test('duplicate ids are refused', () => {
  assert.throws(
    () =>
      buildIndex([DOCS[0], { ...DOCS[1], id: 'a' }], {
        tokenizer: { locale: 'en' },
      }),
    /duplicate document id "a"/,
  )
})

test('the index survives a JSON round trip unchanged', () => {
  const { index } = buildIndex(DOCS, { tokenizer: { locale: 'en' } })
  assert.deepEqual(JSON.parse(JSON.stringify(index)), index)
})
