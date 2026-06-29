import { RpcProvider, cairo } from "starknet";
import { MAINNET_TOKENS } from "./tokens";
import type { Erc20Asset, NftAsset } from "./types";
import { decodeCairoString } from "./decode";
import { addressesEqual, normalizeAddress, u256FromFelts } from "./format";
import { getIndexerConfig } from "./indexerConfig";

/** Addresses that can pay fees (ETH, STRK), keyed by numeric value. */
const GAS_TOKEN_VALUES = new Set(
  MAINNET_TOKENS.filter((t) => t.isGasToken).map((t) => BigInt(t.address)),
);
function isGasTokenAddress(addr: string): boolean {
  try {
    return GAS_TOKEN_VALUES.has(BigInt(addr));
  } catch {
    return false;
  }
}

/** Whether a contract (account) is deployed on-chain at `address`. */
export async function isDeployed(
  provider: RpcProvider,
  address: string,
): Promise<boolean> {
  try {
    const h = await provider.getClassHashAt(address);
    return !!h && BigInt(h) !== 0n;
  } catch {
    return false;
  }
}

/** Run async `fn` over `items` with a bounded concurrency. */
async function mapLimit<T, R>(
  items: T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const ret: R[] = new Array(items.length);
  let idx = 0;
  async function worker() {
    while (idx < items.length) {
      const i = idx++;
      ret[i] = await fn(items[i], i);
    }
  }
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length || 1) }, worker),
  );
  return ret;
}

async function readBalance(
  provider: RpcProvider,
  token: string,
  owner: string,
): Promise<bigint> {
  let res: string[];
  try {
    res = await provider.callContract({
      contractAddress: token,
      entrypoint: "balanceOf",
      calldata: [owner],
    });
  } catch {
    res = await provider.callContract({
      contractAddress: token,
      entrypoint: "balance_of",
      calldata: [owner],
    });
  }
  return u256FromFelts(res[0] ?? "0", res[1] ?? "0");
}

export interface Erc20ScanResult {
  assets: Erc20Asset[];
  notice?: string;
}

/** A token to check: address plus whatever metadata we already know. */
interface Candidate {
  address: string;
  symbol?: string | null;
  name?: string | null;
  decimals?: number | null;
  isGasToken?: boolean;
}

function numKey(addr: string): string {
  try {
    return BigInt(addr).toString();
  } catch {
    return addr.toLowerCase();
  }
}

/** Read `symbol`/`decimals` on-chain for tokens whose metadata is unknown. */
async function enrichMeta(
  provider: RpcProvider,
  addr: string,
): Promise<{ symbol?: string; decimals?: number }> {
  const [symRes, decRes] = await Promise.all([
    provider
      .callContract({ contractAddress: addr, entrypoint: "symbol", calldata: [] })
      .catch(() => [] as string[]),
    provider
      .callContract({ contractAddress: addr, entrypoint: "decimals", calldata: [] })
      .catch(() => [] as string[]),
  ]);
  return {
    symbol: decodeCairoString(symRes) || undefined,
    decimals: decRes.length ? Number(BigInt(decRes[0])) : undefined,
  };
}

/**
 * For each candidate, read the LIVE on-chain balance (never trust an indexer
 * snapshot for amounts) and fill in any missing symbol/decimals. Keeps only
 * tokens with a positive balance.
 */
async function scanBalances(
  provider: RpcProvider,
  owner: string,
  candidates: Candidate[],
): Promise<Erc20Asset[]> {
  const results = await mapLimit(candidates, 8, async (c) => {
    try {
      const balance = await readBalance(provider, c.address, owner);
      if (balance <= 0n) return null;
      let symbol = c.symbol ?? undefined;
      let decimals = c.decimals ?? undefined;
      const name = c.name ?? undefined;
      if (symbol == null || decimals == null) {
        const meta = await enrichMeta(provider, c.address);
        symbol = symbol ?? meta.symbol;
        decimals = decimals ?? meta.decimals;
      }
      const addr = normalizeAddress(c.address) ?? c.address;
      const asset: Erc20Asset = {
        kind: "erc20",
        id: addr,
        address: addr,
        symbol: symbol || "TOKEN",
        name: name || symbol || "Token",
        decimals: decimals ?? 18,
        balance,
        isGasToken: c.isGasToken ?? isGasTokenAddress(addr),
        source: "list",
      };
      return asset;
    } catch {
      return null;
    }
  });
  return results.filter((r): r is Erc20Asset => r !== null);
}

/**
 * Discover ERC-20 holdings. With the Worker proxy configured, it lists every
 * token the address holds (via Starkscan) and re-reads live balances on-chain.
 * Without a proxy, it checks the built-in token list over RPC (keyless).
 */
export async function scanErc20(
  provider: RpcProvider,
  owner: string,
): Promise<Erc20ScanResult> {
  const cfg = getIndexerConfig();
  if (cfg.proxyUrl) {
    try {
      const assets = await scanErc20ViaProxy(provider, owner, cfg.proxyUrl);
      return { assets };
    } catch (e: any) {
      const fallback = await scanErc20ViaRpc(provider, owner);
      return {
        assets: fallback,
        notice: `Token-discovery proxy failed (${e?.message ?? "error"}). Showed the built-in token list instead — add anything missing manually.`,
      };
    }
  }
  const assets = await scanErc20ViaRpc(provider, owner);
  return {
    assets,
    notice:
      "No token-discovery proxy configured — checked the built-in token list only. Deploy the Cloudflare worker and set its URL in Settings to auto-detect every token, or add tokens manually.",
  };
}

/** Curated-list + RPC balance scan (keyless fallback). */
async function scanErc20ViaRpc(
  provider: RpcProvider,
  owner: string,
): Promise<Erc20Asset[]> {
  return scanBalances(
    provider,
    owner,
    MAINNET_TOKENS.map((t) => ({ ...t })),
  );
}

/**
 * Token discovery via the Worker proxy. The proxy returns Starkscan's
 * `token-holdings` items; we use them as the candidate set, merge in curated
 * metadata, then read live balances.
 */
async function scanErc20ViaProxy(
  provider: RpcProvider,
  owner: string,
  proxyUrl: string,
): Promise<Erc20Asset[]> {
  const base = proxyUrl.replace(/\/+$/, "");
  const r = await fetch(`${base}/token-holdings?address=${owner}`, {
    headers: { accept: "application/json" },
  });
  if (!r.ok) {
    const body = await r.text().catch(() => "");
    throw new Error(`HTTP ${r.status} ${body.slice(0, 140)}`);
  }
  const j: any = await r.json();
  const items: any[] = j.items ?? j.holdings ?? j.data ?? [];
  const curated = new Map(
    MAINNET_TOKENS.map((t) => [numKey(t.address), t] as const),
  );
  const seen = new Set<string>();
  const candidates: Candidate[] = [];
  for (const it of items) {
    const raw =
      it.normalizedTokenAddress ?? it.tokenAddress ?? it.token ?? it.address;
    if (!raw) continue;
    const addr = normalizeAddress(raw) ?? raw;
    const key = numKey(addr);
    if (seen.has(key)) continue;
    seen.add(key);
    const cur = curated.get(key);
    candidates.push({
      address: addr,
      symbol: it.symbol ?? cur?.symbol ?? null,
      name: it.name ?? cur?.name ?? null,
      decimals: it.decimals ?? cur?.decimals ?? null,
      isGasToken: cur?.isGasToken ?? isGasTokenAddress(addr),
    });
  }
  return scanBalances(provider, owner, candidates);
}

/** Manual ERC-20 lookup by contract address. Reads symbol/decimals/balance on-chain. */
export async function lookupErc20(
  provider: RpcProvider,
  address: string,
  owner: string,
): Promise<Erc20Asset> {
  const addr = normalizeAddress(address);
  if (!addr) throw new Error("Invalid contract address.");
  const [symRes, decRes] = await Promise.all([
    provider
      .callContract({ contractAddress: addr, entrypoint: "symbol", calldata: [] })
      .catch(() => [] as string[]),
    provider
      .callContract({ contractAddress: addr, entrypoint: "decimals", calldata: [] })
      .catch(() => [] as string[]),
  ]);
  const balance = await readBalance(provider, addr, owner);
  const symbol = decodeCairoString(symRes) || "TOKEN";
  const decimals = decRes.length ? Number(BigInt(decRes[0])) : 18;
  return {
    kind: "erc20",
    id: addr,
    address: addr,
    symbol,
    name: symbol,
    decimals,
    balance,
    source: "manual",
  };
}

async function ownerOf(
  provider: RpcProvider,
  contract: string,
  tokenId: bigint,
): Promise<string | null> {
  const u = cairo.uint256(tokenId);
  const calldata = [u.low.toString(), u.high.toString()];
  for (const entrypoint of ["ownerOf", "owner_of"]) {
    try {
      const res = await provider.callContract({
        contractAddress: contract,
        entrypoint,
        calldata,
      });
      if (res[0]) return res[0];
    } catch {
      /* try next */
    }
  }
  return null;
}

/** Manual NFT add. Verifies ownership via `ownerOf` before returning. */
export async function lookupNft(
  provider: RpcProvider,
  contract: string,
  tokenIdInput: string,
  owner: string,
): Promise<NftAsset> {
  const addr = normalizeAddress(contract);
  if (!addr) throw new Error("Invalid NFT contract address.");
  let tokenId: bigint;
  try {
    tokenId = BigInt(tokenIdInput.trim());
  } catch {
    throw new Error("Invalid token ID.");
  }
  const holder = await ownerOf(provider, addr, tokenId);
  if (!holder) {
    throw new Error(
      "Could not read ownerOf for this token — it may not be a standard ERC-721, or the ID is wrong.",
    );
  }
  if (!addressesEqual(holder, owner)) {
    throw new Error("The connected wallet does not own this token.");
  }
  let collectionName: string | undefined;
  try {
    const r = await provider.callContract({
      contractAddress: addr,
      entrypoint: "name",
      calldata: [],
    });
    collectionName = decodeCairoString(r) || undefined;
  } catch {
    /* optional */
  }
  return {
    kind: "erc721",
    id: `${addr}:${tokenId.toString()}`,
    address: addr,
    tokenId,
    balance: 1n,
    collectionName,
    source: "manual",
  };
}

export interface NftScanResult {
  assets: NftAsset[];
  error?: string;
}

/**
 * NFT auto-discovery. Starkscan's Agent API has no NFT-by-owner endpoint, so
 * this only runs when a custom `nftUrlTemplate` (with `{address}`) is set in
 * Settings; otherwise it returns a notice and you add NFTs manually.
 */
export async function scanNfts(owner: string): Promise<NftScanResult> {
  const cfg = getIndexerConfig();
  if (!cfg.nftUrlTemplate) {
    return {
      assets: [],
      error:
        "Starkscan's API doesn't list NFTs by owner, so NFTs aren't auto-detected. Add them manually below (each is verified on-chain), or set a custom NFT holdings URL in Settings.",
    };
  }
  const url = cfg.nftUrlTemplate.replaceAll("{address}", owner);
  const headers: Record<string, string> = { accept: "application/json" };
  const out: NftAsset[] = [];
  try {
    const r = await fetch(url, { headers });
    if (!r.ok) {
      const body = await r.text().catch(() => "");
      return {
        assets: out,
        error: `NFT indexer responded ${r.status}. ${body.slice(0, 160)}`,
      };
    }
    const j: any = await r.json();
    const items: any[] =
      j.data ?? j.items ?? j.results ?? j.holdings ?? j.nfts ?? [];
    for (const it of items) {
      const contract: string | undefined =
        it.contract_address ?? it.contractAddress ?? it.contract?.address;
      const rawTokenId = it.token_id ?? it.tokenId ?? it.id;
      if (!contract || rawTokenId == null) continue;
      let tokenId: bigint;
      try {
        tokenId = BigInt(rawTokenId);
      } catch {
        continue;
      }
      let bal = 1n;
      try {
        if (it.balance != null) bal = BigInt(it.balance);
      } catch {
        bal = 1n;
      }
      if (bal <= 0n) continue;
      const typeStr = String(
        it.contract?.type ?? it.token_standard ?? it.type ?? "",
      ).toLowerCase();
      const kind: "erc721" | "erc1155" = typeStr.includes("1155")
        ? "erc1155"
        : "erc721";
      const addr = normalizeAddress(contract) ?? contract;
      out.push({
        kind,
        id: `${addr}:${tokenId.toString()}`,
        address: addr,
        tokenId,
        balance: bal,
        name: it.name ?? it.nft_metadata?.name ?? it.metadata?.name,
        collectionName:
          it.contract?.name ?? it.collection_name ?? it.collection?.name,
        imageUrl:
          it.image_url ??
          it.image_medium_url ??
          it.nft_metadata?.image ??
          it.metadata?.image,
        source: "indexer",
      });
    }
    return { assets: out };
  } catch (e: any) {
    return {
      assets: out,
      error: `NFT indexer request failed (network or CORS). ${e?.message ?? ""} — add NFTs manually.`,
    };
  }
}
