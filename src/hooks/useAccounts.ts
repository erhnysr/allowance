import { useReadContract } from 'wagmi'
import { useAccount } from 'wagmi'
import { factoryAbi } from '../lib/abis'
import { useNetwork } from './useNetwork'

export function useAccounts() {
  const { address } = useAccount()
  const { net, chainId } = useNetwork()

  const { data: accounts, isLoading, refetch } = useReadContract({
    address: net?.factoryAddress,
    abi: factoryAbi,
    functionName: 'accountsOf',
    args: address ? [address] : undefined,
    chainId: chainId as number,
    query: { enabled: !!net && !!address },
  })

  return {
    accounts: accounts as `0x${string}`[] | undefined,
    isLoading,
    refetch,
  }
}
