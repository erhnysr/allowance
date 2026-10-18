/**
 * Playground tab — testnet only.
 *
 * Flow:
 * 1. Generate (or load from sessionStorage) a demo private key.
 * 2. Owner registers that key with the "Tight trial" preset via setAgent.
 * 3. Compose payment: payee + amount + memo (UTF-8 ≤ 32 bytes).
 * 4. Agent signs a PaymentIntent typed-data with the demo key.
 * 5. Verify: compute digest locally with hashTypedData; compare against
 *    hashPaymentIntent(intent) from the contract. Show ✓ / ✗ with both values.
 * 6. Relay via payWithSig() from the connected wallet; clear intent on success.
 * 7. When check() fails: Relay disabled, "Send anyway" calls payWithSig and
 *    shows the decoded revert error (overspend demo).
 */
import { useState } from 'react'
import {
  type Address, type Hex,
  isAddress, stringToHex, parseUnits, hashTypedData,
} from 'viem'
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts'
import { useReadContract } from 'wagmi'
import { useAccount } from 'wagmi'
import { accountAbi } from '../lib/abis'
import { useNetwork } from '../hooks/useNetwork'
import { useTxFull } from '../hooks/useTx'
import { explorerTxUrl } from '../lib/networks'
import { useAgentList, useAgentDetails } from '../hooks/useAgents'
import { useAccountData } from '../hooks/useAccountData'
import { useNow } from '../hooks/useNow'
import { parseUsdc, formatUsdc, parseOnchainError, checkReasonText } from '../lib/format'
import { computeAvailable } from '../lib/bucket'
import { toAgentInfo, type RawAgentResult } from '../lib/agent'
import { Button, Input, Divider } from './Ui'
import { AgentForm } from './AgentForm'
import { CheckCircle2, XCircle, Key, Trash2, AlertTriangle } from 'lucide-react'

const SESSION_KEY = 'allowance_demo_pk'

// ─── EIP-712 helpers (mirrors AllowanceAccount.sol) ─────────────────────────

const PAYMENT_INTENT_TYPES = {
  PaymentIntent: [
    { name: 'agent',    type: 'address' },
    { name: 'payee',    type: 'address' },
    { name: 'amount',   type: 'uint256' },
    { name: 'nonce',    type: 'uint256' },
    { name: 'deadline', type: 'uint256' },
    { name: 'ref',      type: 'bytes32' },
  ],
} as const

/** Encode a UTF-8 string to bytes32 (right-zero-padded) */
function memoToBytes32(memo: string): Hex {
  return stringToHex(memo, { size: 32 })
}

/** Validate memo: UTF-8 byte length ≤ 32. Returns error string or undefined. */
function validateMemo(memo: string): string | undefined {
  const byteLen = new TextEncoder().encode(memo).length
  if (byteLen > 32) return `Memo is ${byteLen} bytes; max 32`
  return undefined
}

/** Random 256-bit nonce as a BigInt */
function randomNonce(): bigint {
  const arr = new Uint8Array(32)
  crypto.getRandomValues(arr)
  return BigInt('0x' + Array.from(arr).map(b => b.toString(16).padStart(2, '0')).join(''))
}


interface Props {
  accountAddress: `0x${string}`
  onChanged: () => void
}

export function Playground({ accountAddress, onChanged }: Props) {
  const { address: connectedAddress } = useAccount()
  const { chainId, net } = useNetwork()
  const isTestnet = net?.isTestnet ?? false

  // ── Demo key state ─────────────────────────────────────────────────────────
  const [demoPrivKey, setDemoPrivKey] = useState<Hex | null>(() => {
    const stored = sessionStorage.getItem(SESSION_KEY)
    return stored ? (stored as Hex) : null
  })
  const demoAccount = demoPrivKey ? privateKeyToAccount(demoPrivKey) : null
  const demoAddress = demoAccount?.address ?? null

  function generateKey() {
    const pk = generatePrivateKey()
    sessionStorage.setItem(SESSION_KEY, pk)
    setDemoPrivKey(pk)
  }

  function forgetKey() {
    sessionStorage.removeItem(SESSION_KEY)
    setDemoPrivKey(null)
    setSignedIntent(null)
    setSignature(null)
    setRelayResult(null)
  }

  // ── Account + agent state ──────────────────────────────────────────────────
  const { owner } = useAccountData(accountAddress)
  const isOwner = !!(connectedAddress && owner && connectedAddress.toLowerCase() === owner.toLowerCase())

  const { agents: agentAddrs, refetch: refetchAgents } = useAgentList(accountAddress)
  const { data: agentDetails, refetch: refetchDetails } = useAgentDetails(accountAddress, agentAddrs ?? [])

  const demoAgentInfo = demoAddress ? (() => {
    const idx = (agentAddrs ?? []).findIndex(a => a.toLowerCase() === demoAddress.toLowerCase())
    if (idx === -1) return null
    const r = agentDetails?.[idx]?.result as RawAgentResult | undefined
    if (!r) return null
    return toAgentInfo(demoAddress, r)
  })() : null

  const demoRegistered = demoAgentInfo?.active ?? false
  const nowSec = useNow()

  const periodAvailable = demoAgentInfo
    ? computeAvailable(demoAgentInfo.bucket, demoAgentInfo.lastRefill, demoAgentInfo.periodLimit, demoAgentInfo.periodSeconds, nowSec)
    : 0n

  // ── Register panel ─────────────────────────────────────────────────────────
  const [showRegister, setShowRegister] = useState(false)

  // ── Compose payment ────────────────────────────────────────────────────────
  const [payee, setPayee] = useState('')
  const [amount, setAmount] = useState('')
  const [memo, setMemo] = useState('')
  const [amountError, setAmountError] = useState('')
  const [memoError, setMemoError] = useState('')

  // Live check()
  const amountRaw = parseUsdc(amount)
  const checkEnabled = !!demoAddress && isAddress(payee) && amountRaw > 0n && !!chainId
  const { data: checkCode } = useReadContract({
    address: accountAddress,
    abi: accountAbi,
    functionName: 'check',
    args: checkEnabled ? [demoAddress, payee, amountRaw] : undefined,
    chainId: chainId as number,
    query: { enabled: checkEnabled, refetchInterval: 5000 },
  })
  const wouldPass = checkCode === 0

  // ── Sign ───────────────────────────────────────────────────────────────────
  const [signedIntent, setSignedIntent] = useState<{
    agent: Address; payee: Address; amount: bigint; nonce: bigint; deadline: bigint; ref: Hex
  } | null>(null)
  const [signature, setSignature] = useState<Hex | null>(null)
  const [localDigest, setLocalDigest] = useState<Hex | null>(null)
  const [isSigning, setIsSigning] = useState(false)
  const [signError, setSignError] = useState('')

  // hashPaymentIntent from contract — for digest comparison
  const { data: contractDigest, refetch: refetchDigest } = useReadContract({
    address: accountAddress,
    abi: accountAbi,
    functionName: 'hashPaymentIntent',
    args: signedIntent ? [signedIntent] : undefined,
    chainId: chainId as number,
    query: { enabled: !!signedIntent && !!chainId },
  })

  // Real digest comparison: local hashTypedData === contractDigest
  const digestsMatch =
    localDigest !== null &&
    contractDigest !== undefined &&
    localDigest.toLowerCase() === contractDigest.toLowerCase()

  async function handleSign() {
    if (!demoAccount || !isAddress(payee) || !amount || !chainId) return
    const memoErr = validateMemo(memo)
    if (memoErr) { setMemoError(memoErr); return }
    setIsSigning(true)
    setSignedIntent(null)
    setSignature(null)
    setLocalDigest(null)
    setSignError('')
    setRelayResult(null)
    try {
      const nonce = randomNonce()
      const deadline = BigInt(nowSec) + 600n // +10 min, anchored to chain time
      const ref = memoToBytes32(memo)
      const intentData = {
        agent:    demoAddress!,
        payee:    payee,
        amount:   amountRaw,
        nonce,
        deadline,
        ref,
      }
      const domain = {
        name: 'Allowance',
        version: '1',
        chainId: BigInt(chainId),
        verifyingContract: accountAddress,
      }

      const sig = await demoAccount.signTypedData({
        domain,
        types: PAYMENT_INTENT_TYPES,
        primaryType: 'PaymentIntent',
        message: intentData,
      })

      // Compute digest locally using the same domain + types + message
      const digest = hashTypedData({
        domain,
        types: PAYMENT_INTENT_TYPES,
        primaryType: 'PaymentIntent',
        message: intentData,
      })

      setSignedIntent(intentData)
      setSignature(sig)
      setLocalDigest(digest)
      void refetchDigest()
    } catch (e) {
      const msg = parseOnchainError(e)
      setSignError(msg.startsWith('Cancelled') ? '' : msg)
    } finally {
      setIsSigning(false)
    }
  }

  // ── Relay ──────────────────────────────────────────────────────────────────
  const { send: sendRelay, isPending: isRelaying } = useTxFull(chainId, () => {
    // On success: clear intent so the same nonce cannot be relayed twice
    setSignedIntent(null)
    setSignature(null)
    setLocalDigest(null)
    void refetchAgents()
    void refetchDetails()
    onChanged()
  })
  const [sendAnywaySending, setSendAnywaySending] = useState(false)
  const [sendAnywayError, setSendAnywayError] = useState('')
  // Inline result shown inside the Signed intent card
  const [relayResult, setRelayResult] = useState<{
    success: boolean; txHash: `0x${string}`; checkCode?: number; amount?: bigint
  } | null>(null)

  async function handleRelay() {
    if (!signedIntent || !signature || !chainId) return
    setRelayResult(null)
    try {
      const txHash = await sendRelay(
        {
          address: accountAddress,
          abi: accountAbi,
          functionName: 'payWithSig',
          args: [signedIntent, signature],
          chainId,
        },
        'Relay payment',
      )
      // onSuccess already cleared signedIntent; capture result for display
      if (txHash) {
        setRelayResult({ success: true, txHash, amount: signedIntent.amount })
      }
    } catch (e) {
      const hash = (e as { txHash?: `0x${string}` }).txHash
      if (hash) {
        setRelayResult({ success: false, txHash: hash, checkCode, amount: signedIntent?.amount })
      }
    }
  }

  async function handleSendAnyway() {
    if (!signedIntent || !signature || !chainId) return
    setSendAnywaySending(true)
    setSendAnywayError('')
    setRelayResult(null)
    try {
      const txHash = await sendRelay(
        {
          address: accountAddress,
          abi: accountAbi,
          functionName: 'payWithSig',
          args: [signedIntent, signature],
          chainId,
        },
        'Force relay',
      )
      if (txHash) {
        setRelayResult({ success: true, txHash, amount: signedIntent.amount })
      }
    } catch (e) {
      const hash = (e as { txHash?: `0x${string}` }).txHash
      if (hash) {
        setRelayResult({ success: false, txHash: hash, checkCode, amount: signedIntent?.amount })
      }
      setSendAnywayError(parseOnchainError(e))
    } finally {
      setSendAnywaySending(false)
    }
  }

  // ── Try to overspend ───────────────────────────────────────────────────────
  function handleOverspend() {
    if (!demoAgentInfo) return
    const over = demoAgentInfo.maxPerPayment + parseUnits('1', 6)
    setAmount((Number(over) / 1e6).toFixed(2))
    setAmountError('')
    setSignedIntent(null)
    setSignature(null)
  }

  if (!isTestnet) {
    return (
      <div className="rounded-[20px] border border-[#1F2A47] bg-[#121B33] p-8 text-center">
        <p className="text-[#8C97B2] text-sm">Playground is only available on testnet.</p>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-6">
      {/* Step 1: Demo key */}
      <div className="rounded-[20px] border border-[#1F2A47] bg-[#121B33] overflow-hidden">
        <div className="px-5 pt-5 pb-4 border-b border-[#1F2A47]">
          <div className="flex items-center gap-2 mb-1">
            <Key size={14} className="text-[#A9BDF0]" />
            <h3 className="font-semibold text-sm text-[#E6EBF5]" style={{ fontFamily: "'DM Sans', sans-serif" }}>
              Demo agent key
            </h3>
            <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-[#F2C27B]/10 text-[#F2C27B] flex items-center gap-1">
              <AlertTriangle size={10} /> Demo key · testnet only
            </span>
          </div>
          <p className="text-xs text-[#8C97B2]">
            A private key generated in the browser, stored in sessionStorage only. Never send real funds here.
          </p>
        </div>

        <div className="px-5 py-4 flex flex-col gap-3">
          {!demoPrivKey ? (
            <Button onClick={generateKey} size="sm" variant="secondary">
              Create demo agent
            </Button>
          ) : (
            <>
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="text-[10px] font-semibold tracking-widest uppercase text-[#8C97B2] mb-0.5">Address</p>
                  <span className="font-mono text-sm text-[#E6EBF5]">{demoAddress}</span>
                </div>
                <button
                  onClick={forgetKey}
                  className="flex items-center gap-1.5 text-xs text-[#F2A0A0] hover:text-[#F2A0A0]/80 transition-colors"
                >
                  <Trash2 size={12} /> Forget key
                </button>
              </div>

              {demoRegistered ? (
                <div className="flex items-center gap-2 text-xs text-[#8FE3C0]">
                  <CheckCircle2 size={12} />
                  Registered with Tight trial preset
                  {periodAvailable < (demoAgentInfo?.periodLimit ?? 0n) && (
                    <span className="text-[#8C97B2] ml-1">
                      · {formatUsdc(periodAvailable)} / {formatUsdc(demoAgentInfo?.periodLimit ?? 0n)} USDC available
                    </span>
                  )}
                </div>
              ) : (
                isOwner && (
                  <div className="flex flex-col gap-2">
                    <p className="text-xs text-[#8C97B2]">
                      Register the demo key using the "Tight trial" preset (0.1 max, 1 USDC/day, 3 total, 7 days).
                    </p>
                    <Button size="sm" onClick={() => setShowRegister(v => !v)}>
                      Register demo agent
                    </Button>
                    {showRegister && (
                      <div className="mt-2">
                        <AgentForm
                          accountAddress={accountAddress}
                          initialAddress={demoAddress ?? undefined}
                          onSuccess={() => {
                            setShowRegister(false)
                            void refetchAgents()
                            void refetchDetails()
                          }}
                        />
                      </div>
                    )}
                  </div>
                )
              )}
            </>
          )}
        </div>
      </div>

      {/* Steps 2–4: Compose + sign + relay */}
      {demoAddress && demoRegistered && (
        <>
          {/* Step 2: Compose */}
          <div className="rounded-[20px] border border-[#1F2A47] bg-[#121B33] overflow-hidden">
            <div className="px-5 pt-5 pb-4 border-b border-[#1F2A47]">
              <h3 className="font-semibold text-sm text-[#E6EBF5] mb-1" style={{ fontFamily: "'DM Sans', sans-serif" }}>
                Compose payment
              </h3>
              <p className="text-xs text-[#8C97B2]">The demo agent will sign this. The connected wallet relays it.</p>
            </div>

            <div className="px-5 py-4 flex flex-col gap-3">
              <Input
                label="Payee address"
                placeholder="0x…"
                value={payee}
                onChange={e => { setPayee(e.target.value); setSignedIntent(null) }}
              />

              <div className="flex flex-col gap-1.5">
                <label className="text-[10px] font-semibold tracking-widest uppercase text-[#8C97B2]">Amount (USDC)</label>
                <div className="relative">
                  <input
                    type="number" min="0.000001" step="0.01" placeholder="0.00"
                    className={`w-full px-3 py-2.5 pr-16 rounded-lg bg-[#0F1730] border text-sm text-[#E6EBF5] placeholder-[#8C97B2] focus:outline-none focus:border-[#A9BDF0] ${
                      amountError ? 'border-[#F2A0A0]' : 'border-[#1F2A47]'
                    }`}
                    value={amount}
                    onChange={e => { setAmount(e.target.value); setSignedIntent(null); setAmountError('') }}
                  />
                  <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs font-medium text-[#A9BDF0]">USDC</span>
                </div>
                {amountError && <span className="text-xs text-[#F2A0A0]">{amountError}</span>}
              </div>

              <div className="flex flex-col gap-1.5">
                <label className="text-[10px] font-semibold tracking-widest uppercase text-[#8C97B2]">Memo (max 32 UTF-8 bytes)</label>
                <input
                  type="text"
                  placeholder="e.g. API call #42"
                  className={`w-full px-3 py-2.5 rounded-lg bg-[#0F1730] border text-sm text-[#E6EBF5] placeholder-[#8C97B2] focus:outline-none focus:border-[#A9BDF0] ${
                    memoError ? 'border-[#F2A0A0]' : 'border-[#1F2A47]'
                  }`}
                  value={memo}
                  onChange={e => {
                    const v = e.target.value
                    setMemo(v)
                    setMemoError(validateMemo(v) ?? '')
                    setSignedIntent(null)
                  }}
                />
                {memoError && <span className="text-xs text-[#F2A0A0]">{memoError}</span>}
              </div>

              {/* Live check verdict */}
              {checkEnabled && checkCode !== undefined && (
                <div className={`rounded-lg px-3 py-2 text-xs border flex items-center gap-2 ${
                  wouldPass
                    ? 'bg-[#8FE3C0]/5 border-[#8FE3C0]/20 text-[#8FE3C0]'
                    : 'bg-[#F2A0A0]/5 border-[#F2A0A0]/20 text-[#F2A0A0]'
                }`}>
                  {wouldPass
                    ? <><CheckCircle2 size={12} /> Would go through</>
                    : <><XCircle size={12} /> Would be rejected: {checkReasonText(checkCode ?? 0)}</>
                  }
                </div>
              )}

              {/* Overspend helper */}
              {demoAgentInfo && (
                <button
                  onClick={handleOverspend}
                  className="text-left text-xs text-[#F2C27B] hover:text-[#F2C27B]/80 underline underline-offset-2 transition-colors"
                >
                  Try to overspend: prefill {formatUsdc(demoAgentInfo.maxPerPayment + parseUnits('1', 6))} USDC (above max per payment)
                </button>
              )}

              <Divider />

              {signError && (
                <p className="text-xs text-[#F2A0A0]">{signError}</p>
              )}

              <Button
                onClick={() => { void handleSign() }}
                loading={isSigning}
                disabled={!isAddress(payee) || !amount || !checkEnabled || !!memoError}
              >
                Agent signs
              </Button>
            </div>
          </div>

          {/* Step 3: Signed intent */}
          {signedIntent && signature && (
            <div className="rounded-[20px] border border-[#1F2A47] bg-[#121B33] overflow-hidden">
              <div className="px-5 pt-5 pb-4 border-b border-[#1F2A47]">
                <h3 className="font-semibold text-sm text-[#E6EBF5] mb-1" style={{ fontFamily: "'DM Sans', sans-serif" }}>
                  Signed intent
                </h3>

                {/* Real digest comparison */}
                <div className="flex flex-col gap-1 text-xs">
                  {contractDigest === undefined ? (
                    <span className="text-[#8C97B2]">Fetching contract digest…</span>
                  ) : digestsMatch ? (
                    <span className="flex items-center gap-1.5 text-[#8FE3C0]">
                      <CheckCircle2 size={12} />
                      hashPaymentIntent() matches local hashTypedData ✓
                    </span>
                  ) : (
                    <>
                      <span className="flex items-center gap-1.5 text-[#F2A0A0]">
                        <XCircle size={12} />
                        Digest mismatch — EIP-712 domain may differ
                      </span>
                      <span className="font-mono text-[#8C97B2] break-all">Local:&nbsp;&nbsp;&nbsp;{localDigest}</span>
                      <span className="font-mono text-[#8C97B2] break-all">Contract: {contractDigest}</span>
                    </>
                  )}
                </div>
              </div>

              <div className="px-5 py-4">
                <pre className="text-xs text-[#C3D1F5] bg-[#0F1730] rounded-lg p-3 overflow-x-auto font-mono whitespace-pre-wrap break-all">
                  {JSON.stringify({
                    agent:    signedIntent.agent,
                    payee:    signedIntent.payee,
                    amount:   signedIntent.amount.toString(),
                    nonce:    signedIntent.nonce.toString(),
                    deadline: signedIntent.deadline.toString(),
                    ref:      signedIntent.ref,
                    signature,
                  }, null, 2)}
                </pre>

                <div className="mt-4 flex flex-wrap gap-2 items-center">
                  <Button
                    loading={isRelaying}
                    onClick={() => { void handleRelay() }}
                    disabled={!wouldPass || isRelaying || sendAnywaySending}
                  >
                    Relay via payWithSig
                  </Button>

                  {!wouldPass && (
                    <>
                      <Button
                        variant="secondary"
                        loading={sendAnywaySending}
                        disabled={isRelaying || sendAnywaySending}
                        onClick={() => { void handleSendAnyway() }}
                      >
                        Send anyway
                      </Button>
                      {sendAnywayError && (
                        <span className="text-xs text-[#F2A0A0]">{sendAnywayError}</span>
                      )}
                    </>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* Inline transaction result — lives outside the signedIntent card so it
              persists after onSuccess clears signedIntent and signature */}
          {relayResult && chainId && (
            <div className={`rounded-[20px] px-4 py-3 text-xs border flex items-center gap-2 ${
              relayResult.success
                ? 'bg-[#13283A] border-[#1F4A47] text-[#8FE3C0]'
                : 'bg-[#1E1A2E] border-[#5B3440] text-[#F2A0A0]'
            }`}>
              {relayResult.success ? (
                <>
                  <CheckCircle2 size={12} className="shrink-0" />
                  <span>
                    Paid {relayResult.amount !== undefined ? formatUsdc(relayResult.amount) : ''} USDC ·{' '}
                    <a
                      href={explorerTxUrl(chainId, relayResult.txHash)}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="underline underline-offset-2 hover:opacity-80"
                    >
                      view tx ↗
                    </a>
                  </span>
                </>
              ) : (
                <>
                  <XCircle size={12} className="shrink-0" />
                  <span>
                    Rejected onchain{relayResult.checkCode !== undefined && relayResult.checkCode !== 0
                      ? `: ${checkReasonText(relayResult.checkCode)}`
                      : ''} ·{' '}
                    <a
                      href={explorerTxUrl(chainId, relayResult.txHash)}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="underline underline-offset-2 hover:opacity-80"
                    >
                      view tx ↗
                    </a>
                  </span>
                </>
              )}
            </div>
          )}
        </>
      )}
    </div>
  )
}
