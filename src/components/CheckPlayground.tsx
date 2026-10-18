import { useState } from 'react'
import { isAddress } from 'viem'
import { useReadContract } from 'wagmi'
import { accountAbi } from '../lib/abis'
import { useAgentList, useAgentDetails } from '../hooks/useAgents'
import { useNetwork } from '../hooks/useNetwork'
import { useAccountData } from '../hooks/useAccountData'
import { useNow } from '../hooks/useNow'
import { parseUsdc, formatUsdc, formatAddr } from '../lib/format'
import { computeAvailable } from '../lib/bucket'
import { toAgentInfo, type AgentInfo, type RawAgentResult } from '../lib/agent'
import { Button, Input } from './Ui'

interface Props { accountAddress: `0x${string}` }

const CHECK_STEPS: { label: string; failCode: number }[] = [
  { label: 'Amount above zero',                                        failCode: 1  },
  { label: 'Account is not frozen',                                    failCode: 2  },
  { label: 'Registered agent',                                         failCode: 3  },
  { label: 'Agent is active (not revoked)',                            failCode: 4  },
  { label: 'Agent has not expired',                                    failCode: 5  },
  { label: 'Valid payee address (non-zero)',                           failCode: 6  },
  { label: 'Payee allowed (not blocked; on allowlist if restricted)',  failCode: 7  },
  { label: 'Within per-payment cap',                                   failCode: 8  },
  { label: 'Within period budget',                                     failCode: 9  },
  { label: 'Within lifetime total',                                    failCode: 10 },
  { label: 'Within payee cap',                                         failCode: 11 },
  { label: 'Account balance sufficient',                               failCode: 12 },
]

export function CheckPlayground({ accountAddress }: Props) {
  const { chainId } = useNetwork()
  const { agents: agentAddrs } = useAgentList(accountAddress)
  const { data: agentDetails } = useAgentDetails(accountAddress, agentAddrs ?? [])
  const { balance, frozen } = useAccountData(accountAddress)
  const nowSec = useNow()

  const [selectedAgentAddr, setSelectedAgentAddr] = useState('')
  const [manualAgentAddr, setManualAgentAddr] = useState('')
  const [payee, setPayee] = useState('')
  const [amount, setAmount] = useState('')
  const [query, setQuery] = useState<{ agent: `0x${string}`; payee: `0x${string}`; amount: bigint } | null>(null)
  const [submitted, setSubmitted] = useState(false)

  const effectiveAgent = selectedAgentAddr || manualAgentAddr

  const { data: reason, isLoading } = useReadContract({
    address: accountAddress,
    abi: accountAbi,
    functionName: 'check',
    args: query ? [query.agent, query.payee, query.amount] : undefined,
    chainId: chainId as number,
    query: { enabled: !!query && !!chainId },
  })

  function handleCheck() {
    if (!isAddress(effectiveAgent) || !isAddress(payee) || !amount) return
    setQuery({ agent: effectiveAgent, payee, amount: parseUsdc(amount) })
    setSubmitted(true)
  }

  const agents: AgentInfo[] = (agentAddrs ?? []).flatMap((addr, i) => {
    const r = agentDetails?.[i]?.result as RawAgentResult | undefined
    if (!r) return []
    return [toAgentInfo(addr, r)]
  })

  const selectedAgent = agents.find(a => a.address.toLowerCase() === effectiveAgent.toLowerCase())

  const periodAvailable = selectedAgent
    ? computeAvailable(selectedAgent.bucket, selectedAgent.lastRefill, selectedAgent.periodLimit, selectedAgent.periodSeconds, nowSec)
    : 0n

  const reasonCode = typeof reason === 'number' ? reason : undefined
  const wouldSucceed = reasonCode === 0

  function buildSteps(code: number): { label: string; pass: boolean; detail?: string; unreached?: boolean }[] {
    const amountRaw = parseUsdc(amount || '0')
    const steps: { label: string; pass: boolean; detail?: string; unreached?: boolean }[] = []

    for (const step of CHECK_STEPS) {
      if (code === step.failCode) {
        let detail: string | undefined
        if (step.failCode === 9 && selectedAgent) {
          detail = `${formatUsdc(amountRaw)} req · ${formatUsdc(periodAvailable)} available`
        } else if (step.failCode === 10 && selectedAgent && selectedAgent.totalLimit > 0n) {
          const left = selectedAgent.totalLimit - selectedAgent.totalSpent
          detail = `${formatUsdc(left)} remaining`
        } else if (step.failCode === 12 && balance !== undefined) {
          detail = `account has ${formatUsdc(balance)} USDC`
        }
        steps.push({ label: step.label, pass: false, detail })
        break
      }
      let detail: string | undefined
      if (step.failCode === 9 && selectedAgent && code === 0) {
        detail = `${formatUsdc(periodAvailable - amountRaw)} left after`
      } else if (step.failCode === 12 && balance !== undefined && code === 0) {
        detail = `${formatUsdc(balance)} USDC`
      }
      steps.push({ label: step.label, pass: true, detail })
    }

    return steps
  }

  const steps = (submitted && !isLoading && reasonCode !== undefined)
    ? buildSteps(reasonCode)
    : []

  function reset() {
    setSubmitted(false)
    setQuery(null)
  }

  return (
    <div className="rounded-[20px] border border-[#1F2A47] bg-[#121B33] overflow-hidden">
      <div className="px-5 pt-5 pb-4">
        <h3 className="font-medium text-sm text-[#E6EBF5] mb-1">Policy simulator</h3>
        <p className="text-xs text-[#8C97B2]">Would this payment go through right now?</p>
      </div>

      <div className="px-5 pb-5 flex flex-col gap-3">
        {/* Agent select */}
        <div className="flex flex-col gap-1.5">
          <label className="text-[10px] font-medium tracking-widest uppercase text-[#8C97B2]">Agent</label>
          <select
            className="w-full px-3.5 py-2.5 rounded-[14px] bg-[#0F1730] border border-[#1F2A47] text-sm text-[#E6EBF5] focus:outline-none focus:border-[#A9BDF0]"
            value={selectedAgentAddr}
            onChange={e => { setSelectedAgentAddr(e.target.value); setManualAgentAddr(''); reset() }}
          >
            <option value="">— select or paste below —</option>
            {agents.map(a => (
              <option key={a.address} value={a.address}>
                {a.label ? `${a.label} · ${formatAddr(a.address)}` : formatAddr(a.address)}
              </option>
            ))}
          </select>
          {!selectedAgentAddr && (
            <input
              className="w-full px-3.5 py-2 rounded-[14px] bg-[#0F1730] border border-[#1F2A47] text-xs text-[#E6EBF5] placeholder-[#8C97B2] focus:outline-none focus:border-[#A9BDF0]"
              placeholder="paste agent address"
              value={manualAgentAddr}
              onChange={e => { setManualAgentAddr(e.target.value); reset() }}
            />
          )}
        </div>

        <Input
          label="Payee"
          placeholder="0x…"
          value={payee}
          onChange={e => { setPayee(e.target.value); reset() }}
        />

        <div className="flex flex-col gap-1.5">
          <label className="text-[10px] font-medium tracking-widest uppercase text-[#8C97B2]">Amount</label>
          <div className="relative">
            <input
              className="w-full px-3.5 py-2.5 pr-16 rounded-[14px] bg-[#0F1730] border border-[#1F2A47] text-sm text-[#E6EBF5] placeholder-[#8C97B2] focus:outline-none focus:border-[#A9BDF0]"
              type="number" min="0.000001" step="0.01" placeholder="0.00"
              value={amount}
              onChange={e => { setAmount(e.target.value); reset() }}
            />
            <span className="absolute right-3.5 top-1/2 -translate-y-1/2 text-xs font-medium text-[#8C97B2]">USDC</span>
          </div>
        </div>

        {/* Result summary */}
        {submitted && !isLoading && reasonCode !== undefined && (
          <div className={`rounded-xl px-4 py-3 text-sm border ${
            wouldSucceed
              ? 'bg-[#13283A] border-[#1F4A47] text-[#8FE3C0]'
              : 'bg-[#1E1A2E] border-[#5B3440] text-[#F2A0A0]'
          }`}>
            <p className="font-medium mb-0.5">{wouldSucceed ? 'Goes through' : 'Would be rejected'}</p>
            {wouldSucceed && selectedAgent && (
              <p className="text-xs opacity-80">
                {formatUsdc(periodAvailable - parseUsdc(amount))} USDC left in this period afterwards.
              </p>
            )}
          </div>
        )}

        <Button
          onClick={() => { void handleCheck() }}
          loading={isLoading}
          disabled={!isAddress(effectiveAgent) || !isAddress(payee) || !amount}
        >
          Simulate payment
        </Button>

        {/* Step checklist */}
        {steps.length > 0 && (
          <div className="flex flex-col gap-1.5 pt-1">
            {steps.map((step, i) => (
              <div key={i} className="flex items-start justify-between gap-2">
                <div className="flex items-start gap-2 min-w-0">
                  <span className={`text-xs mt-0.5 shrink-0 ${step.pass ? 'text-[#8FE3C0]' : 'text-[#F2A0A0]'}`}>
                    {step.pass ? '✓' : '✗'}
                  </span>
                  <span className={`text-xs ${step.pass ? 'text-[#8C97B2]' : 'text-[#F2A0A0]'}`}>{step.label}</span>
                </div>
                {step.detail && (
                  <span
                    className="text-[11px] text-[#8C97B2] shrink-0 font-mono"
                    style={{ fontFamily: "'DM Mono', monospace" }}
                  >
                    {step.detail}
                  </span>
                )}
              </div>
            ))}
          </div>
        )}

        {frozen && (
          <p className="text-xs text-[#9FD3FF] text-center pt-1">Account is currently frozen — all payments blocked.</p>
        )}
      </div>
    </div>
  )
}
