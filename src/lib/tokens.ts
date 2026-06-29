/**
 * Curated list of popular Starknet **mainnet** ERC-20 tokens.
 *
 * Starknet has no on-chain "list my tokens" call, so the app checks the
 * balance of each token below via RPC. Add more tokens here freely, or use the
 * "Add token manually" field in the UI (which reads symbol/decimals on-chain).
 *
 * Addresses are normalized at load time. `isGasToken` marks tokens that can pay
 * transaction fees (ETH, STRK) — the migrator keeps a buffer of these so the
 * sender can still afford gas.
 */
export interface TokenInfo {
  address: string;
  symbol: string;
  name: string;
  decimals: number;
  isGasToken?: boolean;
}

export const MAINNET_TOKENS: TokenInfo[] = [
  {
    address: "0x049d36570d4e46f48e99674bd3fcc84644ddd6b96f7c741b1562b82f9e004dc7",
    symbol: "ETH",
    name: "Ether",
    decimals: 18,
    isGasToken: true,
  },
  {
    address: "0x04718f5a0fc34cc1af16a1cdee98ffb20c31f5cd61d6ab07201858f4287c938d",
    symbol: "STRK",
    name: "Starknet Token",
    decimals: 18,
    isGasToken: true,
  },
  {
    address: "0x053c91253bc9682c04929ca02ed00b3e423f6710d2ee7e0d5ebb06f3ecf368a8",
    symbol: "USDC",
    name: "USD Coin",
    decimals: 6,
  },
  {
    address: "0x068f5c6a61780768455de69077e07e89787839bf8166decfbf92b645209c0fb8",
    symbol: "USDT",
    name: "Tether USD",
    decimals: 6,
  },
  {
    address: "0x05574eb6b8789a91466f902c380d978e472db68170ff82a5b650b95a58ddf4ad",
    symbol: "DAI",
    name: "Dai Stablecoin",
    decimals: 18,
  },
  {
    address: "0x03fe2b97c1fd336e750087d68b9b867997fd64a2661ff3ca5a7c771641e8e7ac",
    symbol: "WBTC",
    name: "Wrapped BTC",
    decimals: 8,
  },
  {
    address: "0x042b8f0484674ca266ac5d08e4ac6a3fe65bd3129795def2dca5c34ecc5f96d2",
    symbol: "wstETH",
    name: "Wrapped liquid staked Ether",
    decimals: 18,
  },
  {
    address: "0x0124aeb495b947201f5fac96fd1138e326ad86195b98df6dec9009158a533b49",
    symbol: "LORDS",
    name: "Lords",
    decimals: 18,
  },
  {
    address: "0x075afe6402ad5a5c20dd25e10ec3b3986acaa647b77e4ae24b0cbc9a54a27a87",
    symbol: "EKUBO",
    name: "Ekubo Protocol",
    decimals: 18,
  },
  {
    address: "0x00585c32b625999e6e5e78645ff8df7a9001cf5cf3eb6b80ccdd16cb64bd3a34",
    symbol: "ZEND",
    name: "zkLend Token",
    decimals: 18,
  },
  {
    address: "0x07c535ddb7bf3d3cb7c033bd1a4c3aac02927a4832da795606c0f3dbbc6efd17",
    symbol: "nSTRK",
    name: "Nostra Staked STRK",
    decimals: 18,
  },
];
