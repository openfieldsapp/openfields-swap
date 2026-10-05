/**
 * Openfields UI primitives: the few pieces every screen is built from, over
 * the classes in styles/globals.css.
 */

import { ReactNode, useEffect, useRef, useState, type ButtonHTMLAttributes } from 'react'
import { createPortal } from 'react-dom'
import { Icon, type IconName } from './Icon'

export { Icon, type IconName } from './Icon'

export const cx = (...xs: (string | false | null | undefined)[]) => xs.filter(Boolean).join(' ')

// ── Buttons ─────────────────────────────────────────────────────────────

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  /** primary: the one action a screen is for. secondary: an alternative. quiet: everything else. */
  variant?: 'primary' | 'secondary' | 'quiet'
  size?: 'sm' | 'md' | 'lg'
  block?: boolean
  /** Shows a spinner and keeps the button from being pressed again, without greying it out. */
  busy?: boolean
}

export function Button({ variant = 'secondary', size = 'md', block, busy, className, type = 'button', children, disabled, ...rest }: ButtonProps) {
  return (
    <button
      type={type}
      className={cx('of-btn', `of-btn--${variant}`, size !== 'md' && `of-btn--${size}`, block && 'of-btn--block', className)}
      disabled={disabled || busy}
      aria-busy={busy || undefined}
      {...rest}
    >
      {busy && <span className='of-spin' aria-hidden />}
      {children}
    </button>
  )
}

/** A round button with only an icon: the label is for people who cannot see the icon. */
export function IconButton({ icon, label, className, type = 'button', ...rest }: ButtonHTMLAttributes<HTMLButtonElement> & { icon: IconName; label: string }) {
  return (
    <button type={type} className={cx('of-icon-btn', className)} aria-label={label} title={label} {...rest}>
      <Icon name={icon} />
    </button>
  )
}

export function ExternalLink({ href, children, className }: { href: string; children: ReactNode; className?: string }) {
  return (
    <a href={href} target='_blank' rel='noopener noreferrer' className={className}>
      {children}
      <span className='of-sr'> (opens in a new tab)</span>
    </a>
  )
}

/** Something people rarely need, kept one click away. */
export function Disclosure({ summary, children, className }: { summary: ReactNode; children: ReactNode; className?: string }) {
  return (
    <details className={cx('of-disclosure', className)}>
      <summary><Icon name='chevronRight' size={14} />{summary}</summary>
      {children}
    </details>
  )
}

// ── Modal ───────────────────────────────────────────────────────────────

/** A dialog: focus stays inside while it is open and returns where it was; Escape and the backdrop close it. */
export function Modal({ open, onClose, title, subtitle, children }: {
  open: boolean; onClose: () => void; title: string; subtitle?: ReactNode; children: ReactNode
}) {
  const [mounted, setMounted] = useState(false)
  const panel = useRef<HTMLDivElement>(null)
  // Callers pass a new onClose on every render; through a ref the effect below runs when the modal opens, not on every render.
  const closeRef = useRef(onClose)
  closeRef.current = onClose
  useEffect(() => setMounted(true), [])
  useEffect(() => {
    if (!open) return
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    const focusables = () => Array.from(panel.current?.querySelectorAll<HTMLElement>(
      'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
    ) ?? [])
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { closeRef.current(); return }
      if (e.key !== 'Tab') return
      const f = focusables()
      if (f.length === 0) return
      const first = f[0], last = f[f.length - 1]
      if (document.activeElement === panel.current) { e.preventDefault(); (e.shiftKey ? last : first).focus() }
      else if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus() }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus() }
    }
    window.addEventListener('keydown', onKey)
    const t = setTimeout(() => panel.current?.focus(), 30)
    return () => {
      document.body.style.overflow = prev
      window.removeEventListener('keydown', onKey)
      clearTimeout(t)
      opener?.focus()
    }
  }, [open])
  if (!mounted || !open) return null
  return createPortal(
    <div className='of-overlay' onMouseDown={e => { if (e.target === e.currentTarget) onClose() }}>
      <div ref={panel} tabIndex={-1} className='of-modal' role='dialog' aria-modal='true' aria-labelledby='of-modal-title'>
        <div className='of-modal-head'>
          <div>
            <h2 id='of-modal-title' className='of-modal-title'>{title}</h2>
            {subtitle && <p className='of-modal-sub'>{subtitle}</p>}
          </div>
          <IconButton icon='close' label='Close' onClick={onClose} />
        </div>
        {children}
      </div>
    </div>,
    document.body,
  )
}
