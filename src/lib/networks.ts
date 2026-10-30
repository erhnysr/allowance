import { arcTestnet } from 'viem/chains'
import { defineChain, type Chain } from 'viem'

export const USDC_ADDRESS = '0x3600000000000000000000000000000000000000' as const
export const USDC_DECIMALS = 6

// All public RPC endpoints for each network — used for fallback transports
export const ARC_MAINNET_RPCS = [
  'https://rpc.mainnet.arc.io',
  'https://rpc.blockdaemon.mainnet.arc.io',
  'https://rpc.drpc.mainnet.arc.io',
  'https://rpc.quicknode.mainnet.arc.io',
] as const

export const ARC_TESTNET_RPCS = [
  'https://rpc.testnet.arc.io',
  'https://rpc.blockdaemon.testnet.arc.io',
  'https://rpc.drpc.testnet.arc.io',
  'https://rpc.quicknode.testnet.arc.io',
] as const

export const arcMainnet: Chain = defineChain({
  id: 5042,
  name: 'Arc Mainnet',
  nativeCurrency: { name: 'USDC', symbol: 'USDC', decimals: 18 },
  rpcUrls: {
    default: { http: [...ARC_MAINNET_RPCS] },
  },
  blockExplorers: {
    default: { name: 'Arc Explorer', url: 'https://explorer.arc.io' },
  },
})

export interface NetworkConfig {
  chain: Chain
  factoryAddress: `0x${string}`
  explorerUrl: string
  isTestnet: boolean
}

const ALL_NETWORKS: NetworkConfig[] = [
  {
    chain: arcTestnet,
    factoryAddress: '0xd4018d487861eb513e8a756a4e2693d55daff95a',
    explorerUrl: 'https://explorer.testnet.arc.io',
    isTestnet: true,
  },
  {
    chain: arcMainnet,
    factoryAddress: '0xa48fdee3cc6ec2909da8fbec0d2f14032e92c5ec',
    explorerUrl: 'https://explorer.arc.io',
    isTestnet: false,
  },
]

// Only expose networks that have a factory deployed
export const SUPPORTED_NETWORKS = ALL_NETWORKS.filter(n => n.factoryAddress.length > 0)

export function getNetworkConfig(chainId: number): NetworkConfig | undefined {
  return SUPPORTED_NETWORKS.find(n => n.chain.id === chainId)
}

export function explorerTxUrl(chainId: number, hash: string): string {
  const net = getNetworkConfig(chainId)
  return net ? `${net.explorerUrl}/tx/${hash}` : `#`
}

export function explorerAddressUrl(chainId: number, address: string): string {
  const net = getNetworkConfig(chainId)
  return net ? `${net.explorerUrl}/address/${address}` : `#`
}

export function explorerBlockUrl(chainId: number, block: number): string {
  const net = getNetworkConfig(chainId)
  return net ? `${net.explorerUrl}/block/${block}` : `#`
}
