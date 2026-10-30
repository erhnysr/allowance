/**
 * wagmi configuration
 * Built with Arc Studio — https://studio.arc.io
 */

import { http, fallback, createConfig } from 'wagmi'
import { mainnet } from 'wagmi/chains'
import { arcTestnet } from 'viem/chains'
import { injected } from 'wagmi/connectors'
import { registerChain } from './tracing'
import { arcMainnet, ARC_MAINNET_RPCS, ARC_TESTNET_RPCS } from './lib/networks'

// Pre-register chain RPC URLs so trace events show correct chain names immediately
registerChain(arcTestnet.id, ARC_TESTNET_RPCS[0])
registerChain(arcMainnet.id, ARC_MAINNET_RPCS[0])

export const config = createConfig({
  chains: [arcTestnet, arcMainnet, mainnet], // mainnet needed for ENS resolution
  connectors: [injected()],
  transports: {
    [arcTestnet.id]: fallback(ARC_TESTNET_RPCS.map(url => http(url, { retryCount: 2 }))),
    [arcMainnet.id]: fallback(ARC_MAINNET_RPCS.map(url => http(url, { retryCount: 2 }))),
    [mainnet.id]:    http(), // ENS resolution
  },
})
