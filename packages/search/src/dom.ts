// Marking the query's words on a live page.
//
// Browser-only (it walks and edits the DOM); nothing here touches React, and
// nothing here knows a class name, a URL parameter or an attribute — the caller
// passes what its page uses.
//
// Phrase-first: if the query's words occur IN ORDER anywhere in the container,
// only those runs are marked, so "Builders of the Adytum" marks the phrase and
// not every scattered "of" and "the". Only when no phrase is found does it fall
// back to marking each matched word. A phrase is looked for within one text
// node; words split across inline elements are marked word by word.
//
// The content being marked is the site's own rendered text, so wrapping matched
// text nodes in an element is safe.

import { tokenizerOf, type Query, type TokenSource } from './query.ts'
import { hitsIn, phraseRuns } from './text.ts'

export interface MarkOptions {
  /** Class for each mark element. */
  className?: string
  /** Element to wrap each hit in. Default 'mark'. */
  element?: string
}

/**
 * Wrap every hit in `container` in a mark element and return the marks in
 * document order (empty when nothing matched). The caller decides what to do
 * next — scroll to the first, cue audio, nothing.
 */
export function markText(
  container: HTMLElement,
  query: Query,
  source: TokenSource,
  options: MarkOptions = {},
): HTMLElement[] {
  if (query.terms.length === 0) return []
  const { spans } = tokenizerOf(source)
  const { className, element = 'mark' } = options

  // Collect first, mutate after: replacing a text node while walking it is
  // undefined behaviour for a TreeWalker.
  const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT)
  const nodes: Text[] = []
  let node: Node | null
  while ((node = walker.nextNode())) nodes.push(node as Text)

  const perNode = nodes.map((n) => {
    const text = n.nodeValue ?? ''
    const s = spans(text)
    return {
      node: n,
      phrases: phraseRuns(s, query),
      words: hitsIn(s, query).map((h): [number, number] => [h.start, h.end]),
    }
  })
  const anyPhrase = perNode.some((p) => p.phrases.length > 0)

  const marks: HTMLElement[] = []
  for (const { node: textNode, phrases, words } of perNode) {
    const ranges = anyPhrase ? phrases : words
    if (ranges.length === 0) continue
    const text = textNode.nodeValue ?? ''
    const frag = document.createDocumentFragment()
    let last = 0
    for (const [from, to] of ranges) {
      if (from > last)
        frag.appendChild(document.createTextNode(text.slice(last, from)))
      const mark = document.createElement(element)
      if (className) mark.className = className
      mark.textContent = text.slice(from, to)
      frag.appendChild(mark)
      marks.push(mark)
      last = to
    }
    if (last < text.length)
      frag.appendChild(document.createTextNode(text.slice(last)))
    textNode.parentNode?.replaceChild(frag, textNode)
  }
  return marks
}

/**
 * The block a mark sits in and how far through that block's text it is — for a
 * page that can do something with the position, such as cue audio to the
 * moment the words are spoken. `blockSelector` names the blocks (`[data-para]`);
 * the caller reads whatever it needs off the returned element.
 */
export function locate(
  mark: HTMLElement,
  blockSelector: string,
): { block: HTMLElement; fraction: number } | null {
  const block = mark.closest<HTMLElement>(blockSelector)
  if (!block) return null
  const before = document.createRange()
  before.setStart(block, 0)
  before.setEndBefore(mark)
  const total = block.textContent?.length ?? 0
  return { block, fraction: total ? before.toString().length / total : 0 }
}
