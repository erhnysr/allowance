import { useAccount } from 'wagmi'
import { getNetworkConfig, SUPPORTED_NETWORKS, type NetworkConfig } from '../lib/networks'

export function useNetwork(): { net: NetworkConfig | undefined; chainId: number | undefined } {
  const { chainId } = useAccount()
  const net = chainId ? getNetworkConfig(chainId) : undefined
  return { net, chainId }
}

export { SUPPORTED_NETWORKS }
