import { NextResponse } from "next/server";

import {
  createBorrowRecord,
  type BorrowRecordInput,
} from "@/lib/supabase/scripts/action";

export const runtime = "nodejs";

type BorrowSyncPayload = BorrowRecordInput;

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as Partial<BorrowSyncPayload>;

    if (
      !body.user_address ||
      body.total_debt === undefined ||
      body.remaining_debt === undefined ||
      body.deadline === undefined ||
      body.nonce === undefined ||
      !body.status ||
      !body.borrow_signature ||
      body.permit_v === undefined ||
      !body.permit_r ||
      !body.permit_s ||
      body.is_processed === undefined
    ) {
      return NextResponse.json(
        { ok: false, error: "Missing borrow sync payload fields." },
        { status: 400 },
      );
    }

    const record = await createBorrowRecord({
      user_address: body.user_address,
      total_debt: Number(body.total_debt),
      remaining_debt: Number(body.remaining_debt),
      deadline: Number(body.deadline),
      nonce: String(body.nonce),
      status: body.status,
      borrow_signature: body.borrow_signature,
      permit_v: Number(body.permit_v),
      permit_r: body.permit_r,
      permit_s: body.permit_s,
      is_processed: Boolean(body.is_processed),
    });

    if (!record) {
      return NextResponse.json(
        { ok: false, error: "Failed to save borrow record." },
        { status: 500 },
      );
    }

    return NextResponse.json({ ok: true, record });
  } catch (error) {
    console.log("Borrow sync route failed:", error);
    return NextResponse.json(
      { ok: false, error: "Borrow sync route failed." },
      { status: 500 },
    );
  }
}
