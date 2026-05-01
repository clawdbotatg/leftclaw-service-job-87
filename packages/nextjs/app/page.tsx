"use client";

import { useEffect, useMemo, useState } from "react";
import { ConnectButton } from "@rainbow-me/rainbowkit";
import { Address } from "@scaffold-ui/components";
import type { NextPage } from "next";
import { parseUnits } from "viem";
import type { Address as ViemAddress } from "viem";
import { base } from "viem/chains";
import { useAccount, useSwitchChain } from "wagmi";
import deployedContracts from "~~/contracts/deployedContracts";
import { useScaffoldEventHistory, useScaffoldReadContract, useScaffoldWriteContract } from "~~/hooks/scaffold-eth";
import { getParsedError, notification } from "~~/utils/scaffold-eth";

/*
 * CLAWD Rain — a community tipping tool built by a CLAWD community member
 * using LeftClaw Services beta.
 *
 * To the CLAWD core team: if you like this idea and want to build a
 * production-grade version, consider this a proof of concept — take it
 * and run with it. Would love to see it done right.
 *
 * One thing this version doesn't do: integrate with the larv.ai staking
 * contract (0xC9E377FB98a1aA6Ecf4B553cE1b57940121213bf). Eligibility here
 * is based on wallet balance, not stake — meaning larv.ai stakers aren't
 * covered unless they also hold 1M in their wallet. A production version
 * could read totalStaked() and getActiveStakes() from the larv.ai contract
 * to include stakers and use their real stake duration for weighting.
 * That's the version this community deserves.
 *
 * Use at your own risk.
 */

// ---- constants ----------------------------------------------------------------
const CLAWD_DECIMALS = 18;
const MIN_BALANCE_WHOLE = 1_000_000n; // 1M CLAWD
const MIN_TIP_WHOLE = 10_000n; // 10k CLAWD
const MAX_MESSAGE = 280;

const CLAWD_RAIN_ADDRESS = deployedContracts[8453].ClawdRain.address as ViemAddress;

// ---- helpers ------------------------------------------------------------------
const formatClawd = (value: bigint | undefined): string => {
  if (value === undefined) return "0";
  const whole = value / 10n ** BigInt(CLAWD_DECIMALS);
  const frac = value % 10n ** BigInt(CLAWD_DECIMALS);
  // Show 2 decimals when the fractional part is significant.
  const fracStr = (frac * 100n) / 10n ** BigInt(CLAWD_DECIMALS);
  const wholeFmt = whole.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return fracStr > 0n ? `${wholeFmt}.${fracStr.toString().padStart(2, "0")}` : wholeFmt;
};

const formatRelative = (tsSeconds: number): string => {
  const now = Math.floor(Date.now() / 1000);
  const diff = Math.max(0, now - tsSeconds);
  if (diff < 60) return "just now";
  if (diff < 3600) {
    const m = Math.floor(diff / 60);
    return `${m} minute${m === 1 ? "" : "s"} ago`;
  }
  if (diff < 86400) {
    const h = Math.floor(diff / 3600);
    return `${h} hour${h === 1 ? "" : "s"} ago`;
  }
  const d = Math.floor(diff / 86400);
  return `${d} day${d === 1 ? "" : "s"} ago`;
};

const daysSince = (tsSeconds: number): number =>
  Math.max(0, Math.floor((Math.floor(Date.now() / 1000) - tsSeconds) / 86400));

// ----------------------------------------------------------------------------
const Home: NextPage = () => {
  // Only run wagmi-bound logic after the client has hydrated. During the
  // static-export prerender, return a lightweight skeleton so wallet hooks
  // never execute on the server.
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    setMounted(true);
  }, []);
  if (!mounted) {
    return (
      <div className="flex flex-col items-center w-full">
        <div className="w-full max-w-3xl px-4 py-10 flex flex-col gap-6">
          <header className="text-center">
            <h1 className="text-5xl md:text-6xl font-bold tracking-tight mb-2">
              <span aria-hidden>🌧️ </span>CLAWD Rain
            </h1>
            <p className="text-lg opacity-80">Pick up the umbrella or make it rain.</p>
          </header>
          <div className="rain-card p-6 text-center opacity-70">Loading…</div>
        </div>
      </div>
    );
  }
  return <HomeClient />;
};

const HomeClient = () => {
  const { address, isConnected, chainId } = useAccount();
  const { switchChain, isPending: isSwitching } = useSwitchChain();
  const onBase = chainId === base.id;

  // ----- reads -----
  const { data: clawdBalance, refetch: refetchBalance } = useScaffoldReadContract({
    contractName: "CLAWD",
    functionName: "balanceOf",
    args: [address],
  });

  const { data: allowance, refetch: refetchAllowance } = useScaffoldReadContract({
    contractName: "CLAWD",
    functionName: "allowance",
    args: [address, CLAWD_RAIN_ADDRESS],
  });

  const { data: userInfo, refetch: refetchUserInfo } = useScaffoldReadContract({
    contractName: "ClawdRain",
    functionName: "getUserInfo",
    args: [address],
  });

  const { data: registeredCount } = useScaffoldReadContract({
    contractName: "ClawdRain",
    functionName: "getRegisteredCount",
  });

  const {
    data: rainEvents,
    isLoading: eventsLoading,
    refetch: refetchEvents,
  } = useScaffoldEventHistory({
    contractName: "ClawdRain",
    eventName: "ItsRainingClawd",
    fromBlock: undefined,
    watch: true,
    blockData: false,
  });

  // ----- writes -----
  const { writeContractAsync: writeClawdRain } = useScaffoldWriteContract({
    contractName: "ClawdRain",
  });
  const { writeContractAsync: writeClawd } = useScaffoldWriteContract({
    contractName: "CLAWD",
  });

  // ----- derived state -----
  const balance = (clawdBalance as bigint | undefined) ?? 0n;
  const minBalanceWei = MIN_BALANCE_WHOLE * 10n ** BigInt(CLAWD_DECIMALS);
  const minTipWei = MIN_TIP_WHOLE * 10n ** BigInt(CLAWD_DECIMALS);
  const isEligible = balance >= minBalanceWei;

  const registeredTimestamp = userInfo ? Number((userInfo as readonly [bigint, boolean, boolean])[0]) : 0;
  const registered = userInfo ? (userInfo as readonly [bigint, boolean, boolean])[2] : false;
  const registeredDays = registered && registeredTimestamp > 0 ? daysSince(registeredTimestamp) : 0;

  // ----- registration handlers -----
  const [registering, setRegistering] = useState(false);
  const [unregistering, setUnregistering] = useState(false);

  const onRegister = async () => {
    if (registering) return;
    setRegistering(true);
    try {
      await writeClawdRain({ functionName: "register" });
      await Promise.all([refetchUserInfo(), refetchBalance()]);
      notification.success("You stepped into the rain. Welcome.");
    } catch (e) {
      notification.error(getParsedError(e));
    } finally {
      setRegistering(false);
    }
  };

  const onUnregister = async () => {
    if (unregistering) return;
    setUnregistering(true);
    try {
      await writeClawdRain({ functionName: "unregister" });
      await refetchUserInfo();
      notification.success("You left the rain.");
    } catch (e) {
      notification.error(getParsedError(e));
    } finally {
      setUnregistering(false);
    }
  };

  // ----- tip handlers -----
  const [tipAmount, setTipAmount] = useState("");
  const [tipMessage, setTipMessage] = useState("");
  const [approving, setApproving] = useState(false);
  const [tipping, setTipping] = useState(false);

  const tipAmountWei = useMemo<bigint | null>(() => {
    if (!tipAmount.trim()) return null;
    try {
      // Allow "10000" or "10,000" or "10000.5"
      const cleaned = tipAmount.replace(/,/g, "").trim();
      if (!/^[0-9]+(\.[0-9]+)?$/.test(cleaned)) return null;
      return parseUnits(cleaned, CLAWD_DECIMALS);
    } catch {
      return null;
    }
  }, [tipAmount]);

  const messageOver = tipMessage.length > MAX_MESSAGE;
  const tipBelowMin = tipAmountWei !== null && tipAmountWei < minTipWei;
  const allowanceWei = (allowance as bigint | undefined) ?? 0n;
  const needsApproval = tipAmountWei !== null && tipAmountWei > 0n && allowanceWei < tipAmountWei;

  // Mobile WalletConnect hint:
  // We can't programmatically reopen an arbitrary wallet app from a web page —
  // only a user-initiated tap on a wallet-specific deep link works. So when the
  // user is on mobile and using WalletConnect (no injected `window.ethereum`),
  // we surface a transient hint telling them to open their wallet app to
  // confirm the pending transaction. No no-op `window.focus()` calls.
  const [isMobileWcSession, setIsMobileWcSession] = useState(false);
  useEffect(() => {
    if (typeof window === "undefined") return;
    const isMobile = /iPhone|iPad|iPod|Android/i.test(navigator.userAgent);
    const hasInjectedWallet = Boolean((window as unknown as { ethereum?: unknown }).ethereum);
    setIsMobileWcSession(isMobile && !hasInjectedWallet);
  }, []);
  const showMobileWalletHint = isMobileWcSession && (approving || tipping || registering || unregistering);

  const tipDisabled =
    !isConnected ||
    !onBase ||
    tipAmountWei === null ||
    tipAmountWei === 0n ||
    tipBelowMin ||
    messageOver ||
    approving ||
    tipping;

  const onApprove = async () => {
    if (approving || tipAmountWei === null) return;
    setApproving(true);
    try {
      await writeClawd({
        functionName: "approve",
        args: [CLAWD_RAIN_ADDRESS, tipAmountWei],
      });
      // Refetch allowance AFTER block confirmation (writeContractAsync resolves on confirmation).
      await refetchAllowance();
      notification.success("Approval confirmed. You can make it rain now.");
    } catch (e) {
      notification.error(getParsedError(e));
    } finally {
      setApproving(false);
    }
  };

  const onTip = async () => {
    if (tipping || tipAmountWei === null) return;
    setTipping(true);
    try {
      await writeClawdRain({
        functionName: "tip",
        args: [tipAmountWei, tipMessage],
      });
      // Refetch the world.
      await Promise.all([refetchEvents(), refetchAllowance(), refetchBalance(), refetchUserInfo()]);
      setTipAmount("");
      setTipMessage("");
      notification.success("It's raining CLAWD!");
    } catch (e) {
      notification.error(getParsedError(e));
    } finally {
      setTipping(false);
    }
  };

  // Pull events for stats / feed display.
  const events = (rainEvents as ReadonlyArray<any> | undefined) ?? [];
  const feed = useMemo(
    () =>
      events
        .map(ev => {
          const args = ev?.args ?? {};
          return {
            txHash: ev?.transactionHash ?? "",
            logIndex: ev?.logIndex ?? 0,
            rainmaker: args?.rainmaker as ViemAddress | undefined,
            winner: args?.winner as ViemAddress | undefined,
            amount: (args?.amount as bigint | undefined) ?? 0n,
            message: (args?.message as string | undefined) ?? "",
            winnerDuration: Number((args?.winnerDuration as bigint | undefined) ?? 0n),
            timestamp: Number((args?.timestamp as bigint | undefined) ?? 0n),
          };
        })
        .sort((a, b) => b.timestamp - a.timestamp),
    [events],
  );

  const totalTips = feed.length;
  const totalTipped = useMemo(() => feed.reduce((sum, e) => sum + e.amount, 0n), [feed]);

  // Wake-up tick to re-render relative timestamps every 30s.
  const [, setTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setTick(t => t + 1), 30_000);
    return () => clearInterval(id);
  }, []);

  return (
    <div className="flex flex-col items-center w-full">
      <div className="w-full max-w-3xl px-4 py-10 flex flex-col gap-10">
        {/* HEADER */}
        <header className="text-center">
          <h1 className="text-5xl md:text-6xl font-bold tracking-tight mb-2">
            <span aria-hidden>🌧️ </span>CLAWD Rain
          </h1>
          <p className="text-lg opacity-80">Pick up the umbrella or make it rain.</p>
        </header>

        {/* WHAT IS */}
        <section className="rain-card p-6 md:p-8">
          <h2 className="text-2xl font-semibold mb-2">What is CLAWD Rain?</h2>
          <p>
            CLAWD Rain is a community tipping tool. Anyone can tip CLAWD into the contract and one loyal holder is
            randomly selected to receive it.
          </p>
          <p>
            <strong>Rainmaker</strong> — that&apos;s what we call the tipper. You become a Rainmaker by sending CLAWD
            into CLAWD Rain. You make it rain for the community.
          </p>
          <p>
            <strong>How to become a Rainmaker:</strong> Connect your wallet, enter a tip amount (minimum 10,000 CLAWD),
            write an optional message, and send. That&apos;s it.
          </p>
        </section>

        {/* RULES */}
        <section className="rain-card p-6 md:p-8">
          <h2 className="text-2xl font-semibold mb-2">Rules</h2>
          <ul className="list-disc pl-6 space-y-2">
            <li>Hold at least 1,000,000 CLAWD in your wallet and register to be eligible.</li>
            <li>
              Only CLAWD in your wallet counts — CLAWD staked on larv.ai is held by the staking contract, not your
              wallet. You need 1M in the wallet you connect.
            </li>
            <li>Holding more than 1M doesn&apos;t improve your odds — everyone&apos;s equal at the door.</li>
            <li>Your odds are based on ONE thing: how long you&apos;ve been registered.</li>
            <li>1 day registered = 1 ticket. 100 days = 100 tickets. That&apos;s it.</li>
            <li>
              If your wallet balance drops below 1M CLAWD, you are automatically removed the next time a tip is sent and
              your timer resets. You must re-register.
            </li>
            <li>When a Rainmaker tips, one eligible holder is randomly selected, weighted by time.</li>
            <li>The winner receives 100% of the tip.</li>
            <li>Anyone can tip — you don&apos;t need to be registered to be a Rainmaker.</li>
            <li>Tips are voluntary. Tip because you want to, not because you have to.</li>
          </ul>
        </section>

        {/* STEP INTO THE RAIN */}
        <section className="rain-card p-6 md:p-8">
          <h2 className="text-2xl font-semibold mb-4">Step Into The Rain</h2>

          {/* CONNECT / SWITCH / ACTION — one primary action at a time */}
          {!isConnected && (
            <div className="flex flex-col items-start gap-3">
              <p className="opacity-80 m-0">Connect your wallet to check eligibility.</p>
              <ConnectButton.Custom>
                {({ openConnectModal, mounted }) => (
                  <button type="button" className="btn btn-primary" disabled={!mounted} onClick={openConnectModal}>
                    Connect Wallet
                  </button>
                )}
              </ConnectButton.Custom>
            </div>
          )}

          {isConnected && !onBase && (
            <div className="flex flex-col items-start gap-3">
              <p className="opacity-80 m-0">CLAWD Rain lives on Base.</p>
              <button
                type="button"
                className="btn btn-warning"
                disabled={isSwitching}
                onClick={() => switchChain({ chainId: base.id })}
              >
                {isSwitching ? "Switching…" : "Switch to Base"}
              </button>
            </div>
          )}

          {isConnected && onBase && (
            <div className="flex flex-col gap-3">
              <div className="flex flex-col gap-1">
                <span className="text-sm opacity-70">Connected wallet</span>
                <Address address={address} />
              </div>

              <div className="flex flex-col gap-1">
                <span className="text-sm opacity-70">CLAWD balance</span>
                <span className="text-2xl font-mono">{formatClawd(balance)} CLAWD</span>
              </div>

              {!registered && (
                <div className="flex flex-col gap-2">
                  <button
                    type="button"
                    className="btn btn-primary self-start"
                    disabled={!isEligible || registering}
                    onClick={onRegister}
                  >
                    {registering ? "Stepping in…" : isEligible ? "Step Into The Rain" : "Need 1M CLAWD to step in"}
                  </button>
                </div>
              )}

              {registered && (
                <div className="flex flex-col gap-2">
                  <p className="m-0">
                    You&apos;ve been in the rain for{" "}
                    <strong>
                      {registeredDays} day{registeredDays === 1 ? "" : "s"}
                    </strong>
                    .
                  </p>
                  {isEligible ? (
                    <p className="m-0 text-success text-sm">✓ Eligible — keep at least 1M CLAWD.</p>
                  ) : (
                    <p className="m-0 text-warning text-sm">⚠ Below 1M — you&apos;ll be removed on the next tip.</p>
                  )}
                  <button
                    type="button"
                    className="btn btn-outline self-start"
                    disabled={unregistering}
                    onClick={onUnregister}
                  >
                    {unregistering ? "Leaving…" : "Leave The Rain"}
                  </button>
                </div>
              )}

              <p className="text-xs opacity-70 italic mt-2 m-0">
                Registering is free (just gas). This contract never holds, moves, or needs approval over your CLAWD. It
                only reads your public wallet balance — the same info anyone can see on Basescan — to check if
                you&apos;re eligible when a tip drops. You can unregister anytime.
              </p>
            </div>
          )}
        </section>

        {/* TIP PANEL */}
        <section className="rain-card p-6 md:p-8">
          <h2 className="text-2xl font-semibold mb-4">Become a Rainmaker</h2>

          {!isConnected && (
            <ConnectButton.Custom>
              {({ openConnectModal, mounted }) => (
                <button type="button" className="btn btn-primary" disabled={!mounted} onClick={openConnectModal}>
                  Connect Wallet
                </button>
              )}
            </ConnectButton.Custom>
          )}

          {isConnected && !onBase && (
            <button
              type="button"
              className="btn btn-warning"
              disabled={isSwitching}
              onClick={() => switchChain({ chainId: base.id })}
            >
              {isSwitching ? "Switching…" : "Switch to Base"}
            </button>
          )}

          {isConnected && onBase && (
            <div className="flex flex-col gap-3">
              <label className="flex flex-col gap-1">
                <span className="text-sm opacity-80">Tip amount (CLAWD)</span>
                <input
                  type="text"
                  inputMode="decimal"
                  className="input input-bordered w-full"
                  placeholder="10,000"
                  value={tipAmount}
                  onChange={e => setTipAmount(e.target.value)}
                />
                <span className={`text-xs ${tipBelowMin ? "text-error" : "opacity-60"}`}>Minimum 10,000 CLAWD.</span>
              </label>

              <label className="flex flex-col gap-1">
                <span className="text-sm opacity-80">Message (optional)</span>
                <textarea
                  rows={3}
                  className="textarea textarea-bordered w-full"
                  placeholder="for the builders who stayed"
                  value={tipMessage}
                  onChange={e => setTipMessage(e.target.value)}
                />
                <span className={`text-xs ${messageOver ? "text-error" : "opacity-60"}`}>
                  {tipMessage.length} / {MAX_MESSAGE}
                </span>
              </label>

              {/* Single primary action — approve OR tip, never both. */}
              {needsApproval ? (
                <button type="button" className="btn btn-primary self-start" disabled={tipDisabled} onClick={onApprove}>
                  {approving ? (
                    <>
                      <span className="loading loading-spinner loading-xs" /> Approving CLAWD…
                    </>
                  ) : (
                    "Approve CLAWD"
                  )}
                </button>
              ) : (
                <button type="button" className="btn btn-primary self-start" disabled={tipDisabled} onClick={onTip}>
                  {tipping ? (
                    <>
                      <span className="loading loading-spinner loading-xs" /> Making it rain…
                    </>
                  ) : (
                    <>Make It Rain 🌧️</>
                  )}
                </button>
              )}

              {showMobileWalletHint && (
                <p className="text-xs text-blue-300 m-0">Open your wallet app to confirm the transaction.</p>
              )}

              <p className="text-xs opacity-60 m-0">
                Two-step: first approve CLAWD Rain to pull your tokens, then send the tip. Tokens go straight from your
                wallet to the winner — the contract never custodies them.
              </p>
            </div>
          )}
        </section>

        {/* STATS */}
        <section className="rain-card p-6 md:p-8">
          <h2 className="text-2xl font-semibold mb-4">Stats</h2>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="flex flex-col">
              <span className="text-xs uppercase tracking-wide opacity-60">Registered holders</span>
              <span className="text-3xl font-mono">{registeredCount?.toString() ?? "0"}</span>
            </div>
            <div className="flex flex-col">
              <span className="text-xs uppercase tracking-wide opacity-60">Total CLAWD tipped</span>
              <span className="text-3xl font-mono">{formatClawd(totalTipped)}</span>
            </div>
            <div className="flex flex-col">
              <span className="text-xs uppercase tracking-wide opacity-60">Tips sent</span>
              <span className="text-3xl font-mono">{totalTips}</span>
            </div>
          </div>
        </section>

        {/* FEED */}
        <section className="rain-card p-6 md:p-8">
          <h2 className="text-2xl font-semibold mb-4">It&apos;s Raining CLAWD! Hallelujah!</h2>
          {eventsLoading && feed.length === 0 && <p className="opacity-60 m-0">Loading the feed…</p>}
          {!eventsLoading && feed.length === 0 && (
            <p className="opacity-60 m-0">No tips yet. Be the first Rainmaker.</p>
          )}
          <ul className="flex flex-col gap-4 list-none p-0">
            {feed.map(item => (
              <li
                key={`${item.txHash}-${item.logIndex}`}
                className="flex flex-col gap-1 border-b border-base-300 pb-3 last:border-b-0"
              >
                <div className="text-sm font-semibold">🌧️ It&apos;s Raining CLAWD! Hallelujah!</div>
                <div className="text-sm flex flex-wrap gap-1 items-center">
                  <span>Rainmaker</span>
                  {item.rainmaker && <Address address={item.rainmaker} size="sm" />}
                  <span>made it rain</span>
                  <span className="font-mono">{formatClawd(item.amount)} CLAWD</span>
                  <span>→ Winner:</span>
                  {item.winner && <Address address={item.winner} size="sm" />}
                  <span className="opacity-70">
                    (registered {Math.max(1, Math.floor(item.winnerDuration / 86400))} day
                    {Math.max(1, Math.floor(item.winnerDuration / 86400)) === 1 ? "" : "s"})
                  </span>
                </div>
                {item.message && <div className="italic opacity-90 text-sm">&ldquo;{item.message}&rdquo;</div>}
                <div className="text-xs opacity-60">{formatRelative(item.timestamp)}</div>
              </li>
            ))}
          </ul>
        </section>

        {/* CONTRACT REFERENCE */}
        <section className="rain-card p-6 md:p-8">
          <h2 className="text-2xl font-semibold mb-2">Contract</h2>
          <div className="flex flex-col gap-2 text-sm">
            <div className="flex flex-wrap gap-2 items-center">
              <span className="opacity-70">CLAWD Rain:</span>
              <Address address={CLAWD_RAIN_ADDRESS} />
            </div>
            <div className="flex flex-wrap gap-2 items-center">
              <span className="opacity-70">CLAWD token:</span>
              <Address address={"0x9f86dB9fc6f7c9408e8Fda3Ff8ce4e78ac7a6b07" as ViemAddress} />
            </div>
            <p className="text-xs opacity-60 m-0">
              CLAWD is a community token without a USD price feed configured here, so amounts are shown in CLAWD only
              (no USD equivalents).
            </p>
          </div>
        </section>
      </div>
    </div>
  );
};

export default Home;
