/**
 * AgentForm — shared add/edit form for setAgent().
 * Validates client-side exactly like the contract, shows per-field errors,
 * and offers three presets. Period is a select (not raw seconds).
 */
import { useState } from 'react'
import { isAddress } from 'viem'
import { accountAbi } from '../lib/abis'
import { useNetwork } from '../hooks/useNetwork'
import { useTxFull } from '../hooks/useTx'
import { parseUsdc, validateUsdc, formatAddr } from '../lib/format'
import { Button, Input, Divider } from './Ui'
import type { AgentInfo } from './AgentCard'

// ─── Presets ────────────────────────────────────────────────────────────────

const PRESETS: {
  name: string
  maxPer: string
  periodLimit: string
  periodSecs: string
  totalLimit: string
  daysFromNow: number
}[] = [
  { name: 'API budget',     maxPer: '0.5',  periodLimit: '5',   periodSecs: '86400',  totalLimit: '50',  daysFromNow: 30 },
  { name: 'Research agent', maxPer: '2',    periodLimit: '20',  periodSecs: '604800', totalLimit: '200', daysFromNow: 90 },
  { name: 'Tight trial',    maxPer: '0.1',  periodLimit: '1',   periodSecs: '86400',  totalLimit: '3',   daysFromNow: 7  },
]

// ─── Period select options ───────────────────────────────────────────────────

const PERIOD_OPTIONS: { label: string; value: string }[] = [
  { label: '1 hour',   value: '3600'   },
  { label: '1 day',    value: '86400'  },
  { label: '1 week',   value: '604800' },
  { label: '30 days',  value: '2592000'},
]

// ─── Validation mirrors setAgent() in AllowanceAccount.sol ──────────────────

type FormErrors = Partial<Record<
  'address' | 'label' | 'maxPer' | 'periodLimit' | 'periodSecs' | 'totalLimit' | 'expiresAt',
  string
>>

function validateForm(
  form: { address?: string; label: string; maxPer: string; periodLimit: string; periodSecs: string; totalLimit: string; expiresAt: string },
  isNew: boolean,
): FormErrors {
  const errs: FormErrors = {}

  // Address (new only)
  if (isNew) {
    if (!form.address || !isAddress(form.address)) errs.address = 'Valid address required'
  }

  // Label ≤ 32 bytes (UTF-8)
  const labelBytes = new TextEncoder().encode(form.label)
  if (!form.label.trim()) errs.label = 'Label is required'
  else if (labelBytes.length > 32) errs.label = 'Label must be ≤ 32 bytes'

  // USDC amounts
  const maxPerErr = validateUsdc(form.maxPer, 'Max per payment')
  if (maxPerErr) errs.maxPer = maxPerErr

  const periodLimitErr = validateUsdc(form.periodLimit, 'Period budget')
  if (periodLimitErr) errs.periodLimit = periodLimitErr

  const totalLimitErr = validateUsdc(form.totalLimit, 'Lifetime total')
  if (totalLimitErr) errs.totalLimit = totalLimitErr

  // Cross-field: maxPerPayment ≤ periodLimit ≤ totalLimit
  if (!errs.maxPer && !errs.periodLimit) {
    const maxPerRaw = parseUsdc(form.maxPer)
    const periodLimitRaw = parseUsdc(form.periodLimit)
    if (maxPerRaw > periodLimitRaw) {
      errs.maxPer = 'Max per payment must be ≤ period budget'
    }
    const totalLimitRaw = parseUsdc(form.totalLimit)
    if (!errs.periodLimit && totalLimitRaw < periodLimitRaw) {
      errs.totalLimit = 'Lifetime total must be ≥ period budget'
    }
  }

  // Period seconds: 60–2592000
  const secs = parseInt(form.periodSecs)
  if (isNaN(secs) || secs < 60 || secs > 2_592_000) {
    errs.periodSecs = 'Period must be between 60 s and 30 days'
  }

  // Expiry: must be > now and ≤ now + 365 days
  if (!form.expiresAt) {
    errs.expiresAt = 'Expiry date is required'
  } else {
    const expSec = Math.floor(new Date(form.expiresAt).getTime() / 1000)
    const nowSec = Math.floor(Date.now() / 1000)
    if (expSec <= nowSec) errs.expiresAt = 'Expiry must be in the future'
    else if (expSec > nowSec + 365 * 86400) errs.expiresAt = 'Expiry must be within 365 days'
  }

  return errs
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function defaultExpiry(daysFromNow = 30): string {
  const d = new Date(Date.now() + daysFromNow * 86400_000)
  return d.toISOString().slice(0, 16)
}

function rawToUsdc(raw: bigint): string {
  return (Number(raw) / 1_000_000).toFixed(6).replace(/\.?0+$/, '') || '0'
}

// ─── Component ──────────────────────────────────────────────────────────────

interface Props {
  accountAddress: `0x${string}`
  /** When editing, pass the existing agent. When adding a new one, omit. */
  agent?: AgentInfo
  /** Prefill the address for a new agent (e.g. from demo key). */
  initialAddress?: string
  onSuccess: () => void
}

export function AgentForm({ accountAddress, agent, initialAddress, onSuccess }: Props) {
  const { chainId } = useNetwork()
  const { send, isPending } = useTxFull(chainId, onSuccess)
  const isNew = !agent

  const [form, setForm] = useState({
    address:        initialAddress ?? '',
    label:          agent?.label ?? '',
    maxPer:         agent ? rawToUsdc(agent.maxPerPayment) : '0.5',
    periodLimit:    agent ? rawToUsdc(agent.periodLimit)   : '5',
    periodSecs:     agent ? String(agent.periodSeconds)    : '86400',
    totalLimit:     agent ? rawToUsdc(agent.totalLimit)    : '50',
    expiresAt:      agent?.expiresAt && agent.expiresAt > 0n
                      ? new Date(Number(agent.expiresAt) * 1000).toISOString().slice(0, 16)
                      : defaultExpiry(30),
    payeeRestricted: agent?.payeeRestricted ?? false,
  })

  const [errors, setErrors] = useState<FormErrors>({})

  function setF<K extends keyof typeof form>(k: K, v: typeof form[K]) {
    setForm(p => ({ ...p, [k]: v }))
    setErrors(p => ({ ...p, [k]: undefined }))
  }

  function applyPreset(preset: typeof PRESETS[number]) {
    setForm(p => ({
      ...p,
      maxPer:      preset.maxPer,
      periodLimit: preset.periodLimit,
      periodSecs:  preset.periodSecs,
      totalLimit:  preset.totalLimit,
      expiresAt:   defaultExpiry(preset.daysFromNow),
    }))
    setErrors({})
  }

  async function handleSubmit() {
    const errs = validateForm(form, isNew)
    if (Object.keys(errs).length) { setErrors(errs); return }
    if (!chainId) return

    const agentAddress = (isNew ? form.address : agent.address) as `0x${string}`
    const expiresAtSec = BigInt(Math.floor(new Date(form.expiresAt).getTime() / 1000))

    try {
      await send(
        {
          address: accountAddress,
          abi: accountAbi,
          functionName: 'setAgent',
          args: [
            agentAddress,
            form.label,
            parseUsdc(form.maxPer),
            parseUsdc(form.periodLimit),
            parseInt(form.periodSecs),
            parseUsdc(form.totalLimit),
            expiresAtSec,
            form.payeeRestricted,
          ],
          chainId,
        },
        isNew ? 'Add agent' : 'Update agent',
      )
      onSuccess()
    } catch { /* toasted in useTx */ }
  }

  return (
    <div className="flex flex-col gap-4">
      {/* Presets */}
      <div className="flex flex-col gap-1.5">
        <p className="text-[10px] font-semibold tracking-widest uppercase text-[#8C97B2]">Presets</p>
        <div className="flex flex-wrap gap-2">
          {PRESETS.map(p => (
            <button
              key={p.name}
              type="button"
              onClick={() => applyPreset(p)}
              className="px-3 py-1.5 rounded-lg text-xs font-medium bg-[#1F2A47] text-[#8C97B2] hover:bg-[#A9BDF0]/20 hover:text-[#E6EBF5] transition-colors"
            >
              {p.name}
            </button>
          ))}
        </div>
      </div>

      <Divider />

      {/* Address (new only) */}
      {isNew && (
        <Input
          label="Agent wallet address"
          placeholder="0x…"
          value={form.address}
          onChange={e => setF('address', e.target.value)}
          error={errors.address}
        />
      )}
      {!isNew && (
        <p className="text-xs text-[#8C97B2]">
          Editing policy for <span className="font-mono text-[#C3D1F5]">{formatAddr(agent.address)}</span>
        </p>
      )}

      {/* Label */}
      <Input
        label="Label"
        placeholder="e.g. shopping-bot"
        value={form.label}
        onChange={e => setF('label', e.target.value)}
        error={errors.label}
        maxLength={32}
        hint="Max 32 bytes · shown in logs and the simulator"
      />

      {/* Limits grid */}
      <div className="grid grid-cols-2 gap-3">
        <Input
          label="Max per payment (USDC)"
          value={form.maxPer}
          onChange={e => setF('maxPer', e.target.value)}
          type="number" min="0.000001" step="0.01"
          error={errors.maxPer}
        />
        <Input
          label="Period budget (USDC)"
          value={form.periodLimit}
          onChange={e => setF('periodLimit', e.target.value)}
          type="number" min="0.000001" step="0.01"
          error={errors.periodLimit}
          hint="Bucket refill maximum"
        />
      </div>

      <div className="grid grid-cols-2 gap-3">
        {/* Period select */}
        <div className="flex flex-col gap-1.5">
          <label className="text-[10px] font-semibold tracking-widest uppercase text-[#8C97B2]">
            Period
          </label>
          <select
            className={`w-full px-3 py-2.5 rounded-lg bg-[#0F1730] border text-sm text-[#E6EBF5] focus:outline-none focus:border-[#A9BDF0] transition-colors ${
              errors.periodSecs ? 'border-[#F2A0A0]' : 'border-[#1F2A47]'
            }`}
            value={form.periodSecs}
            onChange={e => setF('periodSecs', e.target.value)}
          >
            {PERIOD_OPTIONS.map(o => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
          {errors.periodSecs && (
            <span className="text-xs text-[#F2A0A0]">{errors.periodSecs}</span>
          )}
        </div>

        <Input
          label="Lifetime total (USDC)"
          value={form.totalLimit}
          onChange={e => setF('totalLimit', e.target.value)}
          type="number" min="0.000001" step="0.01"
          error={errors.totalLimit}
          hint="Cumulative cap across all payments"
        />
      </div>

      {/* Expiry */}
      <Input
        label="Expires at"
        type="datetime-local"
        value={form.expiresAt}
        onChange={e => setF('expiresAt', e.target.value)}
        error={errors.expiresAt}
        hint="Must be in the future and within 365 days"
      />

      {/* Payee allowlist */}
      <label className="flex items-center gap-2 text-sm text-[#E6EBF5] cursor-pointer select-none">
        <input
          type="checkbox"
          checked={form.payeeRestricted}
          onChange={e => setF('payeeRestricted', e.target.checked)}
          className="accent-[#A9BDF0]"
        />
        Require payee allowlist
        <span className="text-xs text-[#8C97B2]">(agent can only pay pre-approved addresses)</span>
      </label>

      <Divider />

      <div className="flex gap-2">
        <Button loading={isPending} onClick={() => { void handleSubmit() }}>
          {isNew ? 'Add agent' : 'Save changes'}
        </Button>
        <Button variant="ghost" onClick={onSuccess}>Cancel</Button>
      </div>
    </div>
  )
}
