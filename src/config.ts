import { constants } from "starknet";

/** App-level configuration. Mainnet only (per project scope). */

export const DAPP_NAME = "Starknet Wallet Migrator";

export const CHAIN_ID = constants.StarknetChainId.SN_MAIN;
export const CHAIN_LABEL = "Starknet Mainnet";

/**
 * Default public RPC endpoint (CORS-open, no key). Users can override it in
 * Settings. starknet.js 8.x speaks JSON-RPC 0.8, hence the `/v0_8` suffix.
 */
export const DEFAULT_RPC_URL = "https://api.cartridge.gg/x/starknet/mainnet";

export const RPC_ALTERNATIVES = [
  "https://api.cartridge.gg/x/starknet/mainnet",
  "https://free-rpc.nethermind.io/mainnet-juno/v0_8",
  "https://starknet-mainnet.public.blastapi.io/rpc/v0_8",
];

/**
 * Starkscan Agent API (https://starkscan.co/docs/ai). Base host + chain segment;
 * the ERC-20 `token-holdings` endpoint auto-detects ALL fungible holdings.
 * Everything here is overridable in Settings (point at a proxy, preview host…).
 *
 * NOTE: As of 2026-06, Starkscan's Agent API has NO NFT-by-owner endpoint, so
 * NFT auto-discovery is unavailable through it. NFTs are added manually
 * (verified on-chain via `ownerOf`). An advanced "custom NFT holdings URL"
 * setting lets you wire a different provider if you have one.
 */
export const DEFAULT_INDEXER_BASE = "https://api.starkscan.co";
export const DEFAULT_INDEXER_CHAIN = "SN_MAIN";
export const DEFAULT_INDEXER_KEY_HEADER = "X-Starkscan-Api-Key";

/** Block explorer for linking out to transactions. */
export const EXPLORER_TX = (hash: string) => `https://starkscan.co/tx/${hash}`;
export const EXPLORER_CONTRACT = (addr: string) =>
  `https://starkscan.co/contract/${addr}`;

/** Max calls per multicall transaction. Large migrations are chunked. */
export const MAX_CALLS_PER_TX = 40;

/** localStorage keys (v2 — bumped after the Starkscan Agent API migration). */
export const LS = {
  indexerBase: "swm.indexer.base.v2",
  indexerChain: "swm.indexer.chain.v2",
  indexerKey: "swm.indexer.key.v2",
  indexerKeyHeader: "swm.indexer.keyHeader.v2",
  nftUrlTemplate: "swm.indexer.nftUrl.v2",
  rpcUrl: "swm.rpc.url",
} as const;
