"use server";

// supabase-imports
import { getSupabaseAdminClient } from "../config/client";
import type { LoanRecord } from "@/lib/types";

///////////////////////////////////////////////////////////////////////////
//// function to create a borrow record after the contract emits Borrowed
//////////////////////////////////////////////////////////////////////////
export type BorrowRecordInput = {
  user_address: `0x${string}`;
  total_debt: number;
  remaining_debt: number;
  deadline: number;
  nonce: string;
  status: string;
  borrow_signature: `0x${string}`;
  permit_v: number;
  permit_r: `0x${string}`;
  permit_s: `0x${string}`;
  is_processed: boolean;
};

export type RepayRecordInput = {
  user_address: `0x${string}`;
  repaid_amount: number;
};

export const createBorrowRecord = async (borrowInfo: BorrowRecordInput) => {
  try {
    const supabaseAdmin = getSupabaseAdminClient();

    const nowSeconds = Math.floor(Date.now() / 1000);
    const maxDeadlineSeconds = nowSeconds + 7 * 24 * 3600;
    // Keep user-selected deadline from signed payload, but clamp to [now, now+7d].
    const normalizedDeadlineSeconds = Math.min(
      Math.max(borrowInfo.deadline, nowSeconds),
      maxDeadlineSeconds,
    );
    console.log("borrowInfo: ", borrowInfo);
    const { data, error } = await supabaseAdmin
      .from("loans")
      .insert({
        user_address: borrowInfo.user_address.trim().toLowerCase(),
        total_debt: borrowInfo.total_debt,
        remaining_debt: borrowInfo.remaining_debt,
        deadline: new Date(normalizedDeadlineSeconds * 1000).toISOString(),
        nonce: borrowInfo.nonce,
        status: borrowInfo.status,
        borrow_signature: borrowInfo.borrow_signature,
        permit_v: borrowInfo.permit_v,
        permit_r: borrowInfo.permit_r,
        permit_s: borrowInfo.permit_s,
        is_processed: borrowInfo.is_processed,
      })
      .select("user_address")
      .single();
    console.log("here");
    if (error) {
      console.log("Error creating borrow record:", error);
      return null;
    }

    return data;
  } catch (error) {
    console.log("Error creating borrow record:", error);
    return null;
  }
};

export const syncRepayRecord = async (repayInfo: RepayRecordInput) => {
  try {
    const supabaseAdmin = getSupabaseAdminClient();
    const normalizedAddress = repayInfo.user_address.trim().toLowerCase();

    const { data: existingLoan, error: fetchError } = await supabaseAdmin
      .from("loans")
      .select("remaining_debt")
      .eq("user_address", normalizedAddress)
      .eq("status", "borrowed")
      .maybeSingle();

    if (fetchError) {
      console.log("Error reading loan before repay sync:", fetchError);
      return null;
    }

    if (!existingLoan) {
      console.log("No loan found for repay sync:", normalizedAddress);
      return null;
    }

    const nextRemainingDebt = Math.max(
      Number(existingLoan.remaining_debt) - repayInfo.repaid_amount,
      0,
    );

    const { data, error } = await supabaseAdmin
      .from("loans")
      .update({
        remaining_debt: nextRemainingDebt,
        status: nextRemainingDebt > 0 ? "borrowed" : "repaid",
        is_processed: true,
      })
      .eq("user_address", normalizedAddress)
      .eq("status", "borrowed")
      .select(
        "user_address,total_debt,remaining_debt,deadline,status,borrow_signature,permit_v,permit_r,permit_s,is_processed",
      )
      .maybeSingle();

    if (error) {
      console.log("Error updating loan after repay:", error);
      return null;
    }

    return data as LoanRecord | null;
  } catch (error) {
    console.log("Error syncing repay record:", error);
    return null;
  }
};

export const getLoans = async (
  userAddress?: `0x${string}`,
): Promise<LoanRecord[]> => {
  try {
    const supabaseAdmin = getSupabaseAdminClient();

    let query = supabaseAdmin
      .from("loans")
      .select(
        "user_address,total_debt,remaining_debt,deadline,status,borrow_signature,permit_v,permit_r,permit_s,is_processed",
      )
      .order("deadline", { ascending: false });

    if (userAddress) {
      query = query.eq("user_address", userAddress.trim().toLowerCase());
    }

    const { data, error } = await query;

    if (error) {
      console.log("Error fetching loans:", error);
      return [];
    }

    return (data ?? []) as LoanRecord[];
  } catch (error) {
    console.log("Error fetching loans:", error);
    return [];
  }
};
