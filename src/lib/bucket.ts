/**
 * Client-side token-bucket refill formula — mirrors _available() in AllowanceAccount.sol.
 * Returns the currently available USDC in 6-decimal raw units.
 */
export function computeAvailable(
  bucket: bigint,
  lastRefill: bigint,
  periodLimit: bigint,
  periodSeconds: bigint,
  nowSec: bigint,
): bigint {
  if (periodLimit === 0n || periodSeconds === 0n) return 0n
  const elapsed = nowSec > lastRefill ? nowSec - lastRefill : 0n
  // mulDiv(elapsed, periodLimit, periodSeconds) — safe since these are small numbers
  const refill = (elapsed * periodLimit) / periodSeconds
  const available = bucket + refill
  return available > periodLimit ? periodLimit : available
}
