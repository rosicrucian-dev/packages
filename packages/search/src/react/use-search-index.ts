// Fetch a prebuilt index, validate it, and cache it for the session.
//
// Keyed by URL so distinct indexes — a second locale, another collection —
// never clobber each other. Working out the URL is the site's job (per locale,
// per collection); nothing site-specific lives here.
//
// SSR-safe: the fetch only runs in the effect, on the client. `status` lets a
// dialog show loading vs. an error with a retry, and `error` lets it tell an
// `IndexFormatError` (last deploy's index from a stale cache: reload) from a
// network failure (retry).

import { useCallback, useEffect, useState } from 'react'

import type { SearchIndex } from '../format.ts'
import { loadIndex } from '../query.ts'

const cache = new Map<string, Promise<SearchIndex>>()

function fetchIndex(url: string): Promise<SearchIndex> {
  let promise = cache.get(url)
  if (!promise) {
    promise = fetch(url)
      .then((res) => {
        if (!res.ok) throw new Error(`search index ${url}: HTTP ${res.status}`)
        return res.json()
      })
      .then((json) => loadIndex(json))
      .catch((err) => {
        cache.delete(url) // don't cache a failure — allow retry
        throw err
      })
    cache.set(url, promise)
  }
  return promise
}

export type SearchIndexState<Meta> =
  | { status: 'loading'; index: null; error: null }
  | { status: 'ready'; index: SearchIndex<Meta>; error: null }
  | { status: 'error'; index: null; error: Error }

export function useSearchIndex<Meta = unknown>(
  url: string,
): SearchIndexState<Meta> & { retry: () => void } {
  const [state, setState] = useState<SearchIndexState<Meta>>({
    status: 'loading',
    index: null,
    error: null,
  })
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    let alive = true
    fetchIndex(url)
      .then((index) => {
        if (alive) {
          setState({
            status: 'ready',
            index: index as SearchIndex<Meta>,
            error: null,
          })
        }
      })
      .catch((err: unknown) => {
        if (alive) {
          setState({
            status: 'error',
            index: null,
            error: err instanceof Error ? err : new Error(String(err)),
          })
        }
      })
    return () => {
      alive = false
    }
  }, [url, attempt])

  const retry = useCallback(() => {
    setState({ status: 'loading', index: null, error: null })
    setAttempt((a) => a + 1)
  }, [])

  return { ...state, retry }
}
