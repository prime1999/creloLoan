import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { LoanRecord } from "@/lib/types";

export type RepayLoanInput = {
  userAddress: `0x${string}`;
  repaidAmount: number;
};

export type LoansPaginatedResponse = {
  loans: LoanRecord[];
  pagination: {
    currentPage: number;
    totalPages: number;
    totalLoans: number;
    loansPerPage: number;
  };
};

export const useGetLoans = (address?: `0x${string}`, page: number = 1) => {
  return useQuery({
    queryKey: ["loans", address ?? "all", page],
    enabled: !!address,
    queryFn: async (): Promise<LoansPaginatedResponse> => {
      const params = new URLSearchParams();
      if (address) {
        params.set("address", address);
      }
      params.set("page", page.toString());

      const response = await fetch(`/api/loans?${params.toString()}`, {
        method: "GET",
        headers: {
          "Content-Type": "application/json",
        },
      });

      if (!response.ok) {
        throw new Error("Failed to fetch loans");
      }

      return response.json();
    },
    staleTime: 30000,
    gcTime: 5 * 60 * 1000,
  });
};

export const useRepayLoanMutation = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationKey: ["repay-loan"],
    mutationFn: async ({
      userAddress,
      repaidAmount,
    }: RepayLoanInput): Promise<void> => {
      const response = await fetch("/api/loans/repay", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          user_address: userAddress,
          repaid_amount: repaidAmount,
        }),
      });

      if (!response.ok) {
        throw new Error(
          "Repay succeeded on-chain, but the database update failed.",
        );
      }
    },
    onSuccess: async (_data, variables) => {
      await queryClient.invalidateQueries({
        queryKey: ["loans", variables.userAddress],
      });
    },
  });
};
