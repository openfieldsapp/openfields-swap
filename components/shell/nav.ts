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
