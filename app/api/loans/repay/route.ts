import { NextResponse } from "next/server";

import { syncRepayRecord } from "@/lib/supabase/scripts/action";

export const runtime = "nodejs";

type RepaySyncPayload = {
  user_address: `0x${string}`;
  repaid_amount: number;
};

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as Partial<RepaySyncPayload>;

    if (!body.user_address || body.repaid_amount === undefined) {
      return NextResponse.json(
        { ok: false, error: "Missing repay sync payload fields." },
        { status: 400 },
      );
    }

    const record = await syncRepayRecord({
      user_address: body.user_address,
      repaid_amount: Number(body.repaid_amount),
    });

    if (!record) {
      return NextResponse.json(
        { ok: false, error: "Failed to update loan after repay." },
        { status: 500 },
      );
    }

    return NextResponse.json({ ok: true, record });
  } catch (error) {
    console.log("Repay sync route failed:", error);
    return NextResponse.json(
      { ok: false, error: "Repay sync route failed." },
      { status: 500 },
    );
  }
}
