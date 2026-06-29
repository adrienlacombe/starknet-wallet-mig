export interface Erc20Asset {
  kind: "erc20";
  id: string; // normalized address
  address: string;
  symbol: string;
  name: string;
  decimals: number;
  balance: bigint; // raw integer balance
  isGasToken?: boolean;
  source: "list" | "manual";
}

export interface NftAsset {
  kind: "erc721" | "erc1155";
  id: string; // `${address}:${tokenId}`
  address: string;
  tokenId: bigint;
  balance: bigint; // 1 for ERC-721, n for ERC-1155
  name?: string;
  collectionName?: string;
  imageUrl?: string;
  source: "indexer" | "manual";
}

export type Asset = Erc20Asset | NftAsset;
