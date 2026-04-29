"use client";

import { useMutation, useQuery } from "@tanstack/react-query";
import { getLoans } from "../supabase/scripts/action";

///////////////////////////////////////////////////////////////
/// react query hook to get the loan records from the database
///////////////////////////////////////////////////////////////
export const useGetLoanRecords = () => {
  useQuery({
    queryKey: ["loanRecords"],
    queryFn: getLoans,
  });
};
