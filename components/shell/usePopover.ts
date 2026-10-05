import { useEffect, useRef, useState } from 'react'

/**
 * A button that opens a panel under it. The panel closes on a click or tap
 * outside, on Escape (focus goes back to the button), and when focus leaves it.
 */
export function usePopover() {
  const [open, setOpen] = useState(false)
  const root = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const el = root.current
    const onDown = (e: PointerEvent) => { if (el && !el.contains(e.target as Node)) setOpen(false) }
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      setOpen(false)
      el?.querySelector<HTMLElement>('[aria-expanded]')?.focus()
    }
    const onFocusOut = (e: FocusEvent) => { if (el && e.relatedTarget instanceof Node && !el.contains(e.relatedTarget)) setOpen(false) }
    document.addEventListener('pointerdown', onDown)
    window.addEventListener('keydown', onKey)
    el?.addEventListener('focusout', onFocusOut)
    return () => {
      document.removeEventListener('pointerdown', onDown)
      window.removeEventListener('keydown', onKey)
      el?.removeEventListener('focusout', onFocusOut)
    }
  }, [open])

  return { open, setOpen, root }
}
