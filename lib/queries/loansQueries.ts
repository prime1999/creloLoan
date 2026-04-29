import { useQuery } from "@tanstack/react-query";
import type { LoanRecord } from "@/lib/types";

export const useGetLoans = (address?: `0x${string}`) => {
  return useQuery({
    queryKey: ["loans", address ?? "all"],
    enabled: !!address,
    queryFn: async (): Promise<LoanRecord[]> => {
      const params = new URLSearchParams();
      if (address) {
        params.set("address", address);
      }

      const response = await fetch(`/api/loans?${params.toString()}`, {
        method: "GET",
        headers: {
          "Content-Type": "application/json",
        },
      });

      if (!response.ok) {
        throw new Error("Failed to fetch loans");
      }

      const data = await response.json();
      return data.loans;
    },
    staleTime: 30000,
    gcTime: 5 * 60 * 1000,
  });
};
