import { useReadContracts, useReadContract } from 'wagmi'
import { accountAbi } from '../lib/abis'
import { useNetwork } from './useNetwork'

export function useAgentList(accountAddress: `0x${string}` | undefined) {
  const { chainId } = useNetwork()

  const { data: agents, isLoading, isError, refetch } = useReadContract({
    address: accountAddress,
    abi: accountAbi,
    functionName: 'getAgents',
    chainId: chainId as number,
    query: { enabled: !!accountAddress && !!chainId },
  })

  return { agents: agents as `0x${string}`[] | undefined, isLoading, isError, refetch }
}

export function useAgentDetails(
  accountAddress: `0x${string}` | undefined,
  agentAddresses: readonly `0x${string}`[],
) {
  const { chainId } = useNetwork()

  const { data, isLoading, isError, refetch } = useReadContracts({
    contracts: agentAddresses.map(agent => ({
      address: accountAddress,
      abi: accountAbi,
      functionName: 'getAgent' as const,
      args: [agent] as const,
      chainId: chainId as number,
    })),
    query: { enabled: !!accountAddress && !!chainId && agentAddresses.length > 0 },
  })

  return { data, isLoading, isError, refetch }
}

export function useAvailableNow(
  accountAddress: `0x${string}` | undefined,
  agentAddresses: readonly `0x${string}`[],
) {
  const { chainId } = useNetwork()

  const { data, refetch } = useReadContracts({
    contracts: agentAddresses.map(agent => ({
      address: accountAddress,
      abi: accountAbi,
      functionName: 'availableNow' as const,
      args: [agent] as const,
      chainId: chainId as number,
    })),
    query: { enabled: !!accountAddress && !!chainId && agentAddresses.length > 0 },
  })

  return { data, refetch }
}
