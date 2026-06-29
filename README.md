# Starknet Wallet Migrator

A static web app to migrate **ERC-20 tokens** and **NFTs** from one Starknet
wallet to another, bundled into a single signed transaction (Starknet
multicall). Mainnet only.

> ⚠️ **Use carefully.** Transfers are irreversible. Always double-check the
> recipient address. This is a self-service tool — review everything before you
> sign. Nothing here is financial or security advice; verify on a small amount
> first.

## What it does

1. **Connect the sending wallet** via [starknetkit](https://github.com/argentlabs/starknetkit)
   (ArgentX / Ready, Braavos, web wallet, …). Your keys never leave your wallet —
   the app only ever asks your wallet to sign.
2. **Set the receiving wallet** by pasting its address, with an **optional
   ownership proof**: connect the receiver and sign a gas-free SNIP-12 message
   that is verified on-chain (`is_valid_signature`). Skip it for cold/hardware
   wallets you can't connect in the browser.
3. **Pick assets to migrate**:
   - **ERC-20** — with a Starkscan API key (entered at runtime, stored only in
     your browser), all fungible holdings are auto-detected via Starkscan's
     Agent API (`GET /v1/SN_MAIN/address/{address}/token-holdings`). Without a
     key, the app falls back to checking a built-in token list
     (`src/lib/tokens.ts`) over public RPC — no key needed.
   - **NFTs** — Starkscan's Agent API has **no NFT-by-owner endpoint**, so NFTs
     are **added manually** (contract + token ID, verified on-chain via
     `ownerOf`). An optional "custom NFT holdings URL" in Settings lets you wire
     a different provider if you have one.
   - **Add manually** anything not detected.
4. **Review & migrate** — all selected transfers are batched into one multicall
   (chunked into several transactions if there are many), with a fee estimate.
   For ETH/STRK the default keeps a small gas buffer so you can still pay fees.

What it does **not** do: unwind DeFi/staking/LP positions or vesting. Those
aren't simple transfers and must be handled in their own protocols first.

## Security model

- **No private keys, seed phrases, or signing material are ever handled by this
  app.** All signing happens inside your wallet extension.
- The receiving-wallet "proof" is a standard `signMessage` flow; the signature is
  verified against the account on-chain.
- The indexer API key is stored in `localStorage` and sent only to the indexer
  you configure. It is never committed to the repo or bundled into the build.

## Run locally

```bash
npm install
npm run dev      # http://localhost:5173
npm run build    # outputs static site to dist/
npm run preview  # serve the production build
```

## Configuration (in-app Settings ⚙)

- **RPC URL** — defaults to a public, CORS-open mainnet endpoint. Override with
  your own provider if you hit rate limits.
- **Starkscan Agent API** — base URL (default `https://api.starkscan.co`), chain
  (`SN_MAIN`), API key, and key header name (default `X-Starkscan-Api-Key`).
  Used for ERC-20 `token-holdings` auto-detection.
- **Custom NFT holdings URL** (optional) — Starkscan has no NFT-by-owner
  endpoint; supply another provider's URL with `{address}` as a placeholder if
  you have one.

> Note: Starknet has no on-chain "list my assets" call, so full token detection
> uses an indexer (Starkscan) + key. NFT enumeration isn't offered by Starkscan
> today, so NFTs are added manually (verified on-chain). ERC-20 detection still
> works without a key via the built-in list.

## Deploy to GitHub Pages

This repo includes `.github/workflows/deploy.yml`, which builds and deploys on
every push to `main`.

1. Push this project to a GitHub repository.
2. In the repo, go to **Settings → Pages → Build and deployment → Source:
   GitHub Actions**.
3. Push to `main` (or run the workflow manually). The site deploys to
   `https://<user>.github.io/<repo>/`.

The Vite build uses `base: "./"` (relative asset paths), so it works at any
sub-path without extra configuration.

## Tech

React + Vite + TypeScript · [starknet.js](https://github.com/starknet-io/starknet.js)
`8.9.2` · starknetkit `3.4.3`.

## Adding tokens

Edit `src/lib/tokens.ts` — each entry is `{ address, symbol, name, decimals }`
(set `isGasToken: true` for fee tokens). The bundled list was verified on-chain;
balances for any listed token are read at scan time.
