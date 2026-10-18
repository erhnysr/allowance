import { useState, useEffect, useCallback } from 'react'
import { useAccount } from 'wagmi'
import { isAddress } from 'viem'
import { Shell, Sidebar, MobileTopBar, type NavItem } from './components/Layout'
import { Hero } from './components/Hero'
import { AccountList } from './components/AccountList'
import { AccountDetail } from './components/AccountDetail'
import { useNetwork } from './hooks/useNetwork'

// ── URL hash helpers ──────────────────────────────────────────────────────────
// Hash format: #/account/<address>/<tab>
// e.g. #/account/0xabc123.../agents

const VALID_TABS: NavItem[] = ['overview', 'agents', 'payees', 'playground', 'activity']

function parseHash(): { account: `0x${string}` | null; tab: NavItem } {
  const hash = window.location.hash.slice(1) // remove leading #
  const parts = hash.split('/').filter(Boolean) // ['account', '0x...', 'agents']
  if (parts[0] === 'account' && parts[1] && isAddress(parts[1])) {
    const tab = VALID_TABS.includes(parts[2] as NavItem) ? (parts[2] as NavItem) : 'overview'
    return { account: parts[1], tab }
  }
  return { account: null, tab: 'overview' }
}

function buildHash(account: `0x${string}` | null, tab: NavItem): string {
  if (!account) return ''
  return `#/account/${account}/${tab}`
}

export default function App() {
  const { isConnected } = useAccount()
  const { net } = useNetwork()
  const isTestnet = net?.isTestnet ?? false

  // ── State initialised from URL hash ──────────────────────────────────────────
  const [selectedAccount, setSelectedAccount] = useState<`0x${string}` | null>(() => parseHash().account)
  const [activeNav, setActiveNav] = useState<NavItem>(() => parseHash().tab)

  // ── Keep hash in sync with state ──────────────────────────────────────────────
  useEffect(() => {
    const newHash = buildHash(selectedAccount, activeNav)
    if (window.location.hash !== newHash) {
      // pushState so the Back button works
      window.history.pushState(null, '', newHash || window.location.pathname)
    }
  }, [selectedAccount, activeNav])

  // ── Back button (popstate) ────────────────────────────────────────────────────
  const handlePopState = useCallback(() => {
    const { account, tab } = parseHash()
    setSelectedAccount(account)
    setActiveNav(tab)
  }, [])

  useEffect(() => {
    window.addEventListener('popstate', handlePopState)
    return () => window.removeEventListener('popstate', handlePopState)
  }, [handlePopState])

  // ── Navigation handlers ───────────────────────────────────────────────────────
  function handleSelectAccount(addr: `0x${string}`) {
    setSelectedAccount(addr)
    setActiveNav('overview')
  }

  function handleBack() {
    setSelectedAccount(null)
    setActiveNav('overview')
  }

  function handleNav(item: NavItem) {
    if (!selectedAccount && item === 'overview') return
    setActiveNav(item)
  }

  const navProps = {
    activeItem: selectedAccount ? activeNav : null,
    onNav: handleNav,
    showAccountNav: !!selectedAccount,
    isTestnet,
  }

  return (
    <Shell
      sidebar={<Sidebar {...navProps} />}
      mobileBar={<MobileTopBar {...navProps} />}
    >
      {/* Not connected */}
      {!isConnected && (
        <div className="max-w-xl mx-auto">
          <Hero />
        </div>
      )}

      {/* Connected, no account selected */}
      {isConnected && !selectedAccount && (
        <div className="max-w-lg mx-auto">
          <AccountList onSelectAccount={handleSelectAccount} />
        </div>
      )}

      {/* Account detail */}
      {isConnected && selectedAccount && (
        <AccountDetail
          accountAddress={selectedAccount}
          activeNav={activeNav}
          onBack={handleBack}
        />
      )}
    </Shell>
  )
}
