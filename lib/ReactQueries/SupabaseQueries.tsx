"use client";

import { useMutation, useQuery } from "@tanstack/react-query";
import { getLoans } from "../supabase/scripts/action";

///////////////////////////////////////////////////////////////
/// react query hook to get the loan records from the database
///////////////////////////////////////////////////////////////
export const useGetLoanRecords = (userAddress: `0x${string}`) => {
  useQuery({
    queryKey: ["loanRecords", userAddress],
    queryFn: () => getLoans(userAddress),
  });
};
