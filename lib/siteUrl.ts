/**
 * This site's own address, for links and social cards in pages built ahead of
 * time, where there is no request to read the host from: CANONICAL_HOST when
 * the host sets one, else the production domain Vercel gives the build, else
 * Terra Swap's own.
 */

const host = (process.env.CANONICAL_HOST || process.env.VERCEL_PROJECT_PRODUCTION_URL || 'swap.openfields.app')
  .replace(/^https?:\/\//, '')
  .replace(/\/+$/, '')

export const SITE_URL = `https://${host}`
