"use client";

import { simulateContract, writeContract } from "wagmi/actions";

import { config } from "@/config";
import { CONTRACT_ADDRESS, CONTRACT_ABI } from "@/constants";

/**
 * Input shape for `borrowFromContract`.
 * - `borrower`: address that will be recorded as the borrower
 * - `amount`: amount in smallest token units (USDC has 6 decimals)
 * - `deadline`: UNIX timestamp (seconds) permit deadline
 * - `nonce`: permit nonce (bigint)
 * - `signature`: the raw permit signature bytes (0x...)
 */
export type BorrowContractInput = {
  borrower: `0x${string}`;
  amount: bigint;
  deadline: bigint;
  nonce: bigint;
  signature: `0x${string}`;
};

export type RepayContractInput = {
  borrower: `0x${string}`;
  amount: bigint;
};

/**
 * Calls the on-chain `borrow` function on the CreloLoan contract.
 * This function uses `writeContract` from wagmi/actions so it will
 * submit a transaction using the connected wallet.
 *
 * The function assumes the permit (signature) has already been
 * collected from the borrower and is being passed in raw as `signature`.
 *
 * @returns A Promise resolving to the transaction result returned by `writeContract`.
 */
export const borrowFromContract = async ({
  borrower,
  amount,
  deadline,
  nonce,
  signature,
}: BorrowContractInput) => {
  // Ensure an address is provided via environment/config. Without the
  // contract address we cannot submit a transaction.
  if (!CONTRACT_ADDRESS) {
    throw new Error("Contract address is not configured.");
  }

  // Simulate first so we catch contract reverts before prompting users to
  // send the transaction from their wallet.
  const simulation = await simulateContract(config, {
    address: CONTRACT_ADDRESS as `0x${string}`,
    abi: CONTRACT_ABI,
    functionName: "borrow",
    args: [borrower, amount, deadline, nonce, signature],
  });

  // Use wagmi's writeContract helper to send the exact request that passed
  // simulation with the currently connected wallet.
  //
  // Args correspond to the Solidity function signature:
  //   function borrow(address borrower, uint256 amount, uint256 deadline, uint256 nonce, bytes signature)
  return writeContract(config, simulation.request);
};

export const repayFromContract = async ({
  borrower,
  amount,
}: RepayContractInput) => {
  if (!CONTRACT_ADDRESS) {
    throw new Error("Contract address is not configured.");
  }

  const simulation = await simulateContract(config, {
    address: CONTRACT_ADDRESS as `0x${string}`,
    abi: CONTRACT_ABI,
    functionName: "repay",
    args: [borrower, amount],
  });

  return writeContract(config, simulation.request);
};
