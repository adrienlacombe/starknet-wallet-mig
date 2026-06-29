import { RpcProvider } from "starknet";
import { DEFAULT_RPC_URL, LS } from "../config";

export function getRpcUrl(): string {
  return localStorage.getItem(LS.rpcUrl) || DEFAULT_RPC_URL;
}

export function setRpcUrl(url: string) {
  localStorage.setItem(LS.rpcUrl, url.trim());
}

/** A read-only provider used for balance reads, ownerOf checks, sig verification. */
export function makeProvider(): RpcProvider {
  return new RpcProvider({ nodeUrl: getRpcUrl() });
}
