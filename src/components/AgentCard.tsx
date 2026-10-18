import { useState } from 'react'
import { accountAbi } from '../lib/abis'
import { useNetwork } from '../hooks/useNetwork'
import { useTxFull } from '../hooks/useTx'
import { useNow } from '../hooks/useNow'
import { useReadContract } from 'wagmi'
import {
  formatUsdc, formatAddr, formatDuration, formatExpiryCountdown
} from '../lib/format'
import { computeAvailable } from '../lib/bucket'
import { Button, Divider } from './Ui'
import { AgentForm } from './AgentForm'

import type { AgentInfo } from '../lib/agent'
export type { AgentInfo } from '../lib/agent'

interface Props {
  accountAddress: `0x${string}`
  agent: AgentInfo
  isOwner: boolean
  payeeAddresses: `0x${string}`[]
  onChanged: () => void
}

// SVG semicircle gauge
// Path: M20 90 A70 70 0 0 1 160 90  (pathLength="100")
const GAUGE_PATH = 'M20 90 A70 70 0 0 1 160 90'

function SemiGauge({
  pct,
  available,
  periodLimit,
  revoked,
}: {
  pct: number
  available: bigint
  periodLimit: bigint
  revoked: boolean
}) {
  const clampedPct = Math.min(100, Math.max(0, pct))
  return (
    <div className="flex flex-col items-center">
      <div className="relative" style={{ width: 180, height: 100 }}>
        <svg width="180" height="100" viewBox="0 0 180 100" fill="none">
          {/* Track */}
          <path
            d={GAUGE_PATH}
            stroke="#222D4C"
            strokeWidth="10"
            strokeLinecap="round"
            fill="none"
          />
          {/* Fill */}
          {!revoked && clampedPct > 0 && (
            <path
              d={GAUGE_PATH}
              stroke="#A9BDF0"
              strokeWidth="10"
              strokeLinecap="round"
              fill="none"
              pathLength="100"
              strokeDasharray={`${clampedPct} 100`}
            />
          )}
          {/* Revoked: dashed track */}
          {revoked && (
            <path
              d={GAUGE_PATH}
              stroke="#2A3658"
              strokeWidth="10"
              strokeLinecap="round"
              strokeDasharray="6 6"
              fill="none"
            />
          )}
        </svg>

        {/* Centre text */}
        <div className="absolute inset-0 flex flex-col items-center justify-end pb-1">
          {revoked ? (
            <span
              className="text-[#8C97B2] leading-none"
              style={{ fontFamily: "'DM Mono', monospace", fontSize: '1.75rem', fontWeight: 300 }}
            >
              —
            </span>
          ) : (
            <span
              className="tabular-nums text-[#E6EBF5] leading-none"
              style={{ fontFamily: "'DM Mono', monospace", fontSize: '1.75rem', fontWeight: 300 }}
            >
              {formatUsdc(available)}
            </span>
          )}
          <span className="text-xs text-[#8C97B2] mt-0.5">
            of {formatUsdc(periodLimit)} USDC
          </span>
        </div>
      </div>
    </div>
  )
}

export function AgentCard({ accountAddress, agent, isOwner, payeeAddresses, onChanged }: Props) {
  const [showEdit, setShowEdit] = useState(false)
  const [confirmRemove, setConfirmRemove] = useState(false)
  const { chainId } = useNetwork()

  const { send: sendRevoke, isPending: isRevoking } = useTxFull(chainId, onChanged)
  const { send: sendRemove, isPending: isRemoving } = useTxFull(chainId, onChanged)

  const nowSec = useNow()

  const periodAvailable = computeAvailable(
    agent.bucket, agent.lastRefill, agent.periodLimit, agent.periodSeconds, nowSec
  )

  const totalRemaining = agent.totalLimit > 0n ? agent.totalLimit - agent.totalSpent : periodAvailable
  const displayAvailable = agent.totalLimit > 0n
    ? (totalRemaining < periodAvailable ? totalRemaining : periodAvailable)
    : periodAvailable

  const isFull = periodAvailable >= agent.periodLimit

  let timeUntilFull: string | null = null
  if (!isFull && agent.periodSeconds > 0n && agent.periodLimit > 0n) {
    const deficit = agent.periodLimit - periodAvailable
    const secs = Number((deficit * agent.periodSeconds) / agent.periodLimit)
    if (secs > 0) {
      const h = Math.floor(secs / 3600)
      const m = Math.floor((secs % 3600) / 60)
      timeUntilFull = h > 0 ? `Full in ${h}h ${m}m` : `Full in ${m}m`
    }
  }

  const expiresAt = Number(agent.expiresAt)
  const expired = expiresAt > 0 && expiresAt < Number(nowSec)
  const revoked = !agent.active

  const gaugePct = agent.periodLimit > 0n
    ? Math.min(100, Number((periodAvailable * 10000n) / agent.periodLimit) / 100)
    : 0

  const lifetimePct = agent.totalLimit > 0n
    ? Number((agent.totalSpent * 10000n) / agent.totalLimit) / 100
    : null
  const lifetimeAmber = lifetimePct !== null && lifetimePct >= 80

  async function handleRevoke() {
    try {
      await sendRevoke(
        { address: accountAddress, abi: accountAbi, functionName: 'revokeAgent', args: [agent.address], chainId },
        'Revoke agent'
      )
    } catch { /* toasted in useTx */ }
  }

  async function handleRemove() {
    try {
      await sendRemove(
        { address: accountAddress, abi: accountAbi, functionName: 'removeAgent', args: [agent.address], chainId },
        'Remove agent'
      )
    } catch { /* toasted in useTx */ }
  }

  // Status pill
  const statusPill = revoked
    ? <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-medium bg-[#1F2A47] text-[#8C97B2]"><span className="w-1.5 h-1.5 rounded-full bg-[#8C97B2] inline-block" />Revoked</span>
    : expired
    ? <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-medium bg-[#18233F] text-[#F2C27B]"><span className="w-1.5 h-1.5 rounded-full bg-[#F2C27B] inline-block" />Expired</span>
    : <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-medium bg-[#15283A] text-[#8FE3C0] border border-[#1F4A47]"><span className="w-1.5 h-1.5 rounded-full bg-[#8FE3C0] inline-block" />Live</span>

  return (
    <div className="rounded-[20px] border border-[#1F2A47] bg-[#121B33] overflow-hidden">
      {/* Header */}
      <div className="px-5 pt-5 pb-4 flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h4 className="font-medium text-sm text-[#E6EBF5] mb-0.5">
            {agent.label || 'Unnamed agent'}
          </h4>
          <div className="flex items-center gap-2 flex-wrap">
            <span
              className="font-mono text-xs text-[#8C97B2]"
              style={{ fontFamily: "'DM Mono', monospace" }}
            >
              {formatAddr(agent.address)}
            </span>
            {agent.payeeRestricted && (
              <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-[#1F2A47] text-[#8C97B2]">
                allowlist
              </span>
            )}
          </div>
        </div>
        <div className="shrink-0">{statusPill}</div>
      </div>

      {/* Semicircle gauge */}
      <div className="px-5 pb-2 flex flex-col items-center">
        <SemiGauge
          pct={gaugePct}
          available={displayAvailable}
          periodLimit={agent.periodLimit}
          revoked={revoked}
        />

        {revoked ? (
          <p className="text-xs text-[#8C97B2] text-center mt-1">
            Signed intents from this key are rejected until you re-enable it.
          </p>
        ) : (
          <div className="text-center text-xs text-[#8C97B2] mt-1">
            <p>
              Refills {formatUsdc(agent.periodLimit)} per {formatDuration(Number(agent.periodSeconds))} · bursts up to {formatUsdc(agent.periodLimit)}
            </p>
            {timeUntilFull && <p className="mt-0.5">{timeUntilFull}</p>}
          </div>
        )}
      </div>

      {/* Three inset tiles: Per payment / Lifetime / Expires */}
      {!revoked && (
        <div className="px-4 pb-4 grid grid-cols-3 gap-2">
          <div className="rounded-xl bg-[#0F1730] px-3 py-2.5">
            <p className="text-[10px] text-[#8C97B2] font-medium tracking-wider uppercase mb-1">Per payment</p>
            <p
              className="tabular-nums text-sm text-[#C3D1F5] font-mono"
              style={{ fontFamily: "'DM Mono', monospace" }}
            >
              ≤ {formatUsdc(agent.maxPerPayment)}
            </p>
          </div>
          <div className="rounded-xl bg-[#0F1730] px-3 py-2.5">
            <p className="text-[10px] text-[#8C97B2] font-medium tracking-wider uppercase mb-1">Lifetime</p>
            <p
              className={`tabular-nums text-sm font-mono ${lifetimeAmber ? 'text-[#F2C27B]' : 'text-[#C3D1F5]'}`}
              style={{ fontFamily: "'DM Mono', monospace" }}
            >
              {formatUsdc(agent.totalSpent)}/{formatUsdc(agent.totalLimit)}
            </p>
          </div>
          <div className="rounded-xl bg-[#0F1730] px-3 py-2.5">
            <p className="text-[10px] text-[#8C97B2] font-medium tracking-wider uppercase mb-1">Expires</p>
            <p
              className={`text-sm font-mono ${expired ? 'text-[#F2A0A0]' : 'text-[#C3D1F5]'}`}
              style={{ fontFamily: "'DM Mono', monospace" }}
            >
              {expiresAt > 0 ? formatExpiryCountdown(expiresAt) : '—'}
            </p>
          </div>
        </div>
      )}

      {/* Payee rules */}
      {payeeAddresses.length > 0 && !revoked && (
        <div className="border-t border-[#1F2A47]">
          <div className="px-5 pt-3 pb-1">
            <p className="text-[10px] font-medium tracking-widest uppercase text-[#8C97B2] mb-2">Payee Rules</p>
          </div>
          {payeeAddresses.map(p => (
            <PayeeRuleRow
              key={p}
              accountAddress={accountAddress}
              agent={agent.address}
              payee={p}
            />
          ))}
          <div className="pb-3" />
        </div>
      )}

      {/* Owner actions */}
      {isOwner && !confirmRemove && (
        <div className="border-t border-[#1F2A47] px-5 py-3 flex items-center gap-2 flex-wrap">
          {revoked ? (
            <Button size="sm" onClick={() => setShowEdit(v => !v)}>
              Re-enable
            </Button>
          ) : (
            <Button size="sm" variant="secondary" onClick={() => setShowEdit(v => !v)}>
              Edit policy
            </Button>
          )}
          {!revoked && (
            <Button size="sm" variant="danger" loading={isRevoking} onClick={() => { void handleRevoke() }}>
              Revoke
            </Button>
          )}
          <Button size="sm" variant="ghost" onClick={() => setConfirmRemove(true)}>
            Remove
          </Button>
        </div>
      )}

      {/* Remove confirm */}
      {isOwner && confirmRemove && (
        <div className="border-t border-[#1F2A47] px-5 py-3">
          <p className="text-xs text-[#E6EBF5] mb-1">
            Remove this agent? Nonces and payee rules are kept onchain; the agent slot is freed.
          </p>
          <div className="flex gap-2 mt-2">
            <Button size="sm" variant="danger" loading={isRemoving} onClick={() => { void handleRemove() }}>
              Confirm remove
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setConfirmRemove(false)}>
              Cancel
            </Button>
          </div>
        </div>
      )}

      {/* Edit / Re-enable form */}
      {showEdit && isOwner && (
        <div className="border-t border-[#1F2A47] px-5 py-4">
          <Divider className="mb-4 -mx-5 w-[calc(100%+2.5rem)]" />
          <AgentForm
            accountAddress={accountAddress}
            agent={agent}
            onSuccess={() => { setShowEdit(false); onChanged() }}
          />
        </div>
      )}
    </div>
  )
}

function PayeeRuleRow({
  accountAddress, agent, payee
}: {
  accountAddress: `0x${string}`
  agent: `0x${string}`
  payee: `0x${string}`
}) {
  const { chainId } = useNetwork()
  const { data: rule } = useReadContract({
    address: accountAddress,
    abi: accountAbi,
    functionName: 'getPayee',
    args: [agent, payee],
    chainId: chainId as number,
    query: { enabled: !!chainId },
  })

  return (
    <div className="px-5 py-1.5 flex items-center justify-between gap-3 text-xs">
      <span className="font-mono text-[#8C97B2]" style={{ fontFamily: "'DM Mono', monospace" }}>{formatAddr(payee)}</span>
      <div className="flex items-center gap-3 text-[#8C97B2] tabular-nums">
        {rule && rule.cap > 0n ? (
          <span className="font-mono" style={{ fontFamily: "'DM Mono', monospace" }}>{formatUsdc(rule.spent)} / {formatUsdc(rule.cap)} USDC</span>
        ) : (
          <span>no cap</span>
        )}
        {rule?.blocked && (
          <span className="text-[#F2A0A0] font-medium">Blocked</span>
        )}
      </div>
    </div>
  )
}
