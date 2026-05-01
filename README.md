# 🌧️ CLAWD Rain

A community tipping tool for [CLAWD](https://basescan.org/token/0x9f86dB9fc6f7c9408e8Fda3Ff8ce4e78ac7a6b07)
holders on Base.

> Pick up the umbrella or make it rain.

## Live App

🌧️ **[https://bafybeickjz73ww47wvcpwfhbtsgmb2tkde26otgdxxtj3kahkqdwozaps4.ipfs.community.bgipfs.com/](https://bafybeickjz73ww47wvcpwfhbtsgmb2tkde26otgdxxtj3kahkqdwozaps4.ipfs.community.bgipfs.com/)**

- Contract: [`0x4b5b47903901f4b666553d905952a1880e0d0efa`](https://basescan.org/address/0x4b5b47903901f4b666553d905952a1880e0d0efa)
- CLAWD ERC20: [`0x9f86dB9fc6f7c9408e8Fda3Ff8ce4e78ac7a6b07`](https://basescan.org/address/0x9f86dB9fc6f7c9408e8Fda3Ff8ce4e78ac7a6b07)

## Overview

CLAWD Rain lets anyone (a "Rainmaker") tip CLAWD into the contract; one loyal
holder is randomly selected to receive 100% of the tip. Eligibility is based on
how long you've been registered, not how much CLAWD you hold above the floor.

- **Contract (Base):** `0x4b5b47903901f4b666553d905952a1880e0d0efa`
- **CLAWD ERC-20 (Base):** `0x9f86dB9fc6f7c9408e8Fda3Ff8ce4e78ac7a6b07`
- **Built with:** Scaffold-ETH 2 · LeftClaw Services beta
- **Built for:** the CLAWD community — proof of concept, not production

## What it does

- Connect a wallet, hold ≥ 1,000,000 CLAWD, and `register()` to step into the rain.
- Anyone (registered or not) can `approve()` then `tip()` to make it rain.
- The tip goes 100% to a single registered holder, weighted by how long they've
  been in the rain (1 day = 1 ticket).
- A registered Rainmaker cannot win their own tip (blocked on-chain).
- Drop below 1M CLAWD and you're auto-removed on the next tip — re-register if
  you top up.

## Repo layout

This is a Scaffold-ETH 2 monorepo (Foundry flavor):

- `packages/foundry/contracts/ClawdRain.sol` — the tipping contract (audited, see
  `audits/CONTRACT_AUDIT.md` for the Stage 3 report and Stage 4 resolutions).
- `packages/nextjs/` — the Next.js + RainbowKit frontend, configured for static
  export and IPFS deploy via [bgipfs](https://github.com/BuidlGuidl/bgipfs).
- `packages/nextjs/contracts/deployedContracts.ts` — auto-generated ABI + address
  for the live deployment on Base mainnet (chain `8453`).
- `packages/nextjs/contracts/externalContracts.ts` — manually curated CLAWD
  ERC-20 entry, including OZ v5 custom errors so the frontend can decode
  `ERC20InsufficientAllowance`, `ERC20InsufficientBalance`, etc.

## Run locally

```bash
# 1. Install dependencies
yarn install

# 2. Run the frontend against Base mainnet (the contract is already deployed)
cd packages/nextjs
yarn dev
# Visit http://localhost:3000
```

The dev server will read CLAWD/ClawdRain state from Base mainnet via the
configured Alchemy RPC. To re-deploy or change the contract, see the SE-2 docs
or the Foundry script under `packages/foundry/script/`.

## Build for IPFS

```bash
cd packages/nextjs
yarn build
# Output: packages/nextjs/out/
```

The build is configured for static export (`output: "export"`,
`trailingSlash: true`) and includes a localStorage polyfill at build time so
SE-2 internals don't crash during prerender.

## Limitations & next steps

This is a v1 proof of concept. Things a production version should add:

- **Chainlink VRF v2.5 randomness** in place of `block.prevrandao`-mixed entropy.
  The current scheme is documented as insecure-against-grinding in
  `audits/CONTRACT_AUDIT.md`.
- **larv.ai staking integration.** The current eligibility check only counts
  CLAWD held in the connected wallet — `larv.ai` stakers are excluded unless
  they also keep 1M in their wallet. A production fork can read
  `totalStaked()` / `getActiveStakes()` from the larv.ai staking contract
  (`0xC9E377FB98a1aA6Ecf4B553cE1b57940121213bf`) to give stakers their real
  weighted duration.
- **Paginated cleanup.** `tip()` iterates the registered-user array up to three
  times. Practical cap is ~500–1,000 registrants before tipping becomes
  uneconomic on Base. A future version should expose a `cleanup(start, count)`
  entry point.

## Security Notes

CLAWD Rain is a community-built tipping prototype. The contract is small, has no
admin/owner/upgrade path, and follows checks-effects-interactions throughout — but
there are a few documented limitations a user/integrator should be aware of:

- **Randomness is NOT VRF-grade.** The winner draw uses a keccak256 hash of
  `block.prevrandao`, `blockhash(block.number - 1)`, `block.timestamp`,
  `block.number`, `registeredUsers.length`, `msg.sender`, and `gasleft()`. On Base
  the same `prevrandao` is exposed on roughly six consecutive L2 blocks, but
  `blockhash` changes every L2 block, which shrinks (but does not eliminate) the
  caller-side grinding window. A motivated rainmaker can still simulate `tip()`
  offchain with `eth_call` against successive pending blocks and only broadcast
  when a preferred winner is selected. **Self-tipping is blocked at the contract
  level** (`SelfTipNotAllowed`), but a rainmaker colluding with a non-self
  recipient can still bias outcomes. For higher-stakes use, swap the entropy
  source for Chainlink VRF v2.5 on Base
  (`0xd5D517aBE5cF79B7e95eC98dB0f0277788aFF634`) or move to a commit-reveal
  scheme.
- **O(N) cleanup pass.** `tip()` iterates the `registeredUsers` array up to three
  times (cleanup pass, totalWeight sum, winner walk).
- **Standard ERC20 only.** The contract assumes the configured ERC20 (CLAWD on
  Base) behaves as a vanilla ERC20: no fee-on-transfer, no rebasing, no
  transfer hooks/callbacks.
- **`getRegisteredUsers()` returns the full array.** Frontends should rely on
  events for large registrant counts.
- **Custom error decoding.** `tip()` failures may surface either `ClawdRain`
  custom errors (`TipTooSmall`, `MessageTooLong`, `NoEligibleUsers`,
  `SelfTipNotAllowed`) or OpenZeppelin v5 `IERC20` custom errors. The frontend
  in this repo includes both ABIs.

For the full audit report, see [`audits/CONTRACT_AUDIT.md`](./audits/CONTRACT_AUDIT.md).
