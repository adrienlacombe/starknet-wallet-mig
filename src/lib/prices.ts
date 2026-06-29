import { CallData, type RpcProvider } from "starknet";
import { chunk } from "./migrate";

/**
 * On-chain USD prices via Ekubo's Oracle (PriceFetcher contract). Quotes every
 * token against USDC (treated as $1) using a TWAP, in a single batched call.
 *
 * PriceFetcher.get_prices(quote, base_tokens: Span, period: u64, min_token: u128)
 *   -> Span<PriceResult>, where PriceResult is an enum:
 *      0 NotInitialized | 1 InsufficientLiquidity | 2 PeriodTooLong | 3 Price(u256)
 * The u256 is a 128.128 fixed-point price = quote-raw per base-raw. So:
 *   usd_per_whole_token = (x128 / 2^128) * 10^(baseDecimals - USDC_DECIMALS)
 * Verified on mainnet: USDC->USDC returns exactly 2^128 (= $1.0000).
 */
const PRICE_FETCHER =
  "0x04946fb4ad5237d97bbb1256eba2080c4fe1de156da6a7f83e3b4823bb6d7da1";
const USDC =
  "0x053c91253bc9682c04929ca02ed00b3e423f6710d2ee7e0d5ebb06f3ecf368a8";
const USDC_DECIMALS = 6;
const TWAP_PERIOD = 300n; // seconds
const MIN_TOKEN = 0n; // accept any liquidity (display-only)
const TWO_128 = 2 ** 128;

export interface PricedToken {
  address: string;
  decimals: number;
}

function numKey(addr: string): string {
  try {
    return BigInt(addr).toString();
  } catch {
    return addr.toLowerCase();
  }
}

/**
 * Returns a map of `numericAddressKey -> USD price per whole token`. Tokens with
 * no oracle pool (or insufficient history) are simply omitted. Best-effort:
 * pricing failures never throw.
 */
export async function fetchUsdPrices(
  provider: RpcProvider,
  tokens: PricedToken[],
): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  if (tokens.length === 0) return out;

  for (const group of chunk(tokens, 40)) {
    try {
      const calldata = CallData.compile([
        USDC,
        group.map((t) => t.address),
        TWAP_PERIOD,
        MIN_TOKEN,
      ]);
      const res = await provider.callContract({
        contractAddress: PRICE_FETCHER,
        entrypoint: "get_prices",
        calldata,
      });
      decodeInto(res, group, out);
    } catch {
      /* pricing is best-effort */
    }
  }
  return out;
}

function decodeInto(
  res: string[],
  group: PricedToken[],
  out: Map<string, number>,
) {
  let i = 0;
  const n = Number(BigInt(res[i++] ?? "0"));
  for (let k = 0; k < n && k < group.length; k++) {
    const tag = Number(BigInt(res[i++] ?? "0"));
    if (tag === 3) {
      const low = BigInt(res[i++] ?? "0");
      const high = BigInt(res[i++] ?? "0");
      const x128 = low + (high << 128n);
      const t = group[k];
      const usd = (Number(x128) / TWO_128) * 10 ** (t.decimals - USDC_DECIMALS);
      if (Number.isFinite(usd) && usd > 0) out.set(numKey(t.address), usd);
    }
    // variants 0/1/2 carry no extra felts — nothing to skip.
  }
}

export function priceKey(addr: string): string {
  return numKey(addr);
}
