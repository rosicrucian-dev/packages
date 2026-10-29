// Fetch the section-text files for the results currently on screen.
//
// `buildIndex` returns each document's section texts separately from the index,
// and the site writes them as one small JSON array per document. They are kept
// out of the index because together they are the whole corpus, and every reader
// downloads the index just to type a query. This hook fetches only the files
// for the rows a dialog is showing.
//
// TUNING: this hook has no limit of its own. The caller decides which rows get
// an excerpt simply by which URLs it passes — the first N, or none at all.

import { useEffect, useState } from 'react'

const cache = new Map<string, Promise<string[]>>()

function fetchSections(url: string): Promise<string[]> {
  let promise = cache.get(url)
  if (!promise) {
    promise = fetch(url)
      .then((res) => {
        if (!res.ok) throw new Error(`section texts ${url}: HTTP ${res.status}`)
        return res.json() as Promise<string[]>
      })
      .catch((err) => {
        cache.delete(url) // a failed fetch shouldn't poison later queries
        throw err
      })
    cache.set(url, promise)
  }
  return promise
}

/**
 * Section texts for each requested URL, keyed by that URL. A missing entry just
 * means "not here yet" — a row renders fine without its excerpt and fills in on
 * the next paint, so a slow network degrades rather than blocks.
 *
 * Debounced: results change on every keystroke, and firing a dozen requests per
 * character would waste nearly all of them. Cached for the session and shared
 * across queries — successive searches over the same material mostly re-show
 * documents already fetched.
 */
export function useSectionTexts(
  urls: string[],
  options: { debounceMs?: number } = {},
): Map<string, string[]> {
  const { debounceMs = 150 } = options
  const [loaded, setLoaded] = useState<Map<string, string[]>>(new Map())
  // Only re-run when the actual set changes, not on every render.
  const key = urls.join('\n')

  useEffect(() => {
    if (!key) return
    let alive = true
    const timer = setTimeout(() => {
      for (const url of key.split('\n')) {
        fetchSections(url)
          .then((texts) => {
            if (!alive) return
            setLoaded((prev) => {
              if (prev.get(url) === texts) return prev
              const next = new Map(prev)
              next.set(url, texts)
              return next
            })
          })
          .catch(() => {
            /* no excerpt for this row; it still works */
          })
      }
    }, debounceMs)
    return () => {
      alive = false
      clearTimeout(timer)
    }
  }, [key, debounceMs])

  return loaded
}
