"use client";

import { http, createConfig } from "wagmi";
import { sepolia, baseSepolia } from "wagmi/chains";
import { coinbaseWallet, injected } from "wagmi/connectors";

// Central wagmi runtime config used by wallet hooks and contract actions.
export const config = createConfig({
  // Support both default Sepolia and Base Sepolia networks.
  chains: [sepolia, baseSepolia],
  // Allow injected wallets and Coinbase Wallet connector.
  connectors: [injected(), coinbaseWallet({ appName: "Crelo-Loan" })],
  transports: {
    // Default RPC for Sepolia.
    [sepolia.id]: http(),
    // Explicit RPC for Base Sepolia used by contract interactions.
    [baseSepolia.id]: http(
      "https://base-sepolia.g.alchemy.com/v2/m_5pGtsiLUo492z_p9LbQ",
    ),
  },
});
