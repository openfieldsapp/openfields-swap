import { createContext, useContext } from 'react'

/**
 * The swap's own places. Each has an address (?tab=pools…), so it can be linked to and survives a reload.
 * On the swap page the header and footer switch between them without a reload, through this context; on
 * every other page they are plain links.
 */
export type Section = 'swap' | 'pools' | 'portfolio' | 'bridge' | 'board'

export const SECTION_HREF: Record<Section, string> = {
  swap: '/', pools: '/?tab=pools', portfolio: '/?tab=portfolio', bridge: '/?tab=bridge', board: '/?tab=board',
}

export interface SectionNavValue {
  here: Section | null
  go: (s: Section) => void
  /** Opens search on the swap page. */
  search: () => void
}

export const SectionNav = createContext<SectionNavValue | null>(null)
export const useSectionNav = () => useContext(SectionNav)

/** Where the app's own page was last, with its query, so a page about the app can close back to it. */
export const BACK = 'openfields:back:v1'

/** Keeps the address of the app's page the person is on; the swap page also calls it when its tab changes the address in place. */
export function rememberPlace() {
  try { sessionStorage.setItem(BACK, `${window.location.pathname}${window.location.search}`) } catch { /* Close goes to the start */ }
}
