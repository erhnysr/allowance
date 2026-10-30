import { useState } from 'react'
import { ChevronLeft, Snowflake, Flame, AlertTriangle, Settings } from 'lucide-react'
import { erc20Abi, isAddress } from 'viem'
import { useAccount, useReadContract } from 'wagmi'
import { useAccountData } from '../hooks/useAccountData'
import { useTxFull } from '../hooks/useTx'
import { accountAbi } from '../lib/abis'
import { USDC_ADDRESS, explorerAddressUrl } from '../lib/networks'
import { formatUsdc, parseUsdc, formatAddr } from '../lib/format'
import { useNetwork } from '../hooks/useNetwork'
import { Button, Input, AddressChip, Divider, Skeleton } from './Ui'

interface Props {
  accountAddress: `0x${string}`
  onBack: () => void
}

export function AccountHeader({ accountAddress, onBack }: Props) {
  const { address } = useAccount()
  const { chainId, net } = useNetwork()
  const data = useAccountData(accountAddress)
  const isOwner = !!(address && data.owner && address.toLowerCase() === data.owner.toLowerCase())
  const isGuardian = !!(address && data.guardian && address.toLowerCase() === data.guardian.toLowerCase())

  const { send: sendTx, isPending } = useTxFull(chainId, () => { void data.refetch() })

  const [fundAmt, setFundAmt] = useState('')
  const [showFund, setShowFund] = useState(false)
  const [showWithdraw, setShowWithdraw] = useState(false)
  const [withdrawAmt, setWithdrawAmt] = useState('')
  const [withdrawTo, setWithdrawTo] = useState('')
  const [showSettings, setShowSettings] = useState(false)
  const [newGuardian, setNewGuardian] = useState('')
  const [newOwner, setNewOwner] = useState('')

  const explorerUrl = net ? explorerAddressUrl(chainId!, accountAddress) : undefined

  const { data: allowance, refetch: refetchAllowance } = useReadContract({
    address: USDC_ADDRESS,
    abi: erc20Abi,
    functionName: 'allowance',
    args: address ? [address, accountAddress] : undefined,
    chainId: chainId as number,
    query: { enabled: !!address && !!chainId },
  })

  async function handleFund() {
    const amount = parseUsdc(fundAmt)
    if (!amount || !chainId) return
    try {
      if (allowance === undefined || allowance < amount) {
        // send() always waits for the receipt, so fund() only runs after approve confirms
        await sendTx(
          { address: USDC_ADDRESS, abi: erc20Abi, functionName: 'approve', args: [accountAddress, amount], chainId },
          'Approve USDC',
        )
        await refetchAllowance()
      }
      await sendTx(
        { address: accountAddress, abi: accountAbi, functionName: 'fund', args: [amount], chainId },
        'Fund account'
      )
      setFundAmt('')
      setShowFund(false)
      void data.refetch()
    } catch { /* handled */ }
  }

  async function handleWithdraw() {
    const amount = parseUsdc(withdrawAmt)
    const to = (withdrawTo.trim() || data.owner || '') as `0x${string}`
    if (!amount || !isAddress(to) || !chainId) return
    try {
      await sendTx(
        { address: accountAddress, abi: accountAbi, functionName: 'withdraw', args: [to, amount], chainId },
        'Withdraw USDC'
      )
      setWithdrawAmt('')
      setShowWithdraw(false)
      void data.refetch()
    } catch { /* handled */ }
  }

  async function handleFreeze() {
    if (!chainId) return
    try {
      await sendTx({ address: accountAddress, abi: accountAbi, functionName: 'freeze', chainId }, 'Freeze account')
      void data.refetch()
    } catch { /* toasted in useTx */ }
  }

  async function handleUnfreeze() {
    if (!chainId) return
    try {
      await sendTx({ address: accountAddress, abi: accountAbi, functionName: 'unfreeze', chainId }, 'Unfreeze account')
      void data.refetch()
    } catch { /* toasted in useTx */ }
  }

  async function handleSetGuardian() {
    const g = (newGuardian.trim() || '0x0000000000000000000000000000000000000000') as `0x${string}`
    if (newGuardian.trim() && !isAddress(newGuardian.trim())) return
    if (!chainId) return
    try {
      await sendTx(
        { address: accountAddress, abi: accountAbi, functionName: 'setGuardian', args: [g], chainId },
        'Set guardian'
      )
      setNewGuardian('')
      void data.refetch()
    } catch { /* toasted in useTx */ }
  }

  async function handleTransferOwnership() {
    if (!isAddress(newOwner) || !chainId) return
    try {
      await sendTx(
        { address: accountAddress, abi: accountAbi, functionName: 'transferOwnership', args: [newOwner], chainId },
        'Start ownership transfer'
      )
      setNewOwner('')
      void data.refetch()
    } catch { /* toasted in useTx */ }
  }

  async function handleAcceptOwnership() {
    if (!chainId) return
    try {
      await sendTx(
        { address: accountAddress, abi: accountAbi, functionName: 'acceptOwnership', chainId },
        'Accept ownership'
      )
      void data.refetch()
    } catch { /* toasted in useTx */ }
  }

  const isPendingOwner = !!(address && data.pendingOwner &&
    address.toLowerCase() === data.pendingOwner.toLowerCase())

  const frozen = data.frozen
  const canFreeze = isOwner || isGuardian

  return (
    <div className="flex flex-col gap-3">
      {/* Back + page title */}
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <button
            onClick={onBack}
            className="flex items-center gap-1 text-[#8C97B2] hover:text-[#E6EBF5] text-sm transition-colors"
          >
            <ChevronLeft size={15} /> All accounts
          </button>
          <span className="text-[#1F2A47]">/</span>
          <AddressChip address={accountAddress} explorerUrl={explorerUrl} short />
        </div>

        {/* Fund / Withdraw pills */}
        {isOwner && (
          <div className="flex gap-2">
            <Button
              size="sm"
              onClick={() => { setShowFund(v => !v); setShowWithdraw(false); setShowSettings(false) }}
            >
              Fund account
            </Button>
            <Button
              size="sm"
              variant="secondary"
              onClick={() => { setShowWithdraw(v => !v); setShowFund(false); setShowSettings(false) }}
            >
              Withdraw
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => { setShowSettings(v => !v); setShowFund(false); setShowWithdraw(false) }}
            >
              <Settings size={13} />
            </Button>
          </div>
        )}
      </div>

      {/* Pending ownership banner */}
      {isPendingOwner && (
        <div className="flex items-center justify-between gap-3 px-4 py-3 rounded-[20px] bg-[#18233F] border border-[#F2C27B]/30">
          <div className="flex items-center gap-2 text-[#F2C27B] text-sm">
            <AlertTriangle size={14} />
            You are the proposed new owner.
          </div>
          <Button size="sm" loading={isPending} onClick={() => { void handleAcceptOwnership() }}>
            Accept ownership
          </Button>
        </div>
      )}

      {/* Account data error */}
      {!data.isLoading && data.isError && (
        <div className="rounded-[20px] border border-[#5B3440] bg-[#1E1A2E] px-6 py-4 flex items-center justify-between gap-4">
          <p className="text-sm text-[#F2A0A0]">Couldn't load from Arc.</p>
          <Button size="sm" variant="secondary" onClick={() => { void data.refetch() }}>Retry</Button>
        </div>
      )}

      {/* Three-cell account strip */}
      <div className="rounded-[20px] border border-[#1F2A47] bg-[#121B33] overflow-hidden">
        <div className="grid grid-cols-1 sm:grid-cols-3 divide-y sm:divide-y-0 sm:divide-x divide-[#1F2A47]">

          {/* Cell 1: Balance */}
          <div className="px-6 py-5 flex flex-col gap-2">
            <p className="text-[10px] font-medium tracking-widest uppercase text-[#8C97B2]">Balance</p>
            {data.isLoading ? (
              <Skeleton className="h-14 w-36" />
            ) : (
              <div>
                <p
                  className="tabular-nums text-[#E6EBF5] leading-none"
                  style={{ fontFamily: "'DM Sans', sans-serif", fontSize: '3.375rem', fontWeight: 300 }}
                >
                  {data.balance !== undefined ? formatUsdc(data.balance, 2) : '—'}
                  <span className="text-base text-[#8C97B2] font-normal ml-2">USDC</span>
                </p>
                {/* Sub-stats */}
                {data.totalFunded !== undefined && (
                  <p className="text-xs text-[#8C97B2] mt-1.5 flex flex-wrap gap-x-1" style={{ fontFamily: "'DM Mono', monospace" }}>
                    <span className="whitespace-nowrap">funded {formatUsdc(data.totalFunded)} ·</span>
                    <span className="whitespace-nowrap">paid {formatUsdc(data.totalPaid ?? 0n)} ·</span>
                    <span className="whitespace-nowrap">withdrawn {formatUsdc(data.totalWithdrawn ?? 0n)}</span>
                  </p>
                )}
              </div>
            )}
          </div>

          {/* Cell 2: Owner + Guardian */}
          <div className="px-6 py-5 flex flex-col gap-3">
            <div>
              <p className="text-[10px] font-medium tracking-widest uppercase text-[#8C97B2] mb-1">Owner</p>
              {data.isLoading ? <Skeleton className="h-4 w-28" /> : (
                <div className="flex items-center gap-1.5 font-mono text-sm text-[#C3D1F5] whitespace-nowrap" style={{ fontFamily: "'DM Mono', monospace" }}>
                  {data.owner ? formatAddr(data.owner) : '—'}
                  {isOwner && <span className="text-[#8C97B2] text-[10px] font-sans">(you)</span>}
                </div>
              )}
            </div>
            <div>
              <p className="text-[10px] font-medium tracking-widest uppercase text-[#8C97B2] mb-1">Guardian</p>
              {data.isLoading ? <Skeleton className="h-4 w-28" /> : (
                <span className="font-mono text-sm" style={{ fontFamily: "'DM Mono', monospace" }}>
                  {data.guardian && data.guardian !== '0x0000000000000000000000000000000000000000'
                    ? <span className="text-[#C3D1F5]">{formatAddr(data.guardian)}</span>
                    : <span className="text-[#8C97B2]">None</span>
                  }
                </span>
              )}
            </div>
          </div>

          {/* Cell 3: State + freeze */}
          <div className="px-6 py-5 flex flex-col gap-3">
            {data.isLoading ? (
              <Skeleton className="h-6 w-24" />
            ) : (
              <div className="flex items-center gap-2">
                <span className={`w-2 h-2 rounded-full inline-block ${frozen ? 'bg-[#9FD3FF]' : 'bg-[#8FE3C0]'}`} />
                <span className={`text-sm font-medium ${frozen ? 'text-[#9FD3FF]' : 'text-[#8FE3C0]'}`}>
                  {frozen ? 'Frozen' : 'Live · agents can pay'}
                </span>
              </div>
            )}

            {!data.isLoading && (
              frozen ? (
                isOwner && (
                  <Button
                    variant="secondary"
                    size="sm"
                    loading={isPending}
                    onClick={() => { void handleUnfreeze() }}
                    className="self-start whitespace-nowrap !text-[#8FE3C0] !border-[#1F4A47]"
                  >
                    <Flame size={13} /> Unfreeze account
                  </Button>
                )
              ) : (
                canFreeze && (
                  <Button
                    variant="danger"
                    size="sm"
                    loading={isPending}
                    onClick={() => { void handleFreeze() }}
                    className="self-start whitespace-nowrap"
                  >
                    <Snowflake size={13} /> Freeze account
                  </Button>
                )
              )
            )}
            <p className="text-[11px] text-[#8C97B2]">
              {frozen
                ? 'Frozen · only owner can unfreeze'
                : 'Owner or guardian · stops every agent at once'}
            </p>
          </div>
        </div>

        {/* Fund panel */}
        {showFund && isOwner && (
          <div className="px-6 py-5 border-t border-[#1F2A47] flex flex-col gap-3">
            <p className="text-xs text-[#8C97B2]">You may see two transactions (approve + fund).</p>
            <div className="flex gap-3 items-end flex-wrap">
              <Input
                label="Amount (USDC)"
                placeholder="e.g. 10.00"
                value={fundAmt}
                onChange={e => setFundAmt(e.target.value)}
                type="number" min="0" step="0.01"
                className="w-44"
              />
              <Button loading={isPending} disabled={!fundAmt || Number(fundAmt) <= 0} onClick={() => { void handleFund() }}>
                Fund
              </Button>
              <Button variant="ghost" onClick={() => setShowFund(false)}>Cancel</Button>
            </div>
          </div>
        )}

        {/* Withdraw panel */}
        {showWithdraw && isOwner && (
          <div className="px-6 py-5 border-t border-[#1F2A47] flex flex-col gap-3">
            <div className="flex gap-3 items-end flex-wrap">
              <Input
                label="Amount (USDC)"
                placeholder="e.g. 5.00"
                value={withdrawAmt}
                onChange={e => setWithdrawAmt(e.target.value)}
                type="number" min="0" step="0.01"
                className="w-44"
              />
              <Input
                label="Destination (blank = owner)"
                placeholder={data.owner ?? '0x…'}
                value={withdrawTo}
                onChange={e => setWithdrawTo(e.target.value)}
                className="w-64"
              />
              <Button loading={isPending} disabled={!withdrawAmt || Number(withdrawAmt) <= 0} onClick={() => { void handleWithdraw() }}>
                Withdraw
              </Button>
              <Button variant="ghost" onClick={() => setShowWithdraw(false)}>Cancel</Button>
            </div>
          </div>
        )}

        {/* Settings panel */}
        {showSettings && isOwner && (
          <div className="px-6 py-5 border-t border-[#1F2A47] flex flex-col gap-5">
            <div className="flex flex-col gap-3">
              <p className="text-xs font-medium text-[#8C97B2] uppercase tracking-wider">Guardian</p>
              <div className="flex gap-2 items-end">
                <Input
                  placeholder={
                    data.guardian && data.guardian !== '0x0000000000000000000000000000000000000000'
                      ? data.guardian
                      : '0x… or blank to remove'
                  }
                  value={newGuardian}
                  onChange={e => setNewGuardian(e.target.value)}
                  hint="Can freeze only. Cannot withdraw or change policies."
                  className="w-80"
                />
                <Button size="sm" loading={isPending} onClick={() => { void handleSetGuardian() }}>
                  Update
                </Button>
              </div>
            </div>

            <Divider />

            <div className="flex flex-col gap-3">
              <p className="text-xs font-medium text-[#8C97B2] uppercase tracking-wider">Transfer ownership</p>
              <p className="text-xs text-[#8C97B2]">Two-step. The new owner must call acceptOwnership to complete.</p>
              <div className="flex gap-2 items-end">
                <Input
                  placeholder="New owner address (0x…)"
                  value={newOwner}
                  onChange={e => setNewOwner(e.target.value)}
                  className="w-80"
                />
                <Button size="sm" variant="danger" loading={isPending}
                  disabled={!isAddress(newOwner)}
                  onClick={() => { void handleTransferOwnership() }}>
                  Initiate
                </Button>
              </div>
              {data.pendingOwner && data.pendingOwner !== '0x0000000000000000000000000000000000000000' && (
                <p className="text-xs text-[#F2C27B]">
                  Pending: <span style={{ fontFamily: "'DM Mono', monospace" }} className="font-mono">{formatAddr(data.pendingOwner)}</span>
                </p>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
