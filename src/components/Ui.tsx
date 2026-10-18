/** Shared micro-components — Nightfall design system */
import { type ReactNode } from 'react'
import { Copy, ExternalLink } from 'lucide-react'
import { toast } from 'sonner'
import { formatAddr } from '../lib/format'

// ─── Token helpers ────────────────────────────────────────────────────────────
// bg-panel   = #121B33   border = #1F2A47   border-strong = #2A3658
// bg-raised  = #18233F   bg-inset = #0F1730
// ink        = #E6EBF5   muted = #8C97B2   soft = #C3D1F5
// accent     = #A9BDF0   accent-fg = #0B1226
// ok         = #8FE3C0   ok-bg = #15283A   ok-border = #1F4A47
// warn       = #F2C27B
// danger     = #F2A0A0   danger-bg = #1E1A2E  danger-border = #5B3440
// frozen     = #9FD3FF   gauge-track = #222D4C

interface Props { children?: ReactNode; className?: string }

export function Card({ children, className = '' }: Props) {
  return (
    <div className={`rounded-[20px] border bg-[#121B33] border-[#1F2A47] ${className}`}>
      {children}
    </div>
  )
}

export function Label({ children, className = '' }: Props) {
  return (
    <span className={`text-[10px] font-medium tracking-widest uppercase text-[#8C97B2] ${className}`}>
      {children}
    </span>
  )
}

export function Skeleton({ className = '' }: { className?: string }) {
  return (
    <div className={`animate-pulse rounded-xl bg-[#1F2A47] ${className}`} />
  )
}

export function AddressChip({
  address,
  explorerUrl,
  short = true,
}: {
  address: string
  explorerUrl?: string
  short?: boolean
}) {
  function copy() {
    void navigator.clipboard.writeText(address)
    toast.success('Copied')
  }
  const display = short ? formatAddr(address) : address
  return (
    <span className="inline-flex items-center gap-1.5 font-mono text-sm text-[#C3D1F5]" style={{ fontFamily: "'DM Mono', monospace" }}>
      <span>{display}</span>
      <button
        onClick={copy}
        aria-label="Copy address"
        className="text-[#8C97B2] hover:text-[#E6EBF5] transition-colors focus-visible:outline-none"
      >
        <Copy size={11} />
      </button>
      {explorerUrl && (
        <a
          href={explorerUrl}
          target="_blank"
          rel="noopener noreferrer"
          aria-label="View on explorer"
          className="text-[#8C97B2] hover:text-[#A9BDF0] transition-colors"
        >
          <ExternalLink size={11} />
        </a>
      )}
    </span>
  )
}

export function Badge({
  children,
  color = 'default',
  className = '',
}: {
  children: ReactNode
  color?: 'default' | 'ok' | 'warn' | 'danger' | 'frozen' | 'muted'
  className?: string
}) {
  const colors: Record<string, string> = {
    default: 'bg-[#18233F] text-[#8C97B2]',
    ok:      'bg-[#15283A] text-[#8FE3C0] border border-[#1F4A47]',
    warn:    'bg-[#18233F] text-[#F2C27B]',
    danger:  'bg-[#1E1A2E] text-[#F2A0A0] border border-[#5B3440]',
    frozen:  'bg-[#18233F] text-[#9FD3FF]',
    muted:   'bg-[#1F2A47] text-[#8C97B2]',
  }
  return (
    <span className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-medium ${colors[color]} ${className}`}>
      {children}
    </span>
  )
}

export function Button({
  children,
  onClick,
  disabled,
  loading,
  variant = 'primary',
  size = 'md',
  className = '',
  type = 'button',
}: {
  children: ReactNode
  onClick?: () => void
  disabled?: boolean
  loading?: boolean
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger'
  size?: 'sm' | 'md' | 'lg'
  className?: string
  type?: 'button' | 'submit' | 'reset'
}) {
  // All buttons are pills (border-radius 999px), min-height 44px
  const base = 'inline-flex items-center justify-center gap-2 font-medium rounded-full transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#A9BDF0] disabled:opacity-40 disabled:cursor-not-allowed min-h-[44px]'
  const sizes = {
    sm: 'px-4 py-1.5 text-sm min-h-[36px]',
    md: 'px-5 py-2.5 text-sm',
    lg: 'px-7 py-3 text-base',
  }
  const variants = {
    primary:   'bg-[#A9BDF0] text-[#0B1226] hover:bg-[#BFD0F7] active:scale-[0.98]',
    secondary: 'bg-transparent border border-[#2A3658] text-[#C3D1F5] hover:bg-[#18233F] active:scale-[0.98]',
    ghost:     'bg-transparent text-[#8C97B2] hover:text-[#E6EBF5] hover:bg-[#18233F] active:scale-[0.98]',
    danger:    'bg-[#1E1A2E] border border-[#5B3440] text-[#F2A0A0] hover:bg-[#261823] active:scale-[0.98]',
  }
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled || loading}
      className={`${base} ${sizes[size]} ${variants[variant]} ${className}`}
    >
      {loading && (
        <span className="inline-block w-3.5 h-3.5 border-2 border-current border-t-transparent rounded-full animate-spin" />
      )}
      {children}
    </button>
  )
}

export function Input({
  label,
  error,
  hint,
  className = '',
  ...props
}: {
  label?: string
  error?: string
  hint?: string
} & React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <div className="flex flex-col gap-1.5">
      {label && <Label>{label}</Label>}
      <input
        className={`w-full px-3.5 py-2.5 rounded-[14px] bg-[#0F1730] border text-sm text-[#E6EBF5] placeholder-[#8C97B2] focus:outline-none focus:border-[#A9BDF0] transition-colors ${
          error ? 'border-[#5B3440]' : 'border-[#1F2A47]'
        } ${className}`}
        {...props}
      />
      {error && <span className="text-xs text-[#F2A0A0]">{error}</span>}
      {!error && hint && <span className="text-xs text-[#8C97B2]">{hint}</span>}
    </div>
  )
}

export function Divider({ className = '' }: { className?: string }) {
  return <div className={`h-px bg-[#1F2A47] ${className}`} />
}

export function Spinner({ size = 16 }: { size?: number }) {
  return (
    <span
      style={{ width: size, height: size }}
      className="inline-block border-2 border-[#8C97B2] border-t-[#A9BDF0] rounded-full animate-spin"
    />
  )
}
