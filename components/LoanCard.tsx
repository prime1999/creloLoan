"use client";

import { useState } from "react";
import { useAccount } from "wagmi";
import { waitForTransactionReceipt } from "wagmi/actions";
import { parseEventLogs } from "viem";
import { LoanCardProps } from "@/lib/types";
// icont-imports
import {
  Clock3,
  Coins,
  CircleDollarSign,
  BanknoteArrowUp,
  BadgeCheck,
  LoaderCircle,
} from "lucide-react";
import {
  formatAddress,
  currencyFormatter,
  formatDeadline,
} from "@/lib/HelperFunction";
import { CONTRACT_ABI } from "@/constants";
import { config } from "@/config";
import { repayFromContract } from "@/lib/actions/ContractAction";
import { useRepayLoanMutation } from "@/lib/queries/loansQueries";

const LoanCard = ({ loan }: LoanCardProps) => {
  const { address, isConnected } = useAccount();
  const [isRepaying, setIsRepaying] = useState(false);
  const [repayError, setRepayError] = useState<string | null>(null);
  const repayLoanMutation = useRepayLoanMutation();

  const canRepay =
    loan.status === "borrowed" &&
    loan.remaining_debt > 0 &&
    isConnected &&
    !!address;

  const handleRepay = async () => {
    if (!canRepay || !address) return;

    const normalizedAddress = address.toLowerCase();
    if (normalizedAddress !== loan.user_address.toLowerCase()) return;

    setIsRepaying(true);
    setRepayError(null);

    try {
      const repayAmount = BigInt(Math.round(loan.remaining_debt * 1e6));
      const txHash = await repayFromContract({
        borrower: address,
        amount: repayAmount,
      });

      const receipt = await waitForTransactionReceipt(config, {
        hash: txHash,
      });

      const repayEvents = parseEventLogs({
        abi: CONTRACT_ABI,
        logs: receipt.logs,
        eventName: "Repaid",
      });

      if (!repayEvents.length) {
        throw new Error(
          "Repaid event was not found in the transaction receipt.",
        );
      }

      const repayEvent = repayEvents[0] as unknown as {
        args: {
          borrower: `0x${string}`;
          amount: bigint;
        };
      };

      if (repayEvent.args.borrower.toLowerCase() !== normalizedAddress) {
        throw new Error(
          "Repaid event borrower did not match the connected wallet.",
        );
      }

      await repayLoanMutation.mutateAsync({
        userAddress: address,
        repaidAmount: Number(repayEvent.args.amount) / 1e6,
      });
    } catch (error) {
      setRepayError(
        error instanceof Error ? error.message : "Failed to repay this loan.",
      );
    } finally {
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
        <div className="flex items-center">
          <div className="flex flex-col items-start gap-2 text-xs text-white border-r border-white/10 pr-4">
            <h6 className="flex gap-1 text-gold">
              {" "}
              <span>
                <Coins size={12} />
              </span>
              Total-Debt
            </h6>
            <p>{currencyFormatter.format(loan.total_debt)}</p>
          </div>
          <div className="flex flex-col items-start gap-2 text-xs text-white border-r border-white/10 px-4">
            <h6 className="flex gap-1 text-gold">
              {" "}
              <span>
                <Coins size={12} />
              </span>
              Remaining-Debt
            </h6>
            <p>{currencyFormatter.format(loan.remaining_debt)}</p>
          </div>
          <div className="flex flex-col items-start gap-2 text-xs text-white px-4">
            <h6 className="flex gap-1 text-gold">
              {" "}
              <span>
                <Clock3 size={12} />
              </span>
              Deadline
            </h6>
            <p>{formatDeadline(loan.deadline)}</p>
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
