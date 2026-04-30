import { NextResponse } from "next/server";
import { getLoans } from "@/lib/supabase/scripts/action";

const LOANS_PER_PAGE = 3;

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const address = url.searchParams.get("address")?.toLowerCase();
    const page = Math.max(1, parseInt(url.searchParams.get("page") || "1"));

    // Fetch all loans first to calculate total
    const allLoans = await getLoans(address as `0x${string}` | undefined);
    const totalLoans = allLoans.length;
    const totalPages = Math.ceil(totalLoans / LOANS_PER_PAGE);

    // Calculate offset and paginate
    const offset = (page - 1) * LOANS_PER_PAGE;
    const paginatedLoans = allLoans.slice(offset, offset + LOANS_PER_PAGE);

    return NextResponse.json(
      {
        loans: paginatedLoans,
        pagination: {
          currentPage: page,
          totalPages,
          totalLoans,
          loansPerPage: LOANS_PER_PAGE,
        },
      },
      { status: 200 },
    );
  } catch (error) {
    console.error("Failed to fetch loans:", error);
    return NextResponse.json(
      { error: "Failed to fetch loans" },
      { status: 500 },
    );
  }
}
