import { useState } from "react";
import {
  getIndexerConfig,
  setIndexerConfig,
} from "../lib/indexerConfig";
import { getRpcUrl, setRpcUrl } from "../lib/provider";
import {
  DEFAULT_INDEXER_BASE,
  DEFAULT_INDEXER_CHAIN,
  DEFAULT_INDEXER_KEY_HEADER,
  DEFAULT_RPC_URL,
} from "../config";

export function Settings({ onClose }: { onClose: () => void }) {
  const idx = getIndexerConfig();
  const [rpc, setRpc] = useState(getRpcUrl());
  const [base, setBase] = useState(idx.base);
  const [chain, setChain] = useState(idx.chain);
  const [key, setKey] = useState(idx.key);
  const [header, setHeader] = useState(idx.keyHeader);
  const [nftUrl, setNftUrl] = useState(idx.nftUrlTemplate);
  const [saved, setSaved] = useState(false);

  function save() {
    setRpcUrl(rpc || DEFAULT_RPC_URL);
    setIndexerConfig({
      base: base || DEFAULT_INDEXER_BASE,
      chain: chain || DEFAULT_INDEXER_CHAIN,
      key,
      keyHeader: header || DEFAULT_INDEXER_KEY_HEADER,
      nftUrlTemplate: nftUrl,
    });
    setSaved(true);
    setTimeout(() => setSaved(false), 1500);
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h2>Settings</h2>
          <button className="icon-btn" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </div>

        <label className="field">
          <span>Starknet RPC URL</span>
          <input value={rpc} onChange={(e) => setRpc(e.target.value)} spellCheck={false} />
          <small>Public, CORS-open mainnet RPC. Used for balance reads &amp; signature checks.</small>
        </label>

        <hr />
        <h3>Starkscan Agent API (token discovery)</h3>
        <p className="muted">
          A key auto-detects <strong>all</strong> ERC-20 holdings via Starkscan’s{" "}
          <code>token-holdings</code> endpoint. It is stored only in this browser
          (localStorage) and sent directly to Starkscan — never committed
          anywhere. Get a key at starkscan.co. NFTs are not covered by this API
          (add them manually).
        </p>

        <label className="field">
          <span>API base URL</span>
          <input value={base} onChange={(e) => setBase(e.target.value)} spellCheck={false} />
        </label>
        <label className="field">
          <span>Chain</span>
          <input value={chain} onChange={(e) => setChain(e.target.value)} spellCheck={false} />
        </label>
        <label className="field">
          <span>API key</span>
          <input
            type="password"
            value={key}
            onChange={(e) => setKey(e.target.value)}
            placeholder="paste your Starkscan API key"
            spellCheck={false}
          />
        </label>
        <label className="field">
          <span>Key header name</span>
          <input value={header} onChange={(e) => setHeader(e.target.value)} spellCheck={false} />
        </label>

        <hr />
        <h3>Custom NFT holdings URL (optional)</h3>
        <p className="muted">
          Starkscan can’t list NFTs by owner. If you have another provider, put
          its URL here using <code>{"{address}"}</code> as a placeholder. Leave
          blank to add NFTs manually. The API key above is sent as the same
          header.
        </p>
        <label className="field">
          <span>NFT holdings URL template</span>
          <input
            value={nftUrl}
            onChange={(e) => setNftUrl(e.target.value)}
            placeholder="https://…/nfts?owner={address}"
            spellCheck={false}
          />
        </label>

        <div className="modal-actions">
          <button className="btn ghost" onClick={onClose}>
            Close
          </button>
          <button className="btn primary" onClick={save}>
            {saved ? "Saved ✓" : "Save"}
          </button>
        </div>
      </div>
    </div>
  );
}
