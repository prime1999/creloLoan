import { NextResponse } from "next/server";
import { getLoans } from "@/lib/supabase/scripts/action";

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const address = url.searchParams.get("address")?.toLowerCase();
    const loans = await getLoans(address as `0x${string}` | undefined);
    return NextResponse.json({ loans }, { status: 200 });
  } catch (error) {
    console.error("Failed to fetch loans:", error);
    return NextResponse.json(
      { error: "Failed to fetch loans" },
      { status: 500 },
    );
  }
}
