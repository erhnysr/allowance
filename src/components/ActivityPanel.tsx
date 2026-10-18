import { useState } from 'react'
import { useReadContract } from 'wagmi'
import { accountAbi } from '../lib/abis'
import { useNetwork } from '../hooks/useNetwork'
import { useAgentList, useAgentDetails } from '../hooks/useAgents'
import { formatUsdc, formatAddr, formatTimestamp, decodeRef } from '../lib/format'
import { explorerBlockUrl, explorerAddressUrl } from '../lib/networks'
import { toAgentInfo, type RawAgentResult } from '../lib/agent'
import { Skeleton } from './Ui'
import { ExternalLink, ArrowUpRight, ArrowDownLeft } from 'lucide-react'

interface Props { accountAddress: `0x${string}` }

const KIND_FUNDED = 0
const KIND_WITHDRAWN = 1
const KIND_PAID = 2

type FilterKind = 'all' | 'payments' | 'funding' | 'withdrawals'

const FILTERS: { id: FilterKind; label: string }[] = [
  { id: 'all',          label: 'All' },
  { id: 'payments',     label: 'Payments' },
  { id: 'funding',      label: 'Funding' },
  { id: 'withdrawals',  label: 'Withdrawals' },
]

export function ActivityPanel({ accountAddress }: Props) {
  const { chainId, net } = useNetwork()
  const [filter, setFilter] = useState<FilterKind>('all')

  const { data, isLoading } = useReadContract({
    address: accountAddress,
    abi: accountAbi,
    functionName: 'recentActivity',
    chainId: chainId as number,
    query: { enabled: !!chainId, refetchInterval: 15_000 },
  })

  // Load agent list + details so we can show labels in activity rows
  const { agents: agentAddrs } = useAgentList(accountAddress)
  const { data: agentDetails } = useAgentDetails(accountAddress, agentAddrs ?? [])

  // Build a map: lowercased address → label (falls back to formatAddr)
  const agentLabelMap = new Map<string, string>()
  if (agentAddrs && agentDetails) {
    agentAddrs.forEach((addr, idx) => {
      const raw = agentDetails[idx]?.result as RawAgentResult | undefined
      if (raw) {
        const info = toAgentInfo(addr, raw)
        agentLabelMap.set(addr.toLowerCase(), info.label || formatAddr(addr))
      }
    })
  }

  const all = (data ?? []).slice().reverse() as Array<{
    kind: number
    agent: `0x${string}`
    counterparty: `0x${string}`
    amount: bigint
    timestamp: bigint
    blockNumber: bigint
    ref: `0x${string}`
  }>

  const entries = all.filter(e => {
    if (filter === 'payments')    return e.kind === KIND_PAID
    if (filter === 'funding')     return e.kind === KIND_FUNDED
    if (filter === 'withdrawals') return e.kind === KIND_WITHDRAWN
    return true
  })

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <h2 className="font-medium text-lg text-[#E6EBF5]">Activity</h2>

        {/* Segmented pill filter */}
        <div className="flex gap-0.5 bg-[#0F1730] border border-[#1F2A47] rounded-full p-1">
          {FILTERS.map(f => (
            <button
              key={f.id}
              onClick={() => setFilter(f.id)}
              className={`px-3 py-1 rounded-full text-xs font-medium transition-colors ${
                filter === f.id
                  ? 'bg-[#18233F] text-[#E6EBF5]'
                  : 'text-[#8C97B2] hover:text-[#C3D1F5]'
              }`}
            >
              {f.label}
            </button>
          ))}
        </div>
      </div>

      {isLoading && (
        <div className="flex flex-col gap-2">
          {[0, 1, 2].map(i => <Skeleton key={i} className="h-14 w-full rounded-xl" />)}
        </div>
      )}

      {!isLoading && entries.length === 0 && (
        <div className="rounded-[20px] border border-[#1F2A47] bg-[#121B33] p-8 text-center">
          <p className="text-[#8C97B2] text-sm">No activity yet.</p>
        </div>
      )}

      {entries.length > 0 && (
        <div className="rounded-[20px] border border-[#1F2A47] bg-[#121B33] overflow-hidden divide-y divide-[#1F2A47]">
          {entries.map((e, i) => (
            <ActivityRow key={i} entry={e} chainId={chainId} net={net} agentLabelMap={agentLabelMap} />
          ))}
        </div>
      )}
    </div>
  )
}

function ActivityRow({
  entry: e,
  chainId,
  net,
  agentLabelMap,
}: {
  entry: {
    kind: number
    agent: `0x${string}`
    counterparty: `0x${string}`
    amount: bigint
    timestamp: bigint
    blockNumber: bigint
    ref: `0x${string}`
  }
  chainId: number | undefined
  net: { explorerUrl: string } | undefined
  agentLabelMap: Map<string, string>
}) {
  const ref = decodeRef(e.ref)
  const ts = Number(e.timestamp)
  const blockNum = Number(e.blockNumber)
  const counterpartyUrl = (net && chainId) ? explorerAddressUrl(chainId, e.counterparty) : undefined
  const blockUrl = (net && chainId) ? explorerBlockUrl(chainId, blockNum) : undefined

  const isPaid = e.kind === KIND_PAID
  const isFunded = e.kind === KIND_FUNDED
  const isWithdrawn = e.kind === KIND_WITHDRAWN
  const hasCounter = e.counterparty !== '0x0000000000000000000000000000000000000000'
  const hasAgent = e.agent !== '0x0000000000000000000000000000000000000000'

  // Use the agent's label from the map, fallback to formatAddr
  const agentLabel = hasAgent
    ? (agentLabelMap.get(e.agent.toLowerCase()) ?? formatAddr(e.agent))
    : ''

  // Round icon chip
  const chipBg = isPaid ? '#15283A' : isFunded ? '#18233F' : '#18233F'
  const chipColor = isPaid ? '#8FE3C0' : isFunded ? '#A9BDF0' : '#F2C27B'
  const ChipIcon = isPaid ? ArrowUpRight : isFunded ? ArrowDownLeft : ArrowUpRight

  const amountColor = isPaid ? 'text-[#F2A0A0]' : isFunded ? 'text-[#8FE3C0]' : 'text-[#F2C27B]'
  const amountPrefix = isPaid || isWithdrawn ? '-' : '+'

  // Description — no raw addresses with underscores
  let description = ''
  if (isPaid && hasAgent && hasCounter) {
    description = `${agentLabel} paid ${formatAddr(e.counterparty)}`
  } else if (isPaid && hasCounter) {
    description = `paid ${formatAddr(e.counterparty)}`
  } else if (isFunded) {
    description = `Account funded`
  } else if (isWithdrawn && hasCounter) {
    description = `Withdrawn to ${formatAddr(e.counterparty)}`
  }

  return (
    <div className="px-5 py-3.5 flex items-center justify-between gap-4">
      <div className="flex items-center gap-3 min-w-0">
        {/* Round icon chip */}
        <span
          className="w-8 h-8 rounded-full flex items-center justify-center shrink-0"
          style={{ background: chipBg }}
        >
          <ChipIcon size={14} style={{ color: chipColor }} />
        </span>

        <div className="min-w-0">
          <div className="flex items-center gap-1.5 flex-wrap">
            {hasCounter && counterpartyUrl ? (
              <a href={counterpartyUrl} target="_blank" rel="noopener noreferrer"
                className="text-sm text-[#C3D1F5] hover:text-[#A9BDF0] transition-colors">
                {description}
              </a>
            ) : (
              <span className="text-sm text-[#C3D1F5]">{description}</span>
            )}
          </div>
          <div className="flex items-center gap-2 mt-0.5 text-xs text-[#8C97B2]">
            <span>{ts ? formatTimestamp(ts) : `Block ${blockNum}`}</span>
            {blockUrl && (
              <a href={blockUrl} target="_blank" rel="noopener noreferrer"
                className="inline-flex items-center gap-0.5 hover:text-[#A9BDF0] transition-colors">
                <ExternalLink size={10} />
              </a>
            )}
          </div>
        </div>
      </div>

      {/* Right: amount + ref */}
      <div className="flex flex-col items-end gap-0.5 shrink-0">
        {e.amount > 0n && (
          <span
            className={`tabular-nums font-medium text-sm ${amountColor}`}
            style={{ fontFamily: "'DM Mono', monospace" }}
          >
            {amountPrefix}{formatUsdc(e.amount)}
          </span>
        )}
        {ref && (
          <span
            className="text-xs text-[#8C97B2] font-mono"
            style={{ fontFamily: "'DM Mono', monospace" }}
          >
            {ref}
          </span>
        )}
      </div>
    </div>
  )
}
