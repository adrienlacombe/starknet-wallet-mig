import {
  DEFAULT_INDEXER_BASE,
  DEFAULT_INDEXER_CHAIN,
  DEFAULT_INDEXER_KEY_HEADER,
  LS,
} from "../config";

export interface IndexerConfig {
  base: string;
  chain: string;
  key: string;
  keyHeader: string;
  /**
   * Optional custom URL template for NFT-by-owner discovery (Starkscan has no
   * such endpoint). Use `{address}` as a placeholder. Blank → NFT auto-detect
   * disabled, manual add only.
   */
  nftUrlTemplate: string;
}

export function getIndexerConfig(): IndexerConfig {
  return {
    base: localStorage.getItem(LS.indexerBase) || DEFAULT_INDEXER_BASE,
    chain: localStorage.getItem(LS.indexerChain) || DEFAULT_INDEXER_CHAIN,
    key: localStorage.getItem(LS.indexerKey) || "",
    keyHeader:
      localStorage.getItem(LS.indexerKeyHeader) || DEFAULT_INDEXER_KEY_HEADER,
    nftUrlTemplate: localStorage.getItem(LS.nftUrlTemplate) || "",
  };
}

export function setIndexerConfig(cfg: Partial<IndexerConfig>) {
  if (cfg.base !== undefined) localStorage.setItem(LS.indexerBase, cfg.base.trim());
  if (cfg.chain !== undefined)
    localStorage.setItem(LS.indexerChain, cfg.chain.trim());
  if (cfg.key !== undefined) localStorage.setItem(LS.indexerKey, cfg.key.trim());
  if (cfg.keyHeader !== undefined)
    localStorage.setItem(LS.indexerKeyHeader, cfg.keyHeader.trim());
  if (cfg.nftUrlTemplate !== undefined)
    localStorage.setItem(LS.nftUrlTemplate, cfg.nftUrlTemplate.trim());
}

export function hasIndexerKey(): boolean {
  return getIndexerConfig().key.length > 0;
}
