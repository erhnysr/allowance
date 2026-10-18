import { useState, useEffect, useRef } from 'react'
import { useBlock } from 'wagmi'
import { useNetwork } from './useNetwork'

/**
 * Returns the current Unix timestamp as a bigint, ticking every second.
 * Offset is derived from the latest block timestamp so the gauge follows
 * chain time rather than wall-clock drift.
 */
export function useNow(): bigint {
  const { chainId } = useNetwork()

  const { data: block } = useBlock({
    chainId: chainId as number,
    query: {
      enabled: !!chainId,
      refetchInterval: 15_000,
      staleTime: 10_000,
    },
  })

  // Derive offset from block data synchronously during render — no useEffect needed.
  // Store in a ref so the interval callback can read the latest value.
  const blockTimestamp = block?.timestamp ? Number(block.timestamp) : undefined
  const offset = blockTimestamp !== undefined
    ? blockTimestamp - Math.floor(Date.now() / 1000)
    : 0
  const offsetRef = useRef(offset)
  offsetRef.current = offset

  const [now, setNow] = useState(() => BigInt(Math.floor(Date.now() / 1000) + offsetRef.current))

  useEffect(() => {
    const id = setInterval(() => {
      setNow(BigInt(Math.floor(Date.now() / 1000) + offsetRef.current))
    }, 1000)
    return () => clearInterval(id)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return now
}
