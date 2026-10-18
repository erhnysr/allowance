import { ConnectKitButton } from 'connectkit'
import { ShieldCheck, Gauge, Power } from 'lucide-react'
import { ckButtonVars } from './Layout'

export function Hero() {
  return (
    <div className="py-16 flex flex-col items-center text-center gap-10">
      <div className="flex flex-col items-center gap-4">
        <h1 className="text-4xl sm:text-5xl font-light text-[#E6EBF5] tracking-tight text-balance" style={{ fontFamily: "'DM Sans', sans-serif" }}>
          Spending limits for<br />AI agents, enforced onchain.
        </h1>
        <p className="text-[#8C97B2] text-lg max-w-md text-pretty">
          Fund an account once. Set a policy per agent key. Agents can't exceed it, and only you can change it.
        </p>
      </div>

      <ul className="w-full max-w-sm flex flex-col gap-3 text-left">
        {[
          {
            icon: ShieldCheck,
            title: 'Per-payment cap',
            desc: 'No single transfer can exceed the limit you set.',
          },
          {
            icon: Gauge,
            title: 'Refilling budget',
            desc: 'A token bucket refills over time — burst then wait, like a rate limit.',
          },
          {
            icon: Power,
            title: 'Kill switch',
            desc: 'Revoke or freeze instantly. A guardian can freeze without owning the account.',
          },
        ].map(({ icon: Icon, title, desc }) => (
          <li
            key={title}
            className="flex items-start gap-3 p-4 rounded-[20px] bg-[#121B33] border border-[#1F2A47]"
          >
            <span className="mt-0.5 p-1.5 rounded-xl bg-[#A9BDF0]/10">
              <Icon size={16} className="text-[#A9BDF0]" />
            </span>
            <div>
              <p className="font-medium text-[#E6EBF5] text-sm">{title}</p>
              <p className="text-[#8C97B2] text-sm mt-0.5">{desc}</p>
            </div>
          </li>
        ))}
      </ul>

      <div style={ckButtonVars}>
        <ConnectKitButton label="Connect wallet to start" />
      </div>
    </div>
  )
}
