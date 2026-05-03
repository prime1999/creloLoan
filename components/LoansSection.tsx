"use client";

import { useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { useAccount } from "wagmi";
import { useGetLoans } from "@/lib/queries/loansQueries";
import LoanCard from "@/components/LoanCard";
import { LoansSkeletonGroup } from "@/components/LoanSkeleton";

const LoansSection = () => {
  const [currentPage, setCurrentPage] = useState(1);
  const { address, isConnected } = useAccount();
  const {
    data: response,
    isLoading,
    isError,
    error,
  } = useGetLoans(address as `0x${string}` | undefined, currentPage);

  const loans = response?.loans ?? [];
  const pagination = response?.pagination;

  return (
    <section className="mt-16 mb-8">
      <div className="flex flex-wrap items-end justify-between gap-4 mb-6">
        <div>
          <p className="text-[10px] uppercase tracking-[0.35em] text-zinc-500 mb-2">
            On-chain records
          </p>
          <div className="inline-flex items-center gap-2 rounded-full border border-zinc-700/80 bg-white/5 px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.28em] text-zinc-300">
            <span className="h-2 w-2 rounded-full bg-gold shadow-[0_0_18px_rgba(245,158,11,0.7)]" />
            Loan records
          </div>
        </div>
        <div className="text-xs text-zinc-500">
          {isConnected && address
            ? `Viewing ${address.slice(0, 6)}...${address.slice(-4)}`
            : "Connect your wallet to view loans"}
        </div>
      </div>

      {!isConnected || !address ? (
        <div className="rounded-2xl border border-zinc-800 bg-zinc-950/80 p-8 text-sm text-zinc-400">
          Connect the wallet that created the loan to see only your loan
          records.
        </div>
      ) : isLoading ? (
        <LoansSkeletonGroup count={3} />
      ) : isError ? (
        <div className="rounded-2xl border border-red-800/30 bg-red-950/20 p-8 text-sm text-red-300">
          Failed to load loans. Please try again later.
          {error instanceof Error && ` (${error.message})`}
        </div>
      ) : loans.length === 0 ? (
        <div className="rounded-2xl border border-zinc-800 bg-zinc-950/80 p-8 text-sm text-zinc-400">
          No loans were found for this connected wallet.
        </div>
      ) : (
        <>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 mb-6">
            {loans.map((loan) => (
              <LoanCard
                key={`${loan.user_address}-${loan.deadline}`}
                loan={loan}
              />
            ))}
          </div>

          {pagination && pagination.totalPages > 1 && (
            <div className="flex items-center justify-between gap-4 pt-4 border-t border-zinc-700">
              <div className="text-xs text-zinc-400">
                Page {pagination.currentPage} of {pagination.totalPages} (
                {pagination.totalLoans} total loans)
              </div>
              <div className="flex gap-2">
                <button
                  onClick={() => setCurrentPage(Math.max(1, currentPage - 1))}
                  disabled={currentPage === 1}
                  className="flex items-center gap-1 rounded-lg border border-zinc-700 bg-zinc-900/50 px-3 py-1.5 text-xs font-semibold text-zinc-300 disabled:cursor-not-allowed disabled:opacity-40 hover:bg-zinc-800/80"
                >
                  <ChevronLeft size={14} />
                  Previous
                </button>
                <button
                  onClick={() =>
                    setCurrentPage(
                      Math.min(pagination.totalPages, currentPage + 1),
                    )
                  }
                  disabled={currentPage === pagination.totalPages}
                  className="flex items-center gap-1 rounded-lg border border-zinc-700 bg-zinc-900/50 px-3 py-1.5 text-xs font-semibold text-zinc-300 disabled:cursor-not-allowed disabled:opacity-40 hover:bg-zinc-800/80"
                >
                  Next
                  <ChevronRight size={14} />
                </button>
              </div>
            </div>
          )}
        </>
      )}
    </section>
  );
};

export default LoansSection;
