import { useState } from 'react'
import { isAddress } from 'viem'
import { useAccount, useReadContract } from 'wagmi'
import { accountAbi } from '../lib/abis'
import { useNetwork } from '../hooks/useNetwork'
import { useTxFull } from '../hooks/useTx'
import { useAccountData } from '../hooks/useAccountData'
import { useAgentList } from '../hooks/useAgents'
import { usePayeeLogs } from '../hooks/usePayeeLogs'
import { formatUsdc, parseUsdc, formatAddr } from '../lib/format'
import { Button, Input } from './Ui'

interface Props {
  accountAddress: `0x${string}`
}

export function PayeesPanel({ accountAddress }: Props) {
  const { address } = useAccount()
  const { chainId } = useNetwork()
  const { owner, createdAtBlock } = useAccountData(accountAddress)
  const isOwner = !!(address && owner && address.toLowerCase() === owner.toLowerCase())
  const { agents: agentAddrs } = useAgentList(accountAddress)

  const { payees, loading } = usePayeeLogs(accountAddress, createdAtBlock)
  const { send, isPending } = useTxFull(chainId, () => {})

  const [selectedAgent, setSelectedAgent] = useState<`0x${string}` | ''>('')
  const [showAdd, setShowAdd] = useState(false)
  const [payeeAddr, setPayeeAddr] = useState('')
  const [cap, setCap] = useState('0')
  const [allowed, setAllowed] = useState(true)

  const filteredPayees = selectedAgent
    ? payees.filter(p => p.agent.toLowerCase() === selectedAgent.toLowerCase())
    : payees

  async function handleSetPayee() {
    if (!isAddress(payeeAddr) || !selectedAgent || !chainId) return
    try {
      await send(
        {
          address: accountAddress,
          abi: accountAbi,
          functionName: 'setPayee',
          args: [selectedAgent, payeeAddr, allowed, parseUsdc(cap)],
          chainId,
        },
        'Set payee rule'
      )
      setShowAdd(false)
      setPayeeAddr('')
      setCap('0')
    } catch { /* toasted in useTx */ }
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <h2 className="font-semibold text-lg text-[#E6EBF5]" style={{ fontFamily: "'DM Sans', sans-serif" }}>
          Payee Rules
        </h2>
        {isOwner && agentAddrs && agentAddrs.length > 0 && (
          <Button size="sm" variant="secondary" onClick={() => setShowAdd(v => !v)}>
            + Add rule
          </Button>
        )}
      </div>

      {/* Agent filter */}
      {agentAddrs && agentAddrs.length > 0 && (
        <div className="flex flex-wrap gap-2">
          <button
            onClick={() => setSelectedAgent('')}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
              selectedAgent === '' ? 'bg-[#A9BDF0] text-white' : 'bg-[#1F2A47] text-[#8C97B2] hover:text-[#E6EBF5]'
            }`}
          >
            All agents
          </button>
          {agentAddrs.map(a => (
            <button
              key={a}
              onClick={() => setSelectedAgent(a)}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium font-mono transition-colors ${
                selectedAgent === a ? 'bg-[#A9BDF0] text-white' : 'bg-[#1F2A47] text-[#8C97B2] hover:text-[#E6EBF5]'
              }`}
            >
              {formatAddr(a)}
            </button>
          ))}
        </div>
      )}

      {showAdd && isOwner && (
        <div className="rounded-[20px] border border-[#A9BDF0]/30 bg-[#121B33] p-5 flex flex-col gap-4">
          <p className="text-sm font-medium text-[#E6EBF5]">Add / update payee rule</p>
          <div className="flex flex-col gap-1.5">
            <label className="text-[10px] font-semibold tracking-widest uppercase text-[#8C97B2]">Agent</label>
            <select
              className="w-full px-3 py-2.5 rounded-lg bg-[#0F1730] border border-[#1F2A47] text-sm text-[#E6EBF5] focus:outline-none focus:border-[#A9BDF0]"
              value={selectedAgent}
              onChange={e => setSelectedAgent(e.target.value as `0x${string}`)}
            >
              <option value="">— select agent —</option>
              {agentAddrs?.map(a => <option key={a} value={a}>{formatAddr(a)}</option>)}
            </select>
          </div>
          <Input
            label="Payee address"
            placeholder="0x…"
            value={payeeAddr}
            onChange={e => setPayeeAddr(e.target.value)}
          />
          <div className="grid grid-cols-2 gap-3">
            <Input
              label="Cumulative cap (USDC, 0 = unlimited)"
              value={cap}
              onChange={e => setCap(e.target.value)}
              type="number" min="0" step="0.01"
              hint="Total across all payments"
            />
            <div className="flex flex-col gap-1.5">
              <label className="text-[10px] font-semibold tracking-widest uppercase text-[#8C97B2]">Permission</label>
              <div className="flex gap-2">
                <button
                  onClick={() => setAllowed(true)}
                  className={`flex-1 py-2.5 rounded-lg text-sm font-medium transition-colors ${
                    allowed ? 'bg-[#8FE3C0]/10 text-[#8FE3C0] border border-[#8FE3C0]/30' : 'bg-[#1F2A47] text-[#8C97B2]'
                  }`}
                >
                  Allow
                </button>
                <button
                  onClick={() => setAllowed(false)}
                  className={`flex-1 py-2.5 rounded-lg text-sm font-medium transition-colors ${
                    !allowed ? 'bg-[#F2A0A0]/10 text-[#F2A0A0] border border-[#F2A0A0]/30' : 'bg-[#1F2A47] text-[#8C97B2]'
                  }`}
                >
                  Block
                </button>
              </div>
            </div>
          </div>
          <div className="flex gap-2">
            <Button
              loading={isPending}
              disabled={!selectedAgent || !isAddress(payeeAddr)}
              onClick={() => { void handleSetPayee() }}
            >
              Save rule
            </Button>
            <Button variant="ghost" onClick={() => setShowAdd(false)}>Cancel</Button>
          </div>
        </div>
      )}

      {loading && (
        <div className="rounded-[20px] border border-[#1F2A47] bg-[#121B33] p-8 text-center">
          <p className="text-[#8C97B2] text-sm">Loading payee rules…</p>
        </div>
      )}

      {!loading && filteredPayees.length === 0 && (
        <div className="rounded-[20px] border border-[#1F2A47] bg-[#121B33] p-8 text-center">
          <p className="text-[#8C97B2] text-sm">
            No payee rules yet. Agents in open mode can pay any address that isn&apos;t blocked,
            within their limits. Agents in allowlist mode can&apos;t pay anyone until you add a rule.
          </p>
        </div>
      )}

      {!loading && filteredPayees.length > 0 && (
        <div className="rounded-[20px] border border-[#1F2A47] bg-[#121B33] overflow-hidden divide-y divide-[#1F2A47]">
          {filteredPayees.map(({ agent, payee }) => (
            <PayeeRow
              key={`${agent}-${payee}`}
              accountAddress={accountAddress}
              agent={agent}
              payee={payee}
              isOwner={isOwner}
              send={send}
              isPending={isPending}
            />
          ))}
        </div>
      )}
    </div>
  )
}

function PayeeRow({
  accountAddress, agent, payee, isOwner, send, isPending,
}: {
  accountAddress: `0x${string}`
  agent: `0x${string}`
  payee: `0x${string}`
  isOwner: boolean
  send: ReturnType<typeof useTxFull>['send']
  isPending: boolean
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

  async function handleBlock(blocked: boolean) {
    if (!chainId) return
    try {
      await send(
        {
          address: accountAddress,
          abi: accountAbi,
          functionName: 'setPayeeBlocked',
          args: [agent, payee, blocked],
          chainId,
        },
        blocked ? 'Block payee' : 'Unblock payee'
      )
    } catch { /* toasted in useTx */ }
  }

  return (
    <div className="px-4 py-3 flex items-center justify-between gap-4 flex-wrap">
      <div className="flex flex-col gap-0.5 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${
            rule?.blocked
              ? 'bg-[#F2A0A0]/10 text-[#F2A0A0]'
              : rule?.allowed
              ? 'bg-[#8FE3C0]/10 text-[#8FE3C0]'
              : 'bg-[#1F2A47] text-[#8C97B2]'
          }`}>
            {rule?.blocked ? 'Blocked' : rule?.allowed ? 'Allowed' : 'Unlisted'}
          </span>
          <span className="text-xs text-[#8C97B2]">
            Agent: <span className="font-mono text-[#C3D1F5]">{formatAddr(agent)}</span>
          </span>
        </div>
        <span className="font-mono text-sm text-[#E6EBF5]">{formatAddr(payee)}</span>
        {/* "spent / cap" — cumulative across all payments */}
        {rule && rule.cap > 0n && (
          <span className="text-xs text-[#8C97B2] tabular-nums">
            {formatUsdc(rule.spent)} / {formatUsdc(rule.cap)} USDC spent
          </span>
        )}
        {rule && rule.cap === 0n && rule.spent > 0n && (
          <span className="text-xs text-[#8C97B2] tabular-nums">
            {formatUsdc(rule.spent)} USDC spent · no cap
          </span>
        )}
      </div>

      {isOwner && (
        <div className="flex gap-2">
          {rule?.blocked ? (
            <Button size="sm" variant="ghost" loading={isPending} onClick={() => { void handleBlock(false) }}>
              Unblock
            </Button>
          ) : (
            <Button size="sm" variant="danger" loading={isPending} onClick={() => { void handleBlock(true) }}>
              Block
            </Button>
          )}
        </div>
      )}
    </div>
  )
}
