import { useEffect, useState } from 'react'
import { createPublicClient, http, parseAbiItem, type Address } from 'viem'
import { accountAbi } from '../lib/abis'
import { useNetwork } from './useNetwork'

export interface PayeeEntry {
  agent: Address
  payee: Address
}

export function usePayeeLogs(
  accountAddress: Address | undefined,
  createdAtBlock: bigint | undefined,
) {
  const { net, chainId } = useNetwork()

  // Stable primitives for the dep array — avoids object/bigint reference churn
  const chainIdNum = chainId ?? 0
  const createdAtStr = createdAtBlock?.toString() ?? ''

  const [payees, setPayees] = useState<PayeeEntry[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!accountAddress || !net || !chainIdNum || !createdAtStr) return
    let cancelled = false
    const fromBlock = BigInt(createdAtStr)

    async function run() {
      if (!net) return
      setLoading(true)
      setError(null)
      try {
        const client = createPublicClient({
          chain: net.chain,
          transport: http(),
        })

        const payeeSetEvent = parseAbiItem(
          'event PayeeSet(address indexed agent, address indexed payee, bool allowed, uint128 cap)'
        )
        const payeeBlockedEvent = parseAbiItem(
          'event PayeeBlocked(address indexed agent, address indexed payee, bool blocked)'
        )

        const CHUNK = 5000n
        const latestBlock = await client.getBlockNumber()
        const seen = new Set<string>()
        const results: PayeeEntry[] = []

        for (let from = fromBlock; from <= latestBlock; from += CHUNK) {
          const to = from + CHUNK - 1n < latestBlock ? from + CHUNK - 1n : latestBlock
          try {
            const [setLogs, blockedLogs] = await Promise.all([
              client.getLogs({ address: accountAddress, event: payeeSetEvent, fromBlock: from, toBlock: to }),
              client.getLogs({ address: accountAddress, event: payeeBlockedEvent, fromBlock: from, toBlock: to }),
            ])
            for (const log of [...setLogs, ...blockedLogs]) {
              const key = `${log.args.agent}-${log.args.payee}`
              if (!seen.has(key) && log.args.agent && log.args.payee) {
                seen.add(key)
                results.push({ agent: log.args.agent, payee: log.args.payee })
              }
            }
          } catch {
            // skip chunk on error
          }
          if (cancelled) return
        }
        if (!cancelled) setPayees(results)
      } catch (e) {
        if (!cancelled) setError((e as Error).message)
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    void run()
    return () => { cancelled = true }
  }, [accountAddress, chainIdNum, createdAtStr, net])

  return { payees, loading, error }
}

// Re-export accountAbi for use in components
export { accountAbi }
