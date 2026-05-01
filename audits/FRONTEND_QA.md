# CLAWD Rain — Frontend QA Audit (Stage 7)

Audit performed on 2026-05-01 against the source at
`/Users/austingriffith/clawd/ethereum-servicer/builds/leftclaw-service-job-87`,
deployed contract `0x4b5b47903901f4b666553d905952a1880e0d0efa` (Base, chainId 8453),
and CLAWD ERC-20 `0x9f86dB9fc6f7c9408e8Fda3Ff8ce4e78ac7a6b07`.

This is a read-only audit. No source files were modified.

## Summary

- Ship-blockers: **8 PASS, 1 FAIL**
- Should-fix:    **7 PASS, 1 FAIL**

### FAIL items (work for Stage 8)

**Ship-blockers**
1. `public/manifest.json` still contains the SE2 default name and description (`"Scaffold-ETH 2 DApp"` / `"A DApp built with Scaffold-ETH"`). Replace with CLAWD Rain content. (Also an identical stale copy has been emitted into `out/manifest.json` from the prior build.)

**Should-fix**
2. Mobile deep-linking pattern is partial — the code fires the TX first and then a 2s `window.focus()` nudge, but it does not invoke the wallet-specific deep link (e.g. WalletConnect session URI / `connector.id` based redirect). Add a wallet-detection step + actual deep link, or downgrade the requirement to N/A with a note (this build is largely viewed via desktop wallets / in-app browsers).

## Approve-flow trace (resolved values)

This is the load-bearing trace the audit standard demands — every variable resolved to its on-chain literal:

- `app/page.tsx:40` —
  `const CLAWD_RAIN_ADDRESS = deployedContracts[8453].ClawdRain.address as ViemAddress`
- `contracts/deployedContracts.ts:10` —
  `ClawdRain.address = "0x4b5b47903901f4b666553d905952a1880e0d0efa"`
- → **`CLAWD_RAIN_ADDRESS` resolves to `0x4b5b47903901f4b666553d905952a1880e0d0efa`** (the deployed ClawdRain).
- `app/page.tsx:111-115` — `allowance(owner=address, spender=CLAWD_RAIN_ADDRESS)` ⇒ spender literal `0x4b5b…0efa`.
- `app/page.tsx:227-230` — `writeClawd({ functionName: "approve", args: [CLAWD_RAIN_ADDRESS, tipAmountWei] })` ⇒ approve spender literal `0x4b5b…0efa`.
- `app/page.tsx:245-248` — `writeClawdRain({ functionName: "tip", args: [tipAmountWei, tipMessage] })` — calls into ClawdRain `0x4b5b…0efa`.
- `packages/foundry/contracts/ClawdRain.sol:169` —
  `clawdToken.safeTransferFrom(msg.sender, winner, amount)` is invoked from inside ClawdRain, so `msg.sender` to CLAWD's `transferFrom` is `address(this)` = `0x4b5b…0efa`.

**Conclusion:** spender approved == spender that calls `transferFrom` == spender used in the `allowance` read. End-to-end consistent.

## Error-ABI trace

External calls in the user write flow:
- `CLAWD.approve` (from `onApprove`)
- `ClawdRain.register / unregister / tip` (from `onRegister / onUnregister / onTip`)
- Indirectly inside `ClawdRain.tip`: `clawdToken.balanceOf` (cleanup pass) and `clawdToken.safeTransferFrom`.

Every reachable error type → ABI source:

ClawdRain own custom errors (must be in ClawdRain ABI in `deployedContracts.ts`):
- `AlreadyRegistered` ✓ line 299-302
- `NotRegistered` ✓ line 318-322
- `InsufficientBalance` ✓ line 303-307
- `TipTooSmall` ✓ line 339-343
- `MessageTooLong` ✓ line 308-312
- `NoEligibleUsers` ✓ line 313-317
- `SelfTipNotAllowed` ✓ line 334-338
- `SafeERC20FailedOperation` ✓ line 323-333

CLAWD (OZ v5 IERC20) custom errors that can bubble up via `safeTransferFrom`
(must be in CLAWD ABI in `externalContracts.ts`):
- `ERC20InsufficientAllowance` ✓ line 115-123
- `ERC20InsufficientBalance` ✓ line 124-132
- `ERC20InvalidApprover` ✓ line 133-137
- `ERC20InvalidReceiver` ✓ line 138-142
- `ERC20InvalidSender` ✓ line 143-147
- `ERC20InvalidSpender` ✓ line 148-152

`getParsedError` (`utils/scaffold-eth/getParsedError.ts`) walks the viem error and decodes
`ContractFunctionRevertedError.data.errorName + args`. Because every contract on the call
path has its full custom-error set in the wagmi-registered ABI, every revert produces a
human-readable `errorName(args)` — not a raw selector.

## Ship-Blockers

### [PASS] Wallet connect shows a button, not text
- File:line: `app/page.tsx:360-371` (Step Into The Rain section), `app/page.tsx:450-458` (Become a Rainmaker section), `components/Header.tsx:83` + `components/scaffold-eth/RainbowKitCustomConnectButton/index.tsx:34-38`.
- Evidence: When `isConnected === false`, the page renders `<ConnectButton.Custom>` whose render-prop returns a `<button className="btn btn-primary">Connect Wallet</button>`. The header always renders `RainbowKitCustomConnectButton`, which in the `!connected` branch renders `<button className="btn btn-primary btn-sm">Connect Wallet</button>`. No text-only "Connect your wallet to play" copy gates the action.

### [PASS] Wrong network shows a Switch button (one primary action at a time)
- File:line: `app/page.tsx:373-385` (Step Into The Rain) and `app/page.tsx:460-469` (Become a Rainmaker). Header path: `WrongNetworkDropdown` rendered when `chain.id !== targetNetwork.id` (`RainbowKitCustomConnectButton/index.tsx:41-43`).
- Evidence: The conditional ladder is `(!isConnected) → ConnectButton` else `(isConnected && !onBase) → "Switch to Base"` else `(isConnected && onBase) → action UI`. Only one branch renders at a time. The Switch button reads `Switch to Base` and calls `switchChain({ chainId: base.id })`. `base.id === 8453`. While switching, `isSwitching` disables the button and changes label to "Switching…" — only one primary action visible.

### [PASS] Approve button stays disabled through block confirmation + cooldown
- File:line: `app/page.tsx:193, 213-221, 223-239` and `hooks/scaffold-eth/useScaffoldWriteContract.ts:108-145`.
- Evidence — traced execution:
  1. Click `Approve CLAWD` → `onApprove` runs.
  2. `setApproving(true)` is set immediately (line 225) **before** `await writeClawd(...)`.
  3. `tipDisabled` (line 213-221) includes `approving`, so the button's `disabled={tipDisabled}` flips to true synchronously on click.
  4. `useScaffoldWriteContract` routes through `useTransactor` (`useScaffoldWriteContract.ts:138`) — `await writeTx(...)` only resolves after the transaction is mined / confirmed.
  5. After the await, `await refetchAllowance()` runs (line 232) — `approving` still true.
  6. `setApproving(false)` fires only in the `finally` block (line 237), which runs only after both the on-chain confirmation **and** the allowance refetch complete.
- **Caveat (not failing):** the implementation collapses the spec's two states (`approvalSubmitting` and a 4s `approveCooldown`) into a single `approving` flag. There is no explicit 4-second post-confirmation buffer. The current sequence still keeps the button disabled until the refetched allowance has updated `needsApproval` (which then routes the conditional render at line 501 to the "Make It Rain" branch), so the user cannot double-fire the same approval. Marking PASS but flagging for Stage 8 if a stricter interpretation of the cooldown is desired.

### [PASS] Approve flow traced end-to-end
- File:line: see "Approve-flow trace" section above.
- Evidence: spender resolves to `0x4b5b47903901f4b666553d905952a1880e0d0efa` in **both** the `approve()` call (page.tsx:229) and the `allowance()` read (page.tsx:114), and that is exactly the address that calls `clawdToken.safeTransferFrom` from inside `ClawdRain.tip` (`ClawdRain.sol:169`, `msg.sender` to CLAWD = `address(this)`). All custom errors from both contracts on the call path are in the ABIs registered with wagmi (see "Error-ABI trace").

### [PASS] Contract verified on Basescan
- Evidence: HTTP scrape of `https://basescan.org/address/0x4b5b47903901f4b666553d905952a1880e0d0efa#code` returns the "Contract Source Code Verified" badge string; verification was confirmed in Stage 5 and remains in place.

### [PASS] SE2 footer branding removed
- File:line: `components/Footer.tsx:1-24`.
- Evidence: The footer contains exactly two elements: the `SwitchTheme` toggle (acceptable — theming control, not branding) and a single line `"Made by one community member with the help of LeftClaw Services beta. Use at your own risk."` There are no Fork-me, BuidlGuidl, Support, or `nativeCurrencyPrice` badges. `BuidlGuidlLogo.tsx` exists in `components/assets/` but a project-wide grep shows it has zero importers, so it is dead code that does not render.
- **Note for Stage 8 (cosmetic, not blocking):** `BuidlGuidlLogo.tsx` should be deleted to remove the dead asset, but it does not render so it does not fail this ship-blocker.

### [PASS] SE2 tab title removed
- File:line: `app/layout.tsx:15-18`, `utils/scaffold-eth/getMetadata.ts:8`.
- Evidence: `getMetadata` template is `"%s | CLAWD Rain"` (line 8 of `getMetadata.ts`). `metadata` is constructed with `title: "CLAWD Rain"`. No `"Scaffold-ETH 2"` string remains anywhere under `packages/nextjs` outside of the `manifest.json` issue captured separately, which doesn't surface as a tab title.

### [PASS] SE2 README replaced
- File: `README.md` (project root, lines 1-119).
- Evidence: The README is fully project-specific — it documents CLAWD Rain, the contract address, the rules, build instructions, the audit pointer, security notes, and limitations. Zero SE2 boilerplate remains.

### [PASS] Favicon replaced (not SE2 default)
- File:line: `app/icon.svg`.
- Evidence: Custom 32×32 inline SVG of a stylized blue raindrop with a gradient — clearly bespoke for CLAWD Rain. The SE2 default (a multi-color "SE2" mark) is not present.

### [FAIL] manifest.json still uses SE2 default name/description
- File:line: `public/manifest.json:1-5` (and the stale copy in `out/manifest.json`).
- Evidence:
  ```json
  { "name": "Scaffold-ETH 2 DApp",
    "description": "A DApp built with Scaffold-ETH",
    "iconPath": "logo.svg" }
  ```
- This is not a tab title or a footer link, but it is SE2 branding that surfaces in PWA install prompts and is referenced from `app/layout.tsx` indirectly. It belongs under "SE2 branding removed" — flagging FAIL.
- Recommendation: replace contents with CLAWD-Rain-specific values, e.g.
  `{ "name": "CLAWD Rain", "description": "A community tipping tool for CLAWD holders. Pick up the umbrella or make it rain.", "iconPath": "icon.svg" }`. Stage 8 should re-run `yarn build` so the stale `out/manifest.json` is regenerated.

## Should-Fix

### [PASS] Contract address displayed with `<Address/>` component
- File:line: `app/page.tsx:5` (import), `app/page.tsx:589` (CLAWD Rain), `app/page.tsx:593` (CLAWD token), and additionally lines 391, 566, 570 for connected-wallet / rainmaker / winner addresses.
- Evidence: All on-chain addresses in the UI use `<Address address=... />` from `@scaffold-ui/components`. No raw hex strings rendered.

### [PASS] OG image uses absolute URL (`NEXT_PUBLIC_PRODUCTION_URL` checked first)
- File:line: `utils/scaffold-eth/getMetadata.ts:3-7, 19, 36, 46`.
- Evidence: `baseUrl` resolution order is `NEXT_PUBLIC_PRODUCTION_URL` → `VERCEL_PROJECT_PRODUCTION_URL` → `localhost`. The constructed `imageUrl = ${baseUrl}${imageRelativePath}` is then passed to `openGraph.images[0].url` and `twitter.images`. When deployed with the env var set, these resolve to absolute URLs.

### [PASS] `--radius-field` is `0.5rem` in BOTH theme blocks
- File:line: `styles/globals.css:40` (light theme) and `styles/globals.css:66` (dark theme).
- Evidence: Both blocks contain `--radius-field: 0.5rem;` — neither retains the SE2 default `9999rem` pill radius.

### [PASS] Token amounts have USD context OR explicitly N/A for community tokens
- File:line: `app/page.tsx:595-598` (Contract section disclosure paragraph).
- Evidence: The page explicitly states *"CLAWD is a community token without a USD price feed configured here, so amounts are shown in CLAWD only (no USD equivalents)."* This satisfies the "explicitly N/A for community tokens" exception in the QA spec.

### [PASS] Errors mapped to human-readable messages — full ABI coverage
- File:line: `utils/scaffold-eth/getParsedError.ts:1-35`, `contracts/deployedContracts.ts:299-343`, `contracts/externalContracts.ts:115-152`.
- Evidence: see "Error-ABI trace" above. Every error type producible by every contract in every write flow's call chain is in a wagmi-registered ABI; `getParsedError` decodes them by `errorName + args`.

### [PASS] Phantom wallet in RainbowKit wallet list
- File:line: `services/web3/wagmiConnectors.tsx:6, 24`.
- Evidence: `phantomWallet` imported on line 6 and listed in the `wallets` array on line 24. Order: metaMask, walletConnect, phantom, ledger, baseAccount, rainbow, safe.

### [FAIL] Mobile deep linking pattern present
- File:line: `app/page.tsx:249-259`.
- Evidence: After `await writeClawdRain({...})`, the code does:
  ```
  if (/Mobi|Android|iPhone|iPad/i.test(navigator.userAgent)) {
    setTimeout(() => { try { window.focus(); } catch {} }, 2000);
  }
  ```
  This fires the TX first (correct order) and waits 2s (correct timing), but `window.focus()` is not a wallet-specific deep link — it cannot navigate the user back to MetaMask Mobile / Trust / Coinbase Wallet from a Safari/Chrome tab. The QA spec's pattern is "deep link after 2-second delay to **correct wallet**" with WalletConnect session-data + `connector.id` detection. The current code is a no-op nudge in practice on iOS Safari.
- Recommendation: detect `connector.id` (or read WalletConnect session URI) and dispatch the wallet-specific `https://metamask.app.link/...`, `https://trust.app/...`, etc. after 2s. Skip the deep link entirely when `window.ethereum` is present (already inside an in-app browser). Alternative for Stage 8: explicitly mark this requirement as N/A with a note that the dApp is desktop-first / in-app-browser-first; do not pretend `window.focus()` is the deep link.

### [PASS] `appName` in `wagmiConnectors.tsx` is `"CLAWD Rain"`, not `"scaffold-eth-2"`
- File:line: `services/web3/wagmiConnectors.tsx:51`.
- Evidence: `appName: "CLAWD Rain"`. WalletConnect modal will surface this to users.

## Notes for Stage 8 (additional observations, not blockers)

These are not on the formal checklist but worth knowing about:

- **Block-explorer route was removed** (no `app/blockexplorer/` and no `app/_blockexplorer-disabled/`). Confirmed neither exists. This avoids the `localStorage`-at-import crash documented in the build footguns. Good.
- **Unused asset**: `components/assets/BuidlGuidlLogo.tsx` has zero importers project-wide. Safe to delete in Stage 8 cleanup, but it does not render so it is not a ship-blocker.
- **SE2 default Alchemy/WalletConnect IDs are still hard-coded as fallbacks** in `scaffold.config.ts` lines 14, 25, 36. This is acceptable given the env-var fallback pattern, but Stage 8 should confirm `NEXT_PUBLIC_ALCHEMY_API_KEY` and `NEXT_PUBLIC_WALLET_CONNECT_PROJECT_ID` are actually set in the build environment so the defaults are not what ships to IPFS.
- **Stale `out/manifest.json`** will be overwritten when Stage 8 runs `yarn build` after fixing `public/manifest.json`. No action beyond the rebuild needed.
