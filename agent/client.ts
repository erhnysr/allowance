/**
 * Allowance agent client
 *
 * A typed viem-only module for agent frameworks to import.
 * Works in both browser and Node/Bun environments — no Buffer, no require.
 */

import {
  createPublicClient,
  createWalletClient,
  http,
  parseUnits,
  formatUnits,
  hashTypedData,
  bytesToHex,
  toHex,
  BaseError,
  ContractFunctionRevertedError,
  type Address,
  type Hex,
  type PrivateKeyAccount,
} from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { arcTestnet } from 'viem/chains'
import { defineChain } from 'viem'

// ── Chain definitions ─────────────────────────────────────────────────────────

const arcMainnet = defineChain({
  id: 5042,
  name: 'Arc Mainnet',
  nativeCurrency: { name: 'USDC', symbol: 'USDC', decimals: 18 },
  rpcUrls: { default: { http: ['https://rpc.mainnet.arc.io'] } },
  blockExplorers: { default: { name: 'Arc Explorer', url: 'https://explorer.arc.io' } },
})

export const NETWORKS = {
  testnet: {
    chain: arcTestnet,
    rpc: 'https://rpc.testnet.arc.io',
    explorer: 'https://explorer.testnet.arc.io',
    factoryAddress: '0xd4018d487861eb513e8a756a4e2693d55daff95a' as Address,
  },
  mainnet: {
    chain: arcMainnet,
    rpc: 'https://rpc.mainnet.arc.io',
    explorer: 'https://explorer.arc.io',
    factoryAddress: '0xa48fdee3cc6ec2909da8fbec0d2f14032e92c5ec' as Address,
  },
} as const

export type NetworkName = keyof typeof NETWORKS

// ── Full account ABI (functions + all custom errors for decoding) ─────────────
// Imported from src/lib/abis.ts to keep a single source of truth.
// We inline the subset needed here so this file is self-contained for npm use.

const accountAbi = [
  // ── view functions ──────────────────────────────────────────────────────────
  {
    type: 'function', name: 'getAgent', stateMutability: 'view',
    inputs: [{ name: 'agent', type: 'address' }],
    outputs: [{ name: '', type: 'tuple', components: [
      { name: 'label',           type: 'string'  },
      { name: 'active',          type: 'bool'    },
      { name: 'expiresAt',       type: 'uint64'  },
      { name: 'maxPerPayment',   type: 'uint128' },
      { name: 'periodLimit',     type: 'uint128' },
      { name: 'periodSeconds',   type: 'uint32'  },
      { name: 'totalLimit',      type: 'uint128' },
      { name: 'bucket',          type: 'uint128' },
      { name: 'lastRefill',      type: 'uint64'  },
      { name: 'totalSpent',      type: 'uint128' },
      { name: 'payeeRestricted', type: 'bool'    },
    ]}],
  },
  {
    type: 'function', name: 'availableNow', stateMutability: 'view',
    inputs: [{ name: 'agent', type: 'address' }],
    outputs: [
      { name: 'periodAvailable', type: 'uint128' },
      { name: 'totalRemaining',  type: 'uint128' },
      { name: 'expiresAt',       type: 'uint64'  },
      { name: 'active',          type: 'bool'    },
    ],
  },
  {
    type: 'function', name: 'check', stateMutability: 'view',
    inputs: [
      { name: 'agent',  type: 'address' },
      { name: 'payee',  type: 'address' },
      { name: 'amount', type: 'uint128' },
    ],
    outputs: [{ name: 'reason', type: 'uint8' }],
  },
  {
    type: 'function', name: 'hashPaymentIntent', stateMutability: 'view',
    inputs: [{ name: 'intent', type: 'tuple', components: [
      { name: 'agent',    type: 'address' },
      { name: 'payee',    type: 'address' },
      { name: 'amount',   type: 'uint256' },
      { name: 'nonce',    type: 'uint256' },
      { name: 'deadline', type: 'uint256' },
      { name: 'ref',      type: 'bytes32' },
    ]}],
    outputs: [{ name: '', type: 'bytes32' }],
  },
  {
    type: 'function', name: 'eip712Domain', stateMutability: 'view',
    inputs: [],
    outputs: [
      { name: 'fields',            type: 'bytes1'    },
      { name: 'name',              type: 'string'    },
      { name: 'version',           type: 'string'    },
      { name: 'chainId',           type: 'uint256'   },
      { name: 'verifyingContract', type: 'address'   },
      { name: 'salt',              type: 'bytes32'   },
      { name: 'extensions',        type: 'uint256[]' },
    ],
  },
  // ── write functions ─────────────────────────────────────────────────────────
  {
    type: 'function', name: 'payWithSig', stateMutability: 'nonpayable',
    inputs: [
      { name: 'intent', type: 'tuple', components: [
        { name: 'agent',    type: 'address' },
        { name: 'payee',    type: 'address' },
        { name: 'amount',   type: 'uint256' },
        { name: 'nonce',    type: 'uint256' },
        { name: 'deadline', type: 'uint256' },
        { name: 'ref',      type: 'bytes32' },
      ]},
      { name: 'signature', type: 'bytes' },
    ],
    outputs: [],
  },
  // ── custom errors (needed for BaseError decoding) ───────────────────────────
  { type: 'error', name: 'AccountFrozen',                  inputs: [] },
  { type: 'error', name: 'AgentExpired',                   inputs: [] },
  { type: 'error', name: 'AgentRevoked',                   inputs: [] },
  { type: 'error', name: 'CapBelowSpent',                  inputs: [] },
  { type: 'error', name: 'DeadlinePassed',                 inputs: [] },
  { type: 'error', name: 'InsufficientBalance',            inputs: [] },
  { type: 'error', name: 'InvalidAgentAddress',            inputs: [] },
  { type: 'error', name: 'InvalidExpiresAt',               inputs: [] },
  { type: 'error', name: 'InvalidLabel',                   inputs: [] },
  { type: 'error', name: 'InvalidLimits',                  inputs: [] },
  { type: 'error', name: 'InvalidPayee',                   inputs: [] },
  { type: 'error', name: 'InvalidPeriodSeconds',           inputs: [] },
  { type: 'error', name: 'InvalidSignature',               inputs: [] },
  { type: 'error', name: 'NonceAlreadyUsed',               inputs: [] },
  { type: 'error', name: 'NotAgentOrOwner',                inputs: [] },
  { type: 'error', name: 'NotGuardianOrOwner',             inputs: [] },
  { type: 'error', name: 'OverPayeeCap',                   inputs: [] },
  { type: 'error', name: 'OverPerPayment',                 inputs: [] },
  { type: 'error', name: 'OverPeriodLimit',                inputs: [] },
  { type: 'error', name: 'OverTotalLimit',                 inputs: [] },
  { type: 'error', name: 'PayeeNotAllowed',                inputs: [] },
  { type: 'error', name: 'ReentrancyGuardReentrantCall',   inputs: [] },
  { type: 'error', name: 'RenounceDisabled',               inputs: [] },
  { type: 'error', name: 'TotalLimitBelowSpent',           inputs: [] },
  { type: 'error', name: 'TooManyAgents',                  inputs: [] },
  { type: 'error', name: 'UnknownAgent',                   inputs: [] },
  { type: 'error', name: 'ZeroAddress',                    inputs: [] },
  { type: 'error', name: 'ZeroAmount',                     inputs: [] },
] as const

// ── Types ─────────────────────────────────────────────────────────────────────

export interface Policy {
  label: string
  active: boolean
  expiresAt: number
  maxPerPaymentUsdc: string
  periodLimitUsdc: string
  periodSeconds: number
  totalLimitUsdc: string
  totalSpentUsdc: string
  payeeRestricted: boolean
}

export interface Availability {
  periodAvailableUsdc: string
  totalRemainingUsdc: string
  expiresAt: number
  active: boolean
}

/** reason code 0 means the payment would go through */
export const CHECK_REASONS: Record<number, string> = {
  0:  'OK',
  1:  'Amount is zero',
  2:  'Account is frozen',
  3:  'Agent not registered',
  4:  'Agent is revoked',
  5:  'Agent has expired',
  6:  'Invalid payee (zero address or the account itself)',
  7:  'Payee not allowed or blocked',
  8:  'Over per-payment cap',
  9:  'Over period budget',
  10: 'Over lifetime cap',
  11: 'Over payee cap',
  12: 'Insufficient account balance',
}

export interface PaymentIntent {
  agent:    Address
  payee:    Address
  amount:   bigint
  nonce:    bigint
  deadline: bigint
  ref:      Hex
}

export interface SignedIntent {
  intent:    PaymentIntent
  signature: Hex
  account:   Address
  network:   NetworkName
}

// ── EIP-712 types (must match AllowanceAccount.sol) ───────────────────────────

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

// ── Helpers ───────────────────────────────────────────────────────────────────

export function toUsdc(amount: bigint): string {
  return formatUnits(amount, 6)
}

export function fromUsdc(amount: string): bigint {
  return parseUnits(amount, 6)
}

export function validateMemo(memo: string): Hex {
  const bytes = new TextEncoder().encode(memo)
  if (bytes.length > 32) {
    throw new Error(`Memo too long: ${bytes.length} UTF-8 bytes (max 32)`)
  }
  // Right-pad to 32 bytes using viem — no Buffer
  const padded = new Uint8Array(32)
  padded.set(bytes)
  return bytesToHex(padded)
}

export function randomNonce(): bigint {
  const arr = new Uint8Array(32)
  globalThis.crypto.getRandomValues(arr)
  return BigInt(toHex(arr))
}

export function explorerTxUrl(network: NetworkName, hash: string): string {
  return `${NETWORKS[network].explorer}/tx/${hash}`
}

/** Decode a viem BaseError into a human-readable error name + message */
export function decodeContractError(err: unknown): string {
  if (err instanceof BaseError) {
    const revert = err.walk(e => e instanceof ContractFunctionRevertedError)
    if (revert instanceof ContractFunctionRevertedError) {
      const name = revert.data?.errorName ?? revert.name
      return name ? `${name}: ${revert.shortMessage}` : revert.shortMessage
    }
    return err.shortMessage ?? err.message
  }
  return String(err)
}

// ── Client factory ────────────────────────────────────────────────────────────

export function createAllowanceClient(network: NetworkName = 'testnet') {
  const net = NETWORKS[network]
  const publicClient = createPublicClient({ chain: net.chain, transport: http(net.rpc) })

  // ── getPolicy ───────────────────────────────────────────────────────────────
  async function getPolicy(account: Address, agentAddress: Address): Promise<Policy> {
    const result = await publicClient.readContract({
      address: account,
      abi: accountAbi,
      functionName: 'getAgent',
      args: [agentAddress],
    })
    return {
      label:             result.label,
      active:            result.active,
      expiresAt:         Number(result.expiresAt),
      maxPerPaymentUsdc: toUsdc(result.maxPerPayment),
      periodLimitUsdc:   toUsdc(result.periodLimit),
      periodSeconds:     result.periodSeconds,
      totalLimitUsdc:    toUsdc(result.totalLimit),
      totalSpentUsdc:    toUsdc(result.totalSpent),
      payeeRestricted:   result.payeeRestricted,
    }
  }

  // ── getAvailability ─────────────────────────────────────────────────────────
  async function getAvailability(account: Address, agentAddress: Address): Promise<Availability> {
    const result = await publicClient.readContract({
      address: account,
      abi: accountAbi,
      functionName: 'availableNow',
      args: [agentAddress],
    })
    return {
      periodAvailableUsdc: toUsdc(result[0]),
      totalRemainingUsdc:  toUsdc(result[1]),
      expiresAt:           Number(result[2]),
      active:              result[3],
    }
  }

  // ── check ───────────────────────────────────────────────────────────────────
  async function check(
    account: Address,
    agentAddress: Address,
    payee: Address,
    amountUsdc: string,
  ): Promise<{ reason: number; message: string; ok: boolean }> {
    const amount = fromUsdc(amountUsdc)
    const reason = await publicClient.readContract({
      address: account,
      abi: accountAbi,
      functionName: 'check',
      args: [agentAddress, payee, amount as bigint & { readonly __type: 'uint128' }],
    })
    const code = Number(reason)
    return {
      reason:  code,
      message: CHECK_REASONS[code] ?? `Unknown reason ${code}`,
      ok:      code === 0,
    }
  }

  // ── signIntent ──────────────────────────────────────────────────────────────
  async function signIntent(
    account: Address,
    agentKey: Hex,
    payee: Address,
    amountUsdc: string,
    memo = '',
  ): Promise<SignedIntent> {
    const ref      = validateMemo(memo)
    const amount   = fromUsdc(amountUsdc)
    const nonce    = randomNonce()
    const deadline = BigInt(Math.floor(Date.now() / 1000) + 600) // 10 min

    const agentAccount: PrivateKeyAccount = privateKeyToAccount(agentKey)
    const agentAddress = agentAccount.address

    // Fetch EIP-712 domain from contract
    const domain = await publicClient.readContract({
      address: account,
      abi: accountAbi,
      functionName: 'eip712Domain',
    })

    const intent: PaymentIntent = { agent: agentAddress, payee, amount, nonce, deadline, ref }

    const typedDataArgs = {
      domain: {
        name:              domain[1],
        version:           domain[2],
        chainId:           Number(domain[3]),
        verifyingContract: domain[4],
      },
      types:       PAYMENT_INTENT_TYPES,
      primaryType: 'PaymentIntent' as const,
      message: {
        agent:    intent.agent,
        payee:    intent.payee,
        amount:   intent.amount,
        nonce:    intent.nonce,
        deadline: intent.deadline,
        ref:      intent.ref,
      },
    }

    const walletClient = createWalletClient({
      account: agentAccount,
      chain: net.chain,
      transport: http(net.rpc),
    })

    const signature = await walletClient.signTypedData(typedDataArgs)

    // Verify locally: local hash must match the contract's hash
    const localDigest    = hashTypedData(typedDataArgs)
    const contractDigest = await publicClient.readContract({
      address: account,
      abi: accountAbi,
      functionName: 'hashPaymentIntent',
      args: [{ agent: intent.agent, payee: intent.payee, amount: intent.amount, nonce: intent.nonce, deadline: intent.deadline, ref: intent.ref }],
    })

    if (localDigest.toLowerCase() !== contractDigest.toLowerCase()) {
      throw new Error(
        `EIP-712 digest mismatch.\n  local:    ${localDigest}\n  contract: ${contractDigest}`,
      )
    }

    return { intent, signature, account, network }
  }

  // ── relay ───────────────────────────────────────────────────────────────────
  async function relay(
    signed: SignedIntent,
    relayerKey: Hex,
  ): Promise<{ hash: Hex; explorerUrl: string }> {
    // Refuse if the intent's network does not match this client's network
    if (signed.network !== network) {
      throw new Error(
        `Network mismatch: intent is for "${signed.network}" but client is "${network}"`,
      )
    }

    // Refuse if the deadline has already passed
    const nowSec = Math.floor(Date.now() / 1000)
    if (Number(signed.intent.deadline) <= nowSec) {
      throw new Error(
        `Intent deadline has passed (deadline ${signed.intent.deadline}, now ${nowSec})`,
      )
    }

    const relayerAccount: PrivateKeyAccount = privateKeyToAccount(relayerKey)
    const walletClient = createWalletClient({
      account: relayerAccount,
      chain: net.chain,
      transport: http(net.rpc),
    })

    const { intent, signature, account } = signed

    let hash: Hex
    try {
      hash = await walletClient.writeContract({
        address: account,
        abi: accountAbi,
        functionName: 'payWithSig',
        args: [
          { agent: intent.agent, payee: intent.payee, amount: intent.amount, nonce: intent.nonce, deadline: intent.deadline, ref: intent.ref },
          signature,
        ],
      })
    } catch (err) {
      throw new Error(decodeContractError(err))
    }

    const receipt = await publicClient.waitForTransactionReceipt({ hash })
    if (receipt.status === 'reverted') {
      throw new Error(`Transaction reverted onchain: ${explorerTxUrl(network, hash)}`)
    }

    return { hash, explorerUrl: explorerTxUrl(network, hash) }
  }

  // ── pay (check → sign → relay all-in-one) ──────────────────────────────────
  async function pay(
    account: Address,
    agentKey: Hex,
    payee: Address,
    amountUsdc: string,
    memo = '',
  ): Promise<{ hash: Hex; explorerUrl: string }> {
    const agentAddress = privateKeyToAccount(agentKey).address

    const checkResult = await check(account, agentAddress, payee, amountUsdc)
    if (!checkResult.ok) {
      throw new Error(`Payment would fail: ${checkResult.message} (reason ${checkResult.reason})`)
    }

    const signed = await signIntent(account, agentKey, payee, amountUsdc, memo)
    return relay(signed, agentKey)
  }

  return { getPolicy, getAvailability, check, signIntent, relay, pay, publicClient, network: net }
}
