import { useState } from 'react'
import { useWriteContract } from 'wagmi'
import { useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { explorerTxUrl } from '../lib/networks'
import { parseOnchainError } from '../lib/format'

/**
 * useTxFull — send a contract write, always wait for the receipt.
 *
 * - receipt.status === 'success' → success toast + explorer link, then onSuccess().
 *   After either outcome, invalidateQueries() so header/agents/activity refresh.
 * - receipt.status === 'reverted' → error toast "Reverted onchain" + explorer link,
 *   no onSuccess(). Throws an error tagged __toasted so callers stop (approve → fund).
 * - wallet rejection → dismiss toast silently (or show "Cancelled").
 * isPending stays true from wallet prompt until receipt lands.
 */
export function useTxFull(chainId: number | undefined, onSuccess?: () => void) {
  const { writeContractAsync } = useWriteContract()
  const queryClient = useQueryClient()
  const [isPending, setIsPending] = useState(false)

  async function send(
    args: Parameters<typeof writeContractAsync>[0],
    label: string,
  ) {
    setIsPending(true)
    const id = toast.loading(`${label} — confirm in wallet…`)
    try {
      const txHash = await writeContractAsync(args)
      toast.loading(`${label} — waiting for confirmation…`, { id })

      const receipt = await waitForHash(txHash)
      const url = chainId ? explorerTxUrl(chainId, txHash) : undefined
      const action = url
        ? { label: 'View', onClick: () => window.open(url, '_blank') }
        : undefined

      // Invalidate all queries so header balance, agents, activity all refresh.
      void queryClient.invalidateQueries()

      if (receipt.status === 'success') {
        toast.success(url ? `${label} confirmed — view tx` : `${label} confirmed`, {
          id, duration: 8000, action,
        })
        onSuccess?.()
        return txHash
      } else {
        toast.error(url ? 'Reverted onchain — view tx' : 'Reverted onchain', {
          id, duration: 8000, action,
        })
        // Throw so callers (e.g. approve → fund sequence) stop on revert.
        // Attach txHash so Playground can show an inline result link.
        // Mark __toasted so the catch block doesn't double-toast.
        const err = Object.assign(
          new Error('Transaction reverted onchain'),
          { __toasted: true, txHash },
        )
        throw err
      }
    } catch (e) {
      if ((e as { __toasted?: boolean }).__toasted) { throw e }
      const msg = parseOnchainError(e)
      if (msg.startsWith('Cancelled')) {
        toast.dismiss(id)
      } else {
        toast.error(msg, { id })
      }
      throw e
    } finally {
      setIsPending(false)
    }
  }

  return { send, isPending }
}

/**
 * Wait for a transaction receipt using the wagmi public client.
 * Returns the full receipt so callers can inspect receipt.status.
 */
async function waitForHash(hash: `0x${string}`) {
  const { getPublicClient } = await import('wagmi/actions')
  const { config } = await import('../config')
  const client = getPublicClient(config)
  if (!client) throw new Error('No public client available')
  return client.waitForTransactionReceipt({ hash, confirmations: 1 })
}
