import { CONTRACT_ADDRESS } from "@/constants";
import { generateNonce } from "@/lib/HelperFunction";

export const BORROW_INTENT_DOMAIN = {
  name: "CreloLoan",
  version: "1",
} as const;

export const USDC_PERMIT_DOMAIN = {
  name: "USD Coin",
  version: "2",
} as const;

// The canonical USDC contract address used for building EIP-712 domains
// and default verifyingContract values in development. Replace with
// the test/mainnet address appropriate for the deployed environment.

export const USDC_CONTRACT_ADDRESS =
  "0x036CbD53842c5426634e7929541eC2318f3dCF7e" as `0x${string}`;

export const BORROW_INTENT_DURATION_SECONDS = 30 * 60;

// BorrowIntentSignature captures the typed borrow intent that the user
// signs with `signTypedData`. This signature proves the user's agreement
// to borrow and is distinct from the ERC-2612 permit flow.

export type BorrowIntentSignature = {
  address: `0x${string}`;
  amount: number;
  chainId: number;
  nonce: bigint;
  deadline: number;
  message: string;
  signature: string;
  timestamp: number;
};

export type BorrowIntentData = {
  domain: {
    name: string;
    version: string;
    chainId: number;
    verifyingContract: `0x${string}`;
  };
  types: {
    PermitRequest: Array<{ name: string; type: string }>;
  };
  primaryType: "PermitRequest";
  message: {
    amount: bigint;
    nonce: bigint;
    deadline: bigint;
  };
  nonce: bigint;
  deadline: number;
};

export type BorrowPermitData = {
  nonce: bigint;
  deadline: number;
  owner: `0x${string}`;
  spender: `0x${string}`;
  value: bigint;
};

// BorrowPermitSignature stores the parsed ECDSA pieces returned by
// splitting a 65-byte signature. Contracts generally accept v,r,s when
// verifying EIP-2612 permits; we also keep the deadline for display.

export type BorrowPermitSignature = {
  v: number;
  r: `0x${string}`;
  s: `0x${string}`;
  deadline: number;
};

/**
 * Build the human-readable borrow intent message that the user can display
 * alongside the typed-data flow. This is informational only; the contract
 * validates the typed payload produced by `createBorrowIntentData`.
 *
 * @param amount - The USDC amount (decimal, human units) the user intends to borrow
 * @param chainId - The numeric Chain ID where the borrow will occur
 * @param timestamp - UNIX timestamp (seconds) when the intent was created
 * @returns A formatted string suitable for display in the UI
 */
export const buildBorrowIntentMessage = (
  amount: number,
  chainId: number,
  timestamp: number,
) =>
  `I agree to borrow USDC ${amount.toFixed(2)} on chain ${chainId} at ${new Date(timestamp * 1000).toISOString()} from CreloLoan.`;

/**
 * Build the typed borrow intent payload that the contract verifies with
 * `signedPermit`. The payload hashes only `amount`, `nonce`, and `deadline`,
 * so the frontend must sign the same field order and types.
 *
 * @param amount - The USDC amount (human units) the user intends to borrow
 * @param chainId - The chain id used in the EIP-712 domain
 * @param deadline - Optional UNIX timestamp (seconds) when the intent expires
 * @returns Typed-data payload for `signTypedData`
 */
export const createBorrowIntentData = (
  amount: number,
  chainId: number,
  deadline = Math.floor(Date.now() / 1000) + BORROW_INTENT_DURATION_SECONDS,
): BorrowIntentData => {
  const nonce = BigInt(generateNonce());
  console.log(nonce);

  return {
    domain: {
      name: BORROW_INTENT_DOMAIN.name,
      version: BORROW_INTENT_DOMAIN.version,
      chainId,
      verifyingContract: CONTRACT_ADDRESS as `0x${string}`,
    },
    types: {
      PermitRequest: [
        { name: "amount", type: "uint256" },
        { name: "nonce", type: "uint256" },
        { name: "deadline", type: "uint256" },
      ],
    },
    primaryType: "PermitRequest",
    message: {
      amount: BigInt(Math.floor(amount * 1e6)),
      nonce,
      deadline: BigInt(deadline),
    },
    nonce,
    deadline,
  };
};

// createBorrowPermitData prepares the typed fields required by EIP-712
// permit signing. It converts a human USDC amount (decimal) into the
// token's smallest unit (6 decimals) and sets a default deadline.
// The `nonce` is a placeholder; production must query the token contract
// for the current nonce to prevent signature replay.

/**
 * Create the structured permit payload used when requesting an ERC-2612
 * permit signature from the user. Values are normalized to the types
 * expected by EIP-712 signing and contracts (e.g. USDC has 6 decimals).
 *
 * NOTE: `nonce` is set to `0` here as a placeholder — in production you
 * should read the on-chain nonce from the token contract to prevent replay.
 *
 * @param owner - Owner address (the signer)
 * @param spender - Spender address (the contract to be authorized)
 * @param amount - Human-readable USDC amount (decimal)
 * @param deadline - UNIX timestamp (seconds) when permit expires
 * @returns BorrowPermitData with typed fields ready for EIP-712
 */
export const createBorrowPermitData = (
  owner: `0x${string}`,
  spender: `0x${string}`,
  amount: number,
  deadline = Math.floor(Date.now() / 1000) + BORROW_INTENT_DURATION_SECONDS,
): BorrowPermitData => ({
  nonce: BigInt(0),
  deadline,
  owner,
  spender,
  value: BigInt(Math.floor(amount * 1e6)),
});

/**
 * Split a 65-byte hex signature into its ECDSA components (v, r, s).
 * The returned object aligns with what many contracts expect when
 * a permit or EIP-712 signature is submitted on-chain.
 *
 * @param signature - Full signature hex string (0x...)
 * @returns Parsed `{ v, r, s }` and a placeholder `deadline` (0)
 */
export const splitSignature = (
  signature: `0x${string}`,
): BorrowPermitSignature => ({
  // `r` is the first 32 bytes (0x + 64 hex chars)
  r: signature.slice(0, 66) as `0x${string}`,
  // `s` is the next 32 bytes
  s: `0x${signature.slice(66, 130)}` as `0x${string}`,
  // `v` is the final byte (used by many Solidity verify implementations)
  v: Number.parseInt(signature.slice(130, 132), 16),
  // placeholder; specific deadline comes from the permit payload
  deadline: 0,
});

export const validateBorrowAmount = (
  value: string,
  maxBorrowAmount: number,
) => {
  if (!value.trim()) {
    return "Enter an amount to borrow.";
  }

  const parsedAmount = Number(value);
  if (!Number.isFinite(parsedAmount) || parsedAmount <= 0) {
    return "Enter a valid amount greater than 0.";
  }

  if (parsedAmount > maxBorrowAmount) {
    return `Amount cannot exceed USDC ${maxBorrowAmount.toFixed(2)}.`;
  }

  return null;
};

export const isBorrowAmountValid = (
  borrowAmountInput: string,
  borrowAmountError: string | null,
  maxBorrowAmount: number,
) =>
  !!borrowAmountInput &&
  !borrowAmountError &&
  Number(borrowAmountInput) > 0 &&
  Number(borrowAmountInput) <= maxBorrowAmount;
