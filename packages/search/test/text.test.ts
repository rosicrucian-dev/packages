// Tests for the shared search engine's text marking.
//
//   npm test
//
// ⚠ KEEP BYTE-IDENTICAL with the sibling project (botatoolbox ⇄ agelesswisdom);
//   `npm run check:shared` verifies the whole test/search-engine/ directory.

import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  highlight,
  hitsIn,
  parseQuery,
  phraseRuns,
  resolveTokenizer,
} from '../src/index.ts'

const tk = resolveTokenizer({ locale: 'en' })
const q = (text: string) => parseQuery(tk, text)

// ---- highlight, whole text ------------------------------------------------------

test('splits a text into marked and unmarked runs', () => {
  assert.deepEqual(highlight(tk, 'the tree of life', q('tree')), [
    { text: 'the ', hit: false },
    { text: 'tree', hit: true },
    { text: ' of life', hit: false },
  ])
})

test('marks every query word, whatever its case in the text', () => {
  assert.deepEqual(
    highlight(tk, 'Tree of Life', q('tree life'))
      .filter((p) => p.hit)
      .map((p) => p.text),
    ['Tree', 'Life'],
  )
})

test('returns the text unmarked when nothing matches', () => {
  assert.deepEqual(highlight(tk, 'short text', q('zzz')), [
    { text: 'short text', hit: false },
  ])
})

test('a folded hit marks the original spelling', () => {
  assert.deepEqual(highlight(tk, 'The Café door', q('cafe')), [
    { text: 'The ', hit: false },
    { text: 'Café', hit: true },
    { text: ' door', hit: false },
  ])
})

test('a number is a hit', () => {
  assert.deepEqual(
    highlight(tk, 'Key 21 and Key 2', q('21'))
      .filter((p) => p.hit)
      .map((p) => p.text),
    ['21'],
  )
})

test('the last loose word also marks by prefix, as the index matched it', () => {
  const parts = highlight(tk, 'colors and coloring and recolor', q('color'))
  assert.deepEqual(
    parts.filter((p) => p.hit).map((p) => p.text),
    ['colors', 'coloring'],
  )
})

test('a quoted (closed) word marks exactly, no prefix', () => {
  const parts = highlight(tk, 'colors and color', q('"color"'))
  assert.deepEqual(
    parts.filter((p) => p.hit).map((p) => p.text),
    ['color'],
  )
})

test('an earlier word is never prefix-expanded, only the last', () => {
  const parts = highlight(tk, 'colors of trees', q('color tree'))
  assert.deepEqual(
    parts.filter((p) => p.hit).map((p) => p.text),
    ['trees'],
  )
})

// ---- highlight, windowed ----------------------------------------------------------

test('a window clips to the first hit with lead-in and ellipses', () => {
  const text = 'x '.repeat(60) + 'the tree of life ' + 'y '.repeat(100)
  const parts = highlight(tk, text, q('tree'), { window: 40, leadIn: 10 })
  const joined = parts.map((p) => p.text).join('')
  assert.ok(joined.startsWith('…'))
  assert.ok(joined.endsWith('…'))
  assert.ok(joined.length <= 40 + 2)
  assert.deepEqual(
    parts.filter((p) => p.hit).map((p) => p.text),
    ['tree'],
  )
})

test('a window with no hit shows the opening of the text', () => {
  const text = 'a '.repeat(200)
  const parts = highlight(tk, text, q('zzz'), { window: 20 })
  assert.equal(parts.length, 1)
  assert.equal(parts[0].hit, false)
  assert.ok(parts[0].text.endsWith('…'))
  assert.ok(parts[0].text.length <= 21)
})

test('a window wider than the text leaves it whole', () => {
  assert.deepEqual(highlight(tk, 'the tree', q('tree'), { window: 190 }), [
    { text: 'the ', hit: false },
    { text: 'tree', hit: true },
  ])
})

test('the ellipsis is configurable', () => {
  const text = 'x '.repeat(60) + 'tree'
  const parts = highlight(tk, text, q('tree'), {
    window: 10,
    leadIn: 2,
    ellipsis: '...',
  })
  assert.ok(parts[0].text.startsWith('...'))
})

// ---- hitsIn / phraseRuns ----------------------------------------------------------

test('hitsIn returns the spans the query matches', () => {
  const spans = tk.spans('the tree of life')
  assert.deepEqual(
    hitsIn(spans, q('life')).map((s) => s.token),
    ['life'],
  )
})

test('phraseRuns spans the words in order, stopwords between them included', () => {
  const text = 'see the Tree of Life and the life of a tree'
  const runs = phraseRuns(tk.spans(text), q('tree life'))
  assert.deepEqual(
    runs.map(([a, b]) => text.slice(a, b)),
    ['Tree of Life'],
  )
})

test('phraseRuns is empty for a single word or an out-of-order pair', () => {
  assert.deepEqual(phraseRuns(tk.spans('tree life'), q('tree')), [])
  assert.deepEqual(phraseRuns(tk.spans('life tree'), q('tree life')), [])
})

test('phraseRuns honours the prefix rule on the last word', () => {
  const text = 'the tree of lifelong study'
  const runs = phraseRuns(tk.spans(text), q('tree life'))
  assert.deepEqual(
    runs.map(([a, b]) => text.slice(a, b)),
    ['tree of lifelong'],
  )
})
