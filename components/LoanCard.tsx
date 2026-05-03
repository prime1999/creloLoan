"use client";

// React hooks for state management
import { useState } from "react";
// wagmi hook for accessing the connected account and connection status
import { useAccount } from "wagmi";
// Helper to wait for a transaction to be mined and obtain its receipt
import { waitForTransactionReceipt } from "wagmi/actions";
// Helper to parse event logs from transaction receipts
import { parseEventLogs } from "viem";
// Type definitions for the loan card props
import { LoanCardProps } from "@/lib/types";
// Icon components for visual indicators in the UI
import {
  Clock3, // Clock icon for deadline display
  Coins, // Coins icon for debt amounts
  CircleDollarSign, // Dollar sign icon for status badge
  BanknoteArrowUp, // Arrow icon for repay button
  BadgeCheck, // Check mark for verified status
  LoaderCircle, // Spinner for loading state
} from "lucide-react";
// shadcn Popover components for deadline picker
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
// shadcn Calendar component for date selection
import { Calendar } from "@/components/ui/calendar";
// Helper functions for formatting display values
import {
  formatAddress, // Shortens wallet addresses to readable format (0x1234...5678)
  currencyFormatter, // Formats numbers as USD currency strings
  formatDeadline, // Converts unix timestamp to human-readable deadline text
} from "@/lib/HelperFunction";
// Smart contract ABI needed to decode event logs from mined transactions
import { CONTRACT_ABI } from "@/constants";
// wagmi configuration for transaction receipt polling
import { config } from "@/config";
// Function to submit a repay transaction to the smart contract
import { repayFromContract } from "@/lib/actions/ContractAction";
// React Query mutation hook for updating loan status in the backend database
import { useRepayLoanMutation } from "@/lib/queries/loansQueries";

/**
 * LoanCard component displays a loan's details and provides a repay action.
 * Renders: loan summary (total debt, remaining debt, deadline) and repay button.
 * Props: loan object containing user address, debt amounts, status, and deadline.
 */
const LoanCard = ({ loan }: LoanCardProps) => {
  // Get the currently connected wallet address and connection status from wagmi
  const { address, isConnected } = useAccount();
  // UI flag shown while the repay transaction is being submitted and processed
  const [isRepaying, setIsRepaying] = useState(false);
  // Error message displayed to the user if the repay flow fails
  const [repayError, setRepayError] = useState<string | null>(null);
  // React Query mutation hook to persist the repaid amount in the backend database
  const repayLoanMutation = useRepayLoanMutation();
  // Whether the deadline picker popover is open or closed
  const [isDeadlineOpen, setIsDeadlineOpen] = useState(false);
  // The deadline date selected by the user (initialized from loan deadline string converted to unix timestamp)
  const [selectedDeadline, setSelectedDeadline] = useState<Date | undefined>(
    new Date(parseInt(loan.deadline) * 1000),
  );

  // Compute whether the repay button should be enabled based on multiple conditions:
  // - loan must have "borrowed" status (not already fully repaid or in another state)
  // - must have outstanding remaining_debt greater than zero
  // - user must have a connected wallet via wagmi
  // - the wallet address must be available for transaction submission
  const canRepay =
    loan.status === "borrowed" &&
    loan.remaining_debt > 0 &&
    isConnected &&
    !!address;

  /**
   * Handle deadline selection from the calendar popover.
   * Updates the selected deadline state and closes the popover after selection.
   */
  const handleDeadlineSelect = (date: Date | undefined) => {
    // Update the selected deadline with the user's chosen date
    setSelectedDeadline(date);
    // Close the popover after the user has made a selection
    setIsDeadlineOpen(false);
  };

  /**
   * Handle the repay action triggered by the user clicking the repay button.
   * Complete flow:
   * 1. Validate preconditions (canRepay, address, wallet ownership match)
   * 2. Convert remaining debt amount to contract base units (multiply by 1e6)
   * 3. Submit the repay transaction to the smart contract
   * 4. Wait for the transaction to be mined and obtain its receipt
   * 5. Parse and verify the Repaid event was emitted by the contract
   * 6. Verify event details match the current wallet
   * 7. Update the backend database with the confirmed repaid amount
   * 8. Handle any errors gracefully and update UI error state
   */
  const handleRepay = async () => {
    // Guard: early exit if repay is disabled or no address available
    if (!canRepay || !address) return;

    // Normalize the connected wallet address to lowercase for safe comparison
    const normalizedAddress = address.toLowerCase();
    // Verify the connected wallet is the same as the loan's original borrower
    // This prevents one address from repaying another address's loan
    if (normalizedAddress !== loan.user_address.toLowerCase()) return;

    // Set loading state to show spinner in UI and clear any previous error
    setIsRepaying(true);
    setRepayError(null);

    try {
      // Convert the remaining debt from USDC decimal format (6 decimals) to wei (base units)
      // Math.round ensures no precision loss when converting float to BigInt
      const repayAmount = BigInt(Math.round(loan.remaining_debt * 1e6));
      // Submit the repay transaction to the contract and receive the transaction hash
      const txHash = await repayFromContract({
        borrower: address,
        amount: repayAmount,
      });

      // Wait for the transaction to be mined by polling for its receipt
      // This confirms the on-chain transaction has been included in a block
      const receipt = await waitForTransactionReceipt(config, {
        hash: txHash,
      });

      // Parse the transaction's logs using the contract ABI to find Repaid events
      // This extracts structured event data from raw EVM logs
      const repayEvents = parseEventLogs({
        abi: CONTRACT_ABI,
        logs: receipt.logs,
        eventName: "Repaid",
      });

      // Ensure at least one Repaid event was emitted (indicates successful contract execution)
      if (!repayEvents.length) {
        throw new Error(
          "Repaid event was not found in the transaction receipt.",
        );
      }

      // Extract the first Repaid event and normalize typing for safe property access
      const repayEvent = repayEvents[0] as unknown as {
        args: {
          borrower: `0x${string}`;
          amount: bigint;
        };
      };

      // Verify the event's borrower address matches the connected wallet
      // This protects against mismatched addresses or signature replay attacks
      if (repayEvent.args.borrower.toLowerCase() !== normalizedAddress) {
        throw new Error(
          "Repaid event borrower did not match the connected wallet.",
        );
      }

      // Update the backend database with the confirmed repaid amount
      // Convert the event's amount from contract base units back to USDC decimal (divide by 1e6)
      await repayLoanMutation.mutateAsync({
        userAddress: address,
        repaidAmount: Number(repayEvent.args.amount) / 1e6,
      });
    } catch (error) {
      // Capture any error during the repay flow and display it to the user
      // If it's an Error object, use its message; otherwise use a generic message
      setRepayError(
        error instanceof Error ? error.message : "Failed to repay this loan.",
      );
    } finally {
      // Always exit loading state when the flow completes (success or error)
      setIsRepaying(false);
    }
  };

  return (
    <div className="group relative overflow-hidden rounded-2xl border border-white/10 bg-gradient-to-br from-zinc-950 via-zinc-950 to-zinc-900/80 p-[1px] shadow-[0_18px_60px_rgba(0,0,0,0.35)] transition-transform duration-300 hover:-translate-y-1 hover:border-gold/20">
      <div className="flex items-center justify-between px-4 pt-4">
        <div className="text-xs font-semibold tracking-tight text-zinc-400 sm:text-sm">
          {formatAddress(loan.user_address)}
        </div>
        <div
          className={`inline-flex items-center gap-2 rounded-full border px-3.5 py-1.5 text-[10px] font-semibold uppercase tracking-[0.3em] ${
            loan.is_processed
              ? "border-emerald-500/25 bg-emerald-500/10 text-emerald-300"
              : "border-amber-500/25 bg-amber-500/10 text-amber-300"
          }`}
        >
          {loan.is_processed ? (
            <BadgeCheck size={12} />
          ) : (
            <CircleDollarSign size={12} />
          )}
          {loan.status}
        </div>
      </div>

      <div className="flex justify-between items-center p-4">
        <div>
          <div className="flex items-center">
            <div className="flex flex-col items-start justify-start text-xs text-white border-r border-zinc-400 pr-4">
              <h6 className="flex gap-1 text-gold">
                {" "}
                <span>
                  <Coins size={12} />
                </span>
                Total-Debt
              </h6>
              <p className="ml-4">
                {currencyFormatter.format(loan.total_debt)}
              </p>
            </div>
            <div className="flex flex-col items-start justify-start text-xs text-white px-4">
              <h6 className="flex gap-1 items-center text-gold">
                {" "}
                <span>
                  <Coins size={12} />
                </span>
                Remaining-Debt
              </h6>
              <p className="ml-4">
                {currencyFormatter.format(loan.remaining_debt)}
              </p>
            </div>
          </div>
          <div className="flex flex-col items-start mt-2 pt-2 border-t border-zinc-400 text-xs text-white px-4">
            <h6 className="flex gap-1 text-gold">
              {" "}
              <span>
                <Clock3 size={12} />
              </span>
              Deadline
            </h6>
            {/* Deadline picker with popover and calendar */}
            <Popover open={isDeadlineOpen} onOpenChange={setIsDeadlineOpen}>
              <PopoverTrigger asChild>
                {/* Clickable input button showing the current deadline */}
                <button
                  type="button"
                  className="ml-4 mt-1 rounded-md bg-zinc-800/50 px-2 py-1 text-xs text-zinc-300 hover:bg-zinc-700/50 transition-colors cursor-pointer"
                >
                  {selectedDeadline
                    ? formatDeadline(
                        Math.floor(
                          selectedDeadline.getTime() / 1000,
                        ).toString(),
                      )
                    : "Pick a deadline"}
                </button>
              </PopoverTrigger>
              {/* Popover containing the calendar for deadline selection */}
              <PopoverContent
                className="w-auto p-0 bg-zinc-950 text-white border border-zinc-800"
                align="start"
              >
                {/* Calendar component allowing the user to select a new deadline */}
                <Calendar
                  mode="single"
                  selected={selectedDeadline}
                  onSelect={handleDeadlineSelect}
                  className="rounded-md"
                />
              </PopoverContent>
            </Popover>
          </div>
        </div>
        <div className="flex flex-col items-end gap-2">
          {loan.status === "borrowed" && (
            <button
              type="button"
              onClick={() => void handleRepay()}
              disabled={!canRepay || isRepaying || repayLoanMutation.isPending}
              className="flex items-center gap-1 rounded-3xl border border-gold bg-gold/10 px-3.5 py-1.5 text-[10px] font-semibold tracking-[0.3em] text-gold duration-500 hover:bg-gold/20 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {isRepaying || repayLoanMutation.isPending ? (
                <LoaderCircle size={12} className="animate-spin" />
              ) : (
                <BanknoteArrowUp size={12} />
              )}
              {isRepaying || repayLoanMutation.isPending
                ? "Repaying..."
                : "Repay loan"}
            </button>
          )}
          {repayError && (
            <p className="max-w-[14rem] text-right text-[10px] leading-tight text-red-300">
              {repayError}
            </p>
          )}
        </div>
      </div>
    </div>
  );
};

export default LoanCard;
