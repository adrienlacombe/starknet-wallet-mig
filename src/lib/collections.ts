/**
 * Curated list of Starknet **mainnet** NFT (ERC-721) collections, for plain-RPC
 * discovery. Starknet has no "list my NFTs" call, and full event-log scans are
 * impractical (~50 min) — so the app checks `balanceOf(owner)` on each listed
 * collection (cheap, parallel). For collections that implement ERC-721
 * Enumerable, it then reads the exact token IDs via `tokenOfOwnerByIndex`. For
 * the (common) non-enumerable collections, it reports the holding and prompts
 * you to add the token IDs manually.
 *
 * Add collections freely — only the address matters; `name` is for display.
 * Each entry below was verified to respond on-chain.
 */
export interface NftCollectionInfo {
  address: string;
  name: string;
}

export const MAINNET_NFT_COLLECTIONS: NftCollectionInfo[] = [
  {
    address: "0x05dbdedc203e92749e2e746e2d40a768d966bd243df04a6b712e222bc040a9af",
    name: "Starknet.id",
  },
  {
    address: "0x076503062d78f4481be03c9145022d6a4a71ec0719aa07756f79a2384dc7ef16",
    name: "Starknet Quest",
  },
  {
    address: "0x031075ef90ad626dc13fb97cdc7e04499ee5fa1007f2c4e1a9439b22fc3755b9",
    name: "Lil Duckies",
  },
  {
    address: "0x02c3d976495cd521f00f98e22ce6feb25b9e5b1724f6af3423c932d44d0fc152",
    name: "Ducks Everywhere",
  },
  {
    // Minimal ERC-721 (snake-case balance_of, no on-chain name/symbol) — rename
    // this label to taste.
    address: "0x058e75fe127b94923d6efe51c56bca98bd82cd43c7fd2ea562019a3101c245f9",
    name: "Collection 0x058e…245f9",
  },
  {
    // Enumerable — token IDs auto-resolve via tokenOfOwnerByIndex.
    address: "0x02acee8c430f62333cf0e0e7a94b2347b5513b4c25f699461dd8d7b23c072478",
    name: "EveraiDuo",
  },
  {
    // Enumerable — token IDs auto-resolve via tokenOfOwnerByIndex.
    address: "0x058949fa2955b10b3a82521934e8b0505dc0b7ba929c3049622ae91d2c52e194",
    name: "Dungeon Ducks",
  },
];
