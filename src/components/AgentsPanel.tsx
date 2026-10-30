import { useState } from 'react'
import { Plus } from 'lucide-react'
import { useAccount } from 'wagmi'
import { useAgentList, useAgentDetails } from '../hooks/useAgents'
import { useAccountData } from '../hooks/useAccountData'
import { usePayeeLogs } from '../hooks/usePayeeLogs'
import { useNow } from '../hooks/useNow'
import { AgentCard } from './AgentCard'
import { AgentForm } from './AgentForm'
import { Button, Skeleton } from './Ui'
import { toAgentInfo, type AgentInfo, type RawAgentResult } from '../lib/agent'

interface Props {
  accountAddress: `0x${string}`
}

function ErrorCard({ onRetry }: { onRetry: () => void }) {
  return (
    <div className="rounded-[20px] border border-[#5B3440] bg-[#1E1A2E] px-6 py-5 flex items-center justify-between gap-4">
      <p className="text-sm text-[#F2A0A0]">Couldn't load from Arc.</p>
      <Button size="sm" variant="secondary" onClick={onRetry}>Retry</Button>
    </div>
  )
}

export function AgentsPanel({ accountAddress }: Props) {
  const { address } = useAccount()
  const { owner, createdAtBlock } = useAccountData(accountAddress)
  const isOwner = !!(address && owner && address.toLowerCase() === owner.toLowerCase())
  const nowSec = useNow()

  const { agents: agentAddrs, isLoading, isError, refetch } = useAgentList(accountAddress)
  const { data: agentDetails, isError: detailsError, refetch: refetchDetails } = useAgentDetails(
    accountAddress,
    agentAddrs ?? [],
  )
  const { payees } = usePayeeLogs(accountAddress, createdAtBlock)

  const [showNew, setShowNew] = useState(false)

  const agents: AgentInfo[] = (agentAddrs ?? []).flatMap((addr, i) => {
    const r = agentDetails?.[i]?.result as RawAgentResult | undefined
    if (!r) return []
    return [toAgentInfo(addr, r)]
  })

  // Item 3: live = active AND not expired
  const liveCount = agents.filter(a => a.active && Number(a.expiresAt) > nowSec).length
  const revokedCount = agents.filter(a => !a.active).length

  // Build map: agentAddress → payee addresses
  const payeesByAgent = new Map<string, `0x${string}`[]>()
  for (const { agent, payee } of payees) {
    const key = agent.toLowerCase()
    if (!payeesByAgent.has(key)) payeesByAgent.set(key, [])
    payeesByAgent.get(key)!.push(payee)
  }

  function handleChanged() {
    void refetch()
    void refetchDetails()
  }

  const hasError = isError || (agentAddrs && agentAddrs.length > 0 && detailsError)

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <h2 className="font-medium text-lg text-[#E6EBF5]">
            Agents
          </h2>
          {agents.length > 0 && (
            <span className="text-sm text-[#8C97B2]">
              {liveCount} live{revokedCount > 0 ? ` · ${revokedCount} revoked` : ''}
            </span>
          )}
        </div>
        {isOwner && (
          <Button size="sm" variant="secondary" onClick={() => setShowNew(v => !v)}>
            <Plus size={13} /> Add agent
          </Button>
        )}
      </div>

      {/* New agent form */}
      {showNew && isOwner && (
        <div className="rounded-[20px] border border-[#2A3658] bg-[#121B33] p-5">
          <p className="text-sm font-medium text-[#E6EBF5] mb-4">New agent policy</p>
          <AgentForm
            accountAddress={accountAddress}
            onSuccess={() => {
              setShowNew(false)
              handleChanged()
            }}
          />
        </div>
      )}

      {isLoading && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {[0, 1].map(i => <Skeleton key={i} className="h-48 w-full rounded-2xl" />)}
        </div>
      )}

      {!isLoading && hasError && (
        <ErrorCard onRetry={handleChanged} />
      )}

      {!isLoading && !hasError && agents.length === 0 && (
        <div className="rounded-[20px] border border-[#1F2A47] bg-[#121B33] p-10 text-center">
          <p className="text-[#8C97B2] text-sm">No agents configured yet.</p>
          {isOwner && (
            <p className="text-xs text-[#8C97B2] mt-1">Click "Add agent" to define a spending policy for an AI agent.</p>
          )}
        </div>
      )}

      {!hasError && agents.length > 0 && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {agents.map(agent => (
            <AgentCard
              key={agent.address}
              accountAddress={accountAddress}
              agent={agent}
              isOwner={isOwner}
              payeeAddresses={payeesByAgent.get(agent.address.toLowerCase()) ?? []}
              onChanged={handleChanged}
            />
          ))}
        </div>
      )}

      {agents.length > 0 && (
        <p className="text-xs text-[#8C97B2] text-right">{agentAddrs?.length ?? 0} / 20 agent slots used</p>
      )}
    </div>
  )
}
