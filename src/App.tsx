import { useMemo, useState } from "react";
import { Settings } from "./components/Settings";
import {
  CHAIN_LABEL,
  EXPLORER_CONTRACT,
  EXPLORER_TX,
  MAX_CALLS_PER_TX,
} from "./config";
import { makeProvider } from "./lib/provider";
import {
  connectWallet,
  disconnectWallet,
  isOnTargetChain,
  type WalletConnection,
} from "./lib/wallet";
import {
  lookupErc20,
  lookupNft,
  scanErc20,
  scanNfts,
} from "./lib/discovery";
import {
  addressesEqual,
  formatUnits,
  normalizeAddress,
  parseUnits,
  shortenAddress,
} from "./lib/format";
import type { Asset, Erc20Asset, NftAsset } from "./lib/types";
import {
  buildCalls,
  buildOwnershipChallenge,
  chunk,
  estimateFee,
  executeCalls,
  randomNonce,
  verifyOwnership,
  type MigrationItem,
} from "./lib/migrate";

type ProofState =
  | { status: "none" }
  | { status: "verifying" }
  | { status: "verified"; signer: string }
  | { status: "failed"; message: string };

interface TxState {
  hash: string;
  status: "submitted" | "confirmed" | "reverted" | "error";
  note?: string;
}

type MigrateStatus =
  | "idle"
  | "estimating"
  | "estimated"
  | "executing"
  | "done"
  | "error";

const STEPS = ["Connect", "Recipient", "Assets", "Review"] as const;

function gasBufferRaw(a: Erc20Asset): bigint {
  if (!a.isGasToken) return 0n;
  if (a.symbol === "ETH") return parseUnits("0.0005", a.decimals);
  if (a.symbol === "STRK") return parseUnits("1", a.decimals);
  return 0n;
}

function defaultAmountInput(a: Asset): string {
  if (a.kind === "erc20") {
    const keep = gasBufferRaw(a);
    const send = a.balance > keep ? a.balance - keep : 0n;
    return formatUnits(send, a.decimals);
  }
  if (a.kind === "erc1155") return a.balance.toString();
  return "1";
}

export default function App() {
  const [showSettings, setShowSettings] = useState(false);
  const [step, setStep] = useState(0);

  // Sending wallet
  const [sender, setSender] = useState<WalletConnection | null>(null);
  const [connecting, setConnecting] = useState(false);
  const [connectError, setConnectError] = useState<string>();

  // Recipient
  const [recipientInput, setRecipientInput] = useState("");
  const recipient = useMemo(
    () => normalizeAddress(recipientInput),
    [recipientInput],
  );
  const [proof, setProof] = useState<ProofState>({ status: "none" });

  // Assets
  const [scanning, setScanning] = useState(false);
  const [erc20s, setErc20s] = useState<Erc20Asset[]>([]);
  const [nfts, setNfts] = useState<NftAsset[]>([]);
  const [nftNotice, setNftNotice] = useState<string>();
  const [tokenNotice, setTokenNotice] = useState<string>();
  const [selected, setSelected] = useState<Record<string, boolean>>({});
  const [amounts, setAmounts] = useState<Record<string, string>>({});

  // Manual add
  const [manualToken, setManualToken] = useState("");
  const [manualNftAddr, setManualNftAddr] = useState("");
  const [manualNftId, setManualNftId] = useState("");
  const [manualBusy, setManualBusy] = useState(false);
  const [manualError, setManualError] = useState<string>();

  // Migration
  const [mStatus, setMStatus] = useState<MigrateStatus>("idle");
  const [feeText, setFeeText] = useState<string>();
  const [mError, setMError] = useState<string>();
  const [txs, setTxs] = useState<TxState[]>([]);

  const allAssets: Asset[] = useMemo(() => [...erc20s, ...nfts], [erc20s, nfts]);
  const chainOk = sender ? isOnTargetChain(sender.chainId) : true;

  const selectedItems: MigrationItem[] = useMemo(() => {
    const items: MigrationItem[] = [];
    for (const a of allAssets) {
      if (!selected[a.id]) continue;
      const raw = amounts[a.id] ?? defaultAmountInput(a);
      try {
        if (a.kind === "erc20") {
          let amt = parseUnits(raw, a.decimals);
          if (amt > a.balance) amt = a.balance;
          if (amt > 0n) items.push({ asset: a, amount: amt });
        } else if (a.kind === "erc1155") {
          let amt = BigInt(raw || "0");
          if (amt > a.balance) amt = a.balance;
          if (amt > 0n) items.push({ asset: a, amount: amt });
        } else {
          items.push({ asset: a, amount: 1n });
        }
      } catch {
        /* invalid amount — skip from build, surfaced in UI */
      }
    }
    return items;
  }, [allAssets, selected, amounts]);

  // ---- handlers ---------------------------------------------------------

  async function handleConnect() {
    setConnectError(undefined);
    setConnecting(true);
    try {
      const w = await connectWallet("alwaysAsk");
      if (w) {
        setSender(w);
        setStep(1);
      }
    } catch (e: any) {
      setConnectError(e?.message ?? "Failed to connect.");
    } finally {
      setConnecting(false);
    }
  }

  async function handleDisconnect() {
    await disconnectWallet();
    setSender(null);
    setErc20s([]);
    setNfts([]);
    setSelected({});
    setAmounts({});
    setProof({ status: "none" });
    setTxs([]);
    setMStatus("idle");
    setFeeText(undefined);
    setStep(0);
  }

  async function handleProve() {
    if (!sender || !recipient) return;
    setProof({ status: "verifying" });
    try {
      const w = await connectWallet("alwaysAsk");
      if (!w) {
        setProof({ status: "none" });
        return;
      }
      if (!addressesEqual(w.address, recipient)) {
        setProof({
          status: "failed",
          message: `Connected wallet ${shortenAddress(w.address)} does not match the recipient ${shortenAddress(recipient)}.`,
        });
        return;
      }
      const typedData = buildOwnershipChallenge({
        sender: sender.address,
        receiver: recipient,
        nonce: randomNonce(),
      });
      const signature = await w.account.signMessage(typedData);
      const ok = await verifyOwnership(w.account, typedData, signature, recipient);
      if (ok) {
        setProof({ status: "verified", signer: w.address });
      } else {
        setProof({
          status: "failed",
          message:
            "Signature did not verify on-chain. The account may be undeployed, or the signature was rejected.",
        });
      }
    } catch (e: any) {
      setProof({
        status: "failed",
        message: e?.message ?? "Could not get a signature.",
      });
    }
  }

  async function handleScan() {
    if (!sender) return;
    setScanning(true);
    setNftNotice(undefined);
    setTokenNotice(undefined);
    try {
      const provider = makeProvider();
      const [tokenRes, nftRes] = await Promise.all([
        scanErc20(provider, sender.address),
        scanNfts(sender.address),
      ]);
      setErc20s(tokenRes.assets);
      setTokenNotice(tokenRes.notice);
      setNfts(nftRes.assets);
      if (nftRes.error) setNftNotice(nftRes.error);
      const sel: Record<string, boolean> = {};
      const amt: Record<string, string> = {};
      for (const a of [...tokenRes.assets, ...nftRes.assets]) {
        sel[a.id] = true;
        amt[a.id] = defaultAmountInput(a);
      }
      setSelected(sel);
      setAmounts(amt);
    } finally {
      setScanning(false);
    }
  }

  async function handleAddToken() {
    if (!sender || !manualToken.trim()) return;
    setManualBusy(true);
    setManualError(undefined);
    try {
      const asset = await lookupErc20(makeProvider(), manualToken, sender.address);
      if (asset.balance <= 0n) {
        setManualError("That token has a zero balance in this wallet.");
        return;
      }
      if (erc20s.some((t) => t.id === asset.id)) {
        setManualError("Token already in the list.");
        return;
      }
      setErc20s((prev) => [...prev, asset]);
      setSelected((s) => ({ ...s, [asset.id]: true }));
      setAmounts((m) => ({ ...m, [asset.id]: defaultAmountInput(asset) }));
      setManualToken("");
    } catch (e: any) {
      setManualError(e?.message ?? "Lookup failed.");
    } finally {
      setManualBusy(false);
    }
  }

  async function handleAddNft() {
    if (!sender || !manualNftAddr.trim() || !manualNftId.trim()) return;
    setManualBusy(true);
    setManualError(undefined);
    try {
      const asset = await lookupNft(
        makeProvider(),
        manualNftAddr,
        manualNftId,
        sender.address,
      );
      if (nfts.some((n) => n.id === asset.id)) {
        setManualError("NFT already in the list.");
        return;
      }
      setNfts((prev) => [...prev, asset]);
      setSelected((s) => ({ ...s, [asset.id]: true }));
      setAmounts((m) => ({ ...m, [asset.id]: "1" }));
      setManualNftAddr("");
      setManualNftId("");
    } catch (e: any) {
      setManualError(e?.message ?? "Lookup failed.");
    } finally {
      setManualBusy(false);
    }
  }

  async function handleEstimate() {
    if (!sender || !recipient) return;
    setMStatus("estimating");
    setMError(undefined);
    setFeeText(undefined);
    try {
      const calls = buildCalls(selectedItems, sender.address, recipient);
      if (calls.length === 0) {
        setMError("No assets selected.");
        setMStatus("idle");
        return;
      }
      const est = await estimateFee(sender.account, calls);
      const overall = (est as any).overall_fee ?? (est as any).suggestedMaxFee;
      const unit = (est as any).unit;
      const tokenLabel = unit === "WEI" ? "ETH" : unit === "FRI" ? "STRK" : "";
      if (overall != null) {
        setFeeText(`${formatUnits(BigInt(overall), 18)} ${tokenLabel}`.trim());
      } else {
        setFeeText("estimated");
      }
      setMStatus("estimated");
    } catch (e: any) {
      setMError(
        `Fee estimate failed: ${e?.message ?? e}. If you are sending most of your ETH/STRK, keep more of the gas token and try again.`,
      );
      setMStatus("error");
    }
  }

  async function handleMigrate() {
    if (!sender || !recipient) return;
    setMStatus("executing");
    setMError(undefined);
    setTxs([]);
    const provider = makeProvider();
    try {
      const calls = buildCalls(selectedItems, sender.address, recipient);
      const batches = chunk(calls, MAX_CALLS_PER_TX);
      for (let i = 0; i < batches.length; i++) {
        const { transactionHash } = await executeCalls(sender.account, batches[i]);
        setTxs((prev) => [
          ...prev,
          {
            hash: transactionHash,
            status: "submitted",
            note:
              batches.length > 1 ? `Batch ${i + 1} of ${batches.length}` : undefined,
          },
        ]);
        try {
          await provider.waitForTransaction(transactionHash);
          setTxs((prev) =>
            prev.map((t) =>
              t.hash === transactionHash ? { ...t, status: "confirmed" } : t,
            ),
          );
        } catch (waitErr: any) {
          setTxs((prev) =>
            prev.map((t) =>
              t.hash === transactionHash
                ? { ...t, status: "reverted", note: waitErr?.message }
                : t,
            ),
          );
        }
      }
      setMStatus("done");
    } catch (e: any) {
      setMError(e?.message ?? "Transaction failed or was rejected.");
      setMStatus("error");
    }
  }

  function toggle(id: string) {
    setSelected((s) => ({ ...s, [id]: !s[id] }));
  }
  function setAmt(id: string, v: string) {
    setAmounts((m) => ({ ...m, [id]: v }));
  }

  // ---- render -----------------------------------------------------------

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <span className="logo">⇄</span>
          <div>
            <h1>Starknet Wallet Migrator</h1>
            <span className="badge">{CHAIN_LABEL}</span>
          </div>
        </div>
        <div className="topbar-right">
          {sender && (
            <span className="wallet-pill" title={sender.address}>
              {sender.walletName}: {shortenAddress(sender.address)}
              <button className="link" onClick={handleDisconnect}>
                disconnect
              </button>
            </span>
          )}
          <button className="icon-btn" onClick={() => setShowSettings(true)}>
            ⚙ Settings
          </button>
        </div>
      </header>

      {!chainOk && (
        <div className="banner warn">
          Connected wallet is not on {CHAIN_LABEL}. Switch the network in your
          wallet — this app only operates on mainnet.
        </div>
      )}

      <div className="stepper">
        {STEPS.map((s, i) => (
          <button
            key={s}
            className={`stepper-item ${i === step ? "active" : ""} ${i < step ? "done" : ""}`}
            disabled={i > step && !(i === 1 && sender) }
            onClick={() => i <= step && setStep(i)}
          >
            <span className="step-num">{i + 1}</span>
            {s}
          </button>
        ))}
      </div>

      <main className="content">
        {step === 0 && (
          <Section
            title="1 · Connect the sending wallet"
            sub="Connect the wallet you want to migrate assets out of. The app never sees your keys — your wallet signs everything."
          >
            {sender ? (
              <div className="ok-row">
                <span className="dot ok" /> Connected:{" "}
                <code>{sender.address}</code>
                <button className="btn primary" onClick={() => setStep(1)}>
                  Continue →
                </button>
              </div>
            ) : (
              <button
                className="btn primary big"
                onClick={handleConnect}
                disabled={connecting}
              >
                {connecting ? "Connecting…" : "Connect wallet"}
              </button>
            )}
            {connectError && <p className="error">{connectError}</p>}
          </Section>
        )}

        {step === 1 && (
          <Section
            title="2 · Set the receiving wallet"
            sub="Paste the destination Starknet address. Double-check it — transfers are irreversible. Optionally prove you control it by signing a challenge."
          >
            <label className="field">
              <span>Recipient address</span>
              <input
                value={recipientInput}
                onChange={(e) => {
                  setRecipientInput(e.target.value);
                  setProof({ status: "none" });
                }}
                placeholder="0x…"
                spellCheck={false}
              />
              {recipientInput && !recipient && (
                <small className="error">Not a valid Starknet address.</small>
              )}
              {recipient && (
                <small className="muted">Parsed: {recipient}</small>
              )}
              {recipient && sender && addressesEqual(recipient, sender.address) && (
                <small className="error">
                  Recipient is the same as the sending wallet.
                </small>
              )}
            </label>

            <div className="proof-box">
              <div className="proof-head">
                <strong>Optional: prove ownership</strong>
                {proof.status === "verified" && (
                  <span className="tag ok">✓ Verified on-chain</span>
                )}
                {proof.status === "failed" && (
                  <span className="tag bad">✗ Not verified</span>
                )}
              </div>
              <p className="muted">
                Connect the receiving wallet and sign a gas-free message. The
                signature is checked against the address on-chain, confirming you
                control it. Skip this if the destination is a cold/hardware
                wallet you can&apos;t connect here.
              </p>
              <button
                className="btn ghost"
                onClick={handleProve}
                disabled={!recipient || proof.status === "verifying"}
              >
                {proof.status === "verifying"
                  ? "Waiting for signature…"
                  : "Connect receiver & sign"}
              </button>
              {proof.status === "failed" && (
                <p className="error">{proof.message}</p>
              )}
            </div>

            <div className="nav">
              <button className="btn ghost" onClick={() => setStep(0)}>
                ← Back
              </button>
              <button
                className="btn primary"
                disabled={
                  !recipient ||
                  (sender ? addressesEqual(recipient, sender.address) : true)
                }
                onClick={() => {
                  setStep(2);
                  if (allAssets.length === 0) handleScan();
                }}
              >
                Continue →
              </button>
            </div>
          </Section>
        )}

        {step === 2 && (
          <Section
            title="3 · Choose what to migrate"
            sub="Detected ERC-20 balances and NFTs. Untick anything you want to leave behind, and edit amounts if needed."
          >
            <div className="nav-inline">
              <button className="btn ghost" onClick={handleScan} disabled={scanning}>
                {scanning ? "Scanning…" : "↻ Rescan"}
              </button>
              <span className="muted">
                {erc20s.length} token(s), {nfts.length} NFT(s) found
              </span>
            </div>

            {tokenNotice && <p className="notice">{tokenNotice}</p>}

            {erc20s.length > 0 && (
              <>
                <h3>Tokens</h3>
                <div className="asset-list">
                  {erc20s.map((a) => (
                    <div className="asset-row" key={a.id}>
                      <input
                        type="checkbox"
                        checked={!!selected[a.id]}
                        onChange={() => toggle(a.id)}
                      />
                      <div className="asset-main">
                        <strong>{a.symbol}</strong>{" "}
                        <span className="muted">{a.name}</span>
                        {a.isGasToken && <span className="tag">gas token</span>}
                        <div className="muted small">
                          Balance: {formatUnits(a.balance, a.decimals)}
                        </div>
                      </div>
                      <div className="asset-amt">
                        <input
                          value={amounts[a.id] ?? ""}
                          onChange={(e) => setAmt(a.id, e.target.value)}
                          disabled={!selected[a.id]}
                        />
                        <button
                          className="link"
                          onClick={() =>
                            setAmt(a.id, formatUnits(a.balance, a.decimals))
                          }
                        >
                          max
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
                <p className="muted small">
                  For ETH and STRK the default keeps a small buffer so you can
                  still pay the transaction fee.
                </p>
              </>
            )}

            {nfts.length > 0 && (
              <>
                <h3>NFTs</h3>
                <div className="asset-list">
                  {nfts.map((a) => (
                    <div className="asset-row" key={a.id}>
                      <input
                        type="checkbox"
                        checked={!!selected[a.id]}
                        onChange={() => toggle(a.id)}
                      />
                      {a.imageUrl ? (
                        <img className="nft-thumb" src={a.imageUrl} alt="" />
                      ) : (
                        <div className="nft-thumb placeholder">NFT</div>
                      )}
                      <div className="asset-main">
                        <strong>{a.collectionName ?? a.name ?? "NFT"}</strong>
                        <div className="muted small">
                          #{a.tokenId.toString()} ·{" "}
                          {a.kind === "erc1155" ? `x${a.balance}` : "ERC-721"} ·{" "}
                          <a
                            href={EXPLORER_CONTRACT(a.address)}
                            target="_blank"
                            rel="noreferrer"
                          >
                            {shortenAddress(a.address)}
                          </a>
                        </div>
                      </div>
                      {a.kind === "erc1155" && (
                        <div className="asset-amt">
                          <input
                            value={amounts[a.id] ?? ""}
                            onChange={(e) => setAmt(a.id, e.target.value)}
                            disabled={!selected[a.id]}
                          />
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </>
            )}

            {nftNotice && <p className="notice">{nftNotice}</p>}

            <details className="manual">
              <summary>Add an asset manually</summary>
              <div className="manual-grid">
                <div className="field">
                  <span>ERC-20 token address</span>
                  <div className="inline">
                    <input
                      value={manualToken}
                      onChange={(e) => setManualToken(e.target.value)}
                      placeholder="0x…"
                      spellCheck={false}
                    />
                    <button
                      className="btn ghost"
                      onClick={handleAddToken}
                      disabled={manualBusy}
                    >
                      Add token
                    </button>
                  </div>
                </div>
                <div className="field">
                  <span>NFT contract + token ID</span>
                  <div className="inline">
                    <input
                      value={manualNftAddr}
                      onChange={(e) => setManualNftAddr(e.target.value)}
                      placeholder="0x… contract"
                      spellCheck={false}
                    />
                    <input
                      className="short"
                      value={manualNftId}
                      onChange={(e) => setManualNftId(e.target.value)}
                      placeholder="token id"
                      spellCheck={false}
                    />
                    <button
                      className="btn ghost"
                      onClick={handleAddNft}
                      disabled={manualBusy}
                    >
                      Add NFT
                    </button>
                  </div>
                </div>
              </div>
              {manualError && <p className="error">{manualError}</p>}
            </details>

            {!scanning && erc20s.length === 0 && nfts.length === 0 && (
              <p className="muted">
                Nothing detected yet. Set a Starkscan API key in Settings to
                auto-detect all tokens (without one, only a built-in token list
                is checked). NFTs aren’t auto-detected via Starkscan — add them
                with “Add an asset manually”.
              </p>
            )}

            <div className="nav">
              <button className="btn ghost" onClick={() => setStep(1)}>
                ← Back
              </button>
              <button
                className="btn primary"
                disabled={selectedItems.length === 0}
                onClick={() => {
                  setMStatus("idle");
                  setFeeText(undefined);
                  setStep(3);
                }}
              >
                Review {selectedItems.length} transfer(s) →
              </button>
            </div>
          </Section>
        )}

        {step === 3 && sender && recipient && (
          <Section
            title="4 · Review & migrate"
            sub="Everything below is bundled into one signed transaction (or a few, if there are many transfers)."
          >
            <div className="review-meta">
              <div>
                <span className="muted">From</span>
                <code>{shortenAddress(sender.address, 10, 8)}</code>
              </div>
              <div className="arrow">→</div>
              <div>
                <span className="muted">
                  To{" "}
                  {proof.status === "verified" ? (
                    <span className="tag ok">ownership verified</span>
                  ) : (
                    <span className="tag warn">unverified</span>
                  )}
                </span>
                <code>{shortenAddress(recipient, 10, 8)}</code>
              </div>
            </div>

            <table className="summary">
              <thead>
                <tr>
                  <th>Asset</th>
                  <th>Amount</th>
                </tr>
              </thead>
              <tbody>
                {selectedItems.map((it) => (
                  <tr key={it.asset.id}>
                    <td>
                      {it.asset.kind === "erc20"
                        ? it.asset.symbol
                        : `${it.asset.collectionName ?? "NFT"} #${it.asset.tokenId}`}
                    </td>
                    <td>
                      {it.asset.kind === "erc20"
                        ? formatUnits(it.amount, it.asset.decimals)
                        : it.amount.toString()}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>

            <p className="muted small">
              {selectedItems.length} transfer(s) ·{" "}
              {chunk(selectedItems, MAX_CALLS_PER_TX).length} transaction(s)
            </p>

            <div className="nav-inline">
              <button
                className="btn ghost"
                onClick={handleEstimate}
                disabled={mStatus === "estimating" || mStatus === "executing"}
              >
                {mStatus === "estimating" ? "Estimating…" : "Estimate fee"}
              </button>
              {feeText && <span className="muted">Estimated fee: ~{feeText}</span>}
            </div>

            {mError && <p className="error">{mError}</p>}

            <div className="banner warn small">
              ⚠ Transfers are irreversible. Confirm the recipient address is
              correct. If you proved ownership above, the address is verified.
            </div>

            <div className="nav">
              <button
                className="btn ghost"
                onClick={() => setStep(2)}
                disabled={mStatus === "executing"}
              >
                ← Back
              </button>
              <button
                className="btn primary big"
                onClick={handleMigrate}
                disabled={
                  mStatus === "executing" ||
                  mStatus === "done" ||
                  selectedItems.length === 0 ||
                  !chainOk
                }
              >
                {mStatus === "executing"
                  ? "Confirm in your wallet…"
                  : `Migrate ${selectedItems.length} asset(s)`}
              </button>
            </div>

            {txs.length > 0 && (
              <div className="tx-list">
                {txs.map((t) => (
                  <div className={`tx-row ${t.status}`} key={t.hash}>
                    <span className="dot" />
                    <a href={EXPLORER_TX(t.hash)} target="_blank" rel="noreferrer">
                      {shortenAddress(t.hash, 10, 8)}
                    </a>
                    <span className="muted">
                      {t.note ? `${t.note} · ` : ""}
                      {t.status}
                    </span>
                  </div>
                ))}
              </div>
            )}

            {mStatus === "done" && (
              <div className="banner ok">
                ✓ Migration submitted. Verify balances in the receiving wallet and
                on the explorer.
              </div>
            )}
          </Section>
        )}
      </main>

      <footer className="foot">
        <span>
          Open-source migration tool · your wallet signs every action · keys
          never leave your browser.
        </span>
      </footer>

      {showSettings && <Settings onClose={() => setShowSettings(false)} />}
    </div>
  );
}

function Section({
  title,
  sub,
  children,
}: {
  title: string;
  sub?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="card">
      <h2>{title}</h2>
      {sub && <p className="sub">{sub}</p>}
      {children}
    </section>
  );
}
