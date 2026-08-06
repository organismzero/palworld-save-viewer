import { useState } from 'react'

import { MonogramTile } from './primitives.tsx'
import { iconUrl } from '../refdata/refdata.ts'

/**
 * A game icon, fetched lazily and degrading to a monogram.
 *
 * Two constraints shape this. There are ~2,470 icons totalling 20 MB, so
 * nothing is fetched until it scrolls into view — the virtualised grid only
 * ever mounts ~40 cards, which caps in-flight requests without any extra
 * machinery. And **50 of 753 pals have no icon file at all** (mostly alphas
 * and newer species), so the fallback is a first-class path rather than an
 * error state: every caller must render correctly without art.
 */
export function GameIcon({
  path,
  name,
  elementName,
  size = 44,
}: {
  path?: string
  name: string
  elementName?: string
  size?: number
}) {
  const url = iconUrl(path)
  // Remembering *which* URL failed, rather than a boolean plus an effect to
  // reset it, means a recycled grid cell showing a different pal retries
  // naturally instead of inheriting the previous one's failure.
  const [failedUrl, setFailedUrl] = useState<string>()
  const failed = failedUrl !== undefined && failedUrl === url

  if (!url || failed) {
    return <MonogramTile name={name} elementName={elementName} size={size} />
  }

  return (
    <img
      src={url}
      alt=""
      width={size}
      height={size}
      loading="lazy"
      decoding="async"
      onError={() => setFailedUrl(url)}
      className="shrink-0 object-contain"
      style={{ width: size, height: size }}
    />
  )
}
