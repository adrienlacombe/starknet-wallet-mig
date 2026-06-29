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

/**
 * Discover ERC-20 holdings. With a Starkscan key set, uses the `token-holdings`
 * endpoint (detects ALL fungible tokens). Without a key, falls back to checking
 * the built-in token list over RPC.
 */
export async function scanErc20(
  provider: RpcProvider,
  owner: string,
): Promise<Erc20ScanResult> {
  const cfg = getIndexerConfig();
  if (cfg.key) {
    try {
      return await scanErc20ViaIndexer(owner);
    } catch (e: any) {
      const fallback = await scanErc20ViaRpc(provider, owner);
      return {
        assets: fallback,
        notice: `Starkscan token-holdings failed (${e?.message ?? "error"}). Showed built-in token list instead — add anything missing manually.`,
      };
    }
  }
  const assets = await scanErc20ViaRpc(provider, owner);
  return {
    assets,
    notice:
      "No Starkscan API key set — checked the built-in token list only. Add a key in Settings to auto-detect every token, or add tokens manually.",
  };
}

/** Curated-list + RPC balance scan (keyless). */
async function scanErc20ViaRpc(
  provider: RpcProvider,
  owner: string,
): Promise<Erc20Asset[]> {
  const results = await mapLimit(MAINNET_TOKENS, 8, async (t) => {
    try {
      const balance = await readBalance(provider, t.address, owner);
      if (balance > 0n) {
        const addr = normalizeAddress(t.address) ?? t.address;
        const asset: Erc20Asset = {
          kind: "erc20",
          id: addr,
          address: addr,
          symbol: t.symbol,
          name: t.name,
          decimals: t.decimals,
          balance,
          isGasToken: t.isGasToken,
          source: "list",
        };
        return asset;
      }
    } catch {
      /* token not deployed / non-standard — skip */
    }
    return null;
  });
  return results.filter((r): r is Erc20Asset => r !== null);
}

/** Starkscan Agent API `/v1/{chain}/address/{address}/token-holdings`. */
async function scanErc20ViaIndexer(owner: string): Promise<Erc20ScanResult> {
  const cfg = getIndexerConfig();
  const headers: Record<string, string> = {
    accept: "application/json",
    [cfg.keyHeader]: cfg.key,
  };
  const base = cfg.base.replace(/\/+$/, "");
  const out: Erc20Asset[] = [];
  let cursor: string | null = null;
  let guard = 0;
  let incomplete = false;
  do {
    guard++;
    const url =
      `${base}/v1/${cfg.chain}/address/${owner}/token-holdings` +
      (cursor ? `?cursor=${encodeURIComponent(cursor)}` : "");
    const r: Response = await fetch(url, { headers });
    if (!r.ok) {
      const body = await r.text().catch(() => "");
      throw new Error(`HTTP ${r.status} ${body.slice(0, 140)}`);
    }
    const j: any = await r.json();
    const holdings: any[] = j.holdings ?? j.data ?? [];
    for (const h of holdings) {
      const rawAddr = h.normalizedTokenAddress ?? h.tokenAddress ?? h.token;
      if (!rawAddr) continue;
      let balance: bigint;
      try {
        balance = BigInt(h.balance ?? "0");
      } catch {
        continue;
      }
      if (balance <= 0n) continue;
      const addr = normalizeAddress(rawAddr) ?? rawAddr;
      const decimals = Number(h.decimals ?? 18);
      out.push({
        kind: "erc20",
        id: addr,
        address: addr,
        symbol: h.symbol || "TOKEN",
        name: h.name || h.symbol || "Token",
        decimals: Number.isFinite(decimals) ? decimals : 18,
        balance,
        isGasToken: isGasTokenAddress(addr),
        source: "list",
      });
    }
    cursor = j.nextCursor ?? j.next_cursor ?? null;
    if (j.truncated === true || j.completeness?.reasonCode === "truncated") {
      incomplete = true;
    }
  } while (cursor && guard < 30);

  return {
    assets: out,
    notice: incomplete
      ? "Starkscan reported the holdings list may be incomplete — double-check, and add anything missing manually."
      : undefined,
  };
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
  if (cfg.key) headers[cfg.keyHeader] = cfg.key;
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
