import { useReadContracts } from 'wagmi'
import { accountAbi } from '../lib/abis'
import { useNetwork } from './useNetwork'

export function useAccountData(accountAddress: `0x${string}` | undefined) {
  const { chainId } = useNetwork()

  const contract = {
    address: accountAddress,
    abi: accountAbi,
    chainId: chainId as number,
  } as const

  const { data, isLoading, isError, refetch } = useReadContracts({
    contracts: [
      { ...contract, functionName: 'balance' },
      { ...contract, functionName: 'owner' },
      { ...contract, functionName: 'guardian' },
      { ...contract, functionName: 'frozen' },
      { ...contract, functionName: 'pendingOwner' },
      { ...contract, functionName: 'totalFunded' },
      { ...contract, functionName: 'totalPaid' },
      { ...contract, functionName: 'totalWithdrawn' },
      { ...contract, functionName: 'paymentCount' },
      { ...contract, functionName: 'createdAtBlock' },
    ],
    query: { enabled: !!accountAddress && !!chainId },
  })

  const [
    balance,
    owner,
    guardian,
    frozen,
    pendingOwner,
    totalFunded,
    totalPaid,
    totalWithdrawn,
    paymentCount,
    createdAtBlock,
  ] = data ?? []

  // Consider it an error only if all reads failed (not just some)
  const allFailed = !!data && data.every(r => r.status === 'failure')

  return {
    balance: balance?.result,
    owner: owner?.result,
    guardian: guardian?.result,
    frozen: frozen?.result,
    pendingOwner: pendingOwner?.result,
    totalFunded: totalFunded?.result,
    totalPaid: totalPaid?.result,
    totalWithdrawn: totalWithdrawn?.result,
    paymentCount: paymentCount?.result,
    createdAtBlock: createdAtBlock?.result,
    isLoading,
    isError: isError || allFailed,
    refetch,
  }
}
