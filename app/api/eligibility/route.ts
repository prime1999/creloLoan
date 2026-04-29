import {
  Alchemy,
  AssetTransfersCategory,
  Network,
  SortingOrder,
  type AssetTransfersWithMetadataResult,
} from "alchemy-sdk";
import { NextResponse } from "next/server";
import { isAddress } from "viem";
import type {
  EligibilityAnalysis,
  EligibilityResponse,
} from "@/lib/eligibility";

// This route estimates whether a wallet has recurring income-like inflow while
// discounting suspicious round-trip patterns (wallet -> counterparty -> wallet).
//
// High-level flow:
// 1) Validate request body (address + chain id).
// 2) Build Alchemy client from env values (supports key or full URL).
// 3) Fetch inbound and outbound transfers within the lookback window.
// 4) Normalize transfers into a common shape.
// 5) Mark likely looped transfers and remove their impact from adjusted income.
// 6) Aggregate month-by-month metrics and return eligibility decision.

// Force Node.js runtime because the Alchemy SDK and heuristics run server-side.
export const runtime = "nodejs";

// Heuristic controls for income analysis and anti-loop detection.
// These values are policy knobs, not protocol guarantees.
// Analyze six months of history for recurring monthly income signal.
const LOOKBACK_DAYS = 180;
// Bound pagination to keep request latency predictable.
const MAX_PAGES = 6;
// Ask Alchemy for up to 100 transfers per page.
const PAGE_SIZE = 100;
// Consider round-trips suspicious if funds come back within 72 hours.
const LOOP_WINDOW_MS = 1000 * 60 * 60 * 72;
// Allow up to 15% amount drift for token price movement/fees.
const LOOP_AMOUNT_TOLERANCE = 0.15;
// If looped inflow is above 35% of total inflow, mark as risky.
const MAX_ALLOWED_LOOP_RATIO = 0.35;
// Require at least two active months with adjusted positive inflow.
const MIN_ACTIVE_MONTHS = 2;
// Use the most recent six months to compute the borrow amount.
const BORROW_WINDOW_MONTHS = 6;

// Toggle verbose server logs for transfer inspection and scoring trace.
// Set ELIGIBILITY_DEBUG=false to silence logs.
const ELIGIBILITY_DEBUG = process.env.ELIGIBILITY_DEBUG !== "false";

function logEligibility(step: string, payload?: unknown) {
  if (!ELIGIBILITY_DEBUG) return;
  if (payload === undefined) {
    console.log(`[eligibility] ${step}`);
    return;
  }
  console.log(`[eligibility] ${step}`, payload);
}

function getRecentMonthKeys(referenceDate: Date, count: number): string[] {
  const keys: string[] = [];
  const year = referenceDate.getUTCFullYear();
  const month = referenceDate.getUTCMonth();

  for (let offset = count - 1; offset >= 0; offset -= 1) {
    const date = new Date(Date.UTC(year, month - offset, 1));
    keys.push(date.toISOString().slice(0, 7));
  }

  return keys;
}

function toTransferLogView(transfer: AssetTransfersWithMetadataResult) {
  return {
    hash: transfer.hash,
    from: transfer.from,
    to: transfer.to,
    category: transfer.category,
    asset: transfer.asset,
    value: transfer.value,
    blockTimestamp: transfer.metadata.blockTimestamp,
  };
}

function toParsedTransferLogView(transfer: ParsedTransfer) {
  return {
    hash: transfer.hash,
    counterparty: transfer.counterparty,
    assetKey: transfer.assetKey,
    amount: transfer.amount,
    monthKey: transfer.monthKey,
    suspicious: transfer.suspicious,
    timestamp: new Date(transfer.timestampMs).toISOString(),
  };
}

// Internal normalized transfer shape used by scoring logic.
// Keeping a single shape decouples the scoring layer from raw SDK response fields.
type ParsedTransfer = {
  // Transaction hash for dedupe and matching.
  hash: string;
  // Counterparty wallet used for loop detection.
  counterparty: string;
  // Asset bucket (contract address or symbol fallback).
  assetKey: string;
  // Normalized amount (human-readable units).
  amount: number;
  // Millisecond timestamp used for time-window checks.
  timestampMs: number;
  // Month key in YYYY-MM format for aggregation.
  monthKey: string;
  // Marker set when transfer is matched to suspicious loop behavior.
  suspicious: boolean;
};

function toNetwork(chainId: number): Network {
  // Keep wallet chain handling explicit so unsupported chains fail over to Sepolia.
  switch (chainId) {
    // Base Sepolia chain id.
    case 84532:
      return Network.BASE_SEPOLIA;
    // Ethereum Sepolia chain id.
    case 11155111:
    // Default to Ethereum Sepolia for unknown or new chain ids.
    default:
      return Network.ETH_SEPOLIA;
  }
}

/**
 * Resolve Alchemy SDK initialization settings from environment variables.
 *
 * Supported env styles:
 * - ALCHEMY_API_KEY / NEXT_PUBLIC_ALCHEMY_API_KEY: plain API key.
 * - ALCHEMY_API_URL / NEXT_PUBLIC_ALCHEMY_API_URL: full HTTPS endpoint.
 *
 * Why both are supported:
 * Teams often configure either style depending on deployment platform.
 * This function accepts both to reduce config-related runtime failures.
 *
 * Return shape intentionally matches Alchemy constructor settings.
 */
function resolveAlchemySettings(chainId: number) {
  // Preferred key-based env vars.
  const rawApiKey =
    process.env.ALCHEMY_API_KEY ?? process.env.NEXT_PUBLIC_ALCHEMY_API_KEY;
  // Preferred URL-based env vars.
  const explicitUrl =
    process.env.ALCHEMY_API_URL ?? process.env.NEXT_PUBLIC_ALCHEMY_API_URL;

  // SDK fetch settings: keeps request setup deterministic in this runtime.
  // Some deployments can throw URL/fetch setup edge errors without this override.
  const baseSettings = {
    // Skip SDK fetch monkey-patching behavior and use native fetch directly.
    connectionInfoOverrides: {
      skipFetchSetup: true,
    },
  };

  // URL mode: explicit URL env has highest precedence.
  if (explicitUrl && /^https?:\/\//i.test(explicitUrl.trim())) {
    return { ...baseSettings, url: explicitUrl.trim() };
  }

  // URL mode fallback: if someone accidentally put a full URL in API key env.
  if (rawApiKey && /^https?:\/\//i.test(rawApiKey.trim())) {
    return { ...baseSettings, url: rawApiKey.trim() };
  }

  // Key mode fallback: use API key plus selected network (or demo key in dev).
  return {
    ...baseSettings,
    apiKey: rawApiKey?.trim() || "demo",
    network: toNetwork(chainId),
  };
}

/**
 * Normalize a potentially undefined address into lowercase for safe comparisons.
 *
 * Returning empty string for nullish values avoids repeated null checks in
 * matching code and keeps map keys stable.
 */
function normalizeAddress(value: string | null | undefined): string {
  // Normalize nullish values to empty string and lowercase everything for stable comparisons.
  return value?.toLowerCase() ?? "";
}

/**
 * Convert an Alchemy transfer into a numeric amount.
 *
 * Primary path: use `transfer.value` when Alchemy already normalized it.
 * Fallback path: decode raw on-chain amount and apply token decimals.
 *
 * Note: this returns Number for simplicity in scoring/UI; extremely large raw
 * values may lose precision, which is acceptable for this eligibility heuristic.
 */
function transferAmount(transfer: AssetTransfersWithMetadataResult): number {
  // Alchemy may already return a normalized numeric value.
  if (typeof transfer.value === "number" && Number.isFinite(transfer.value)) {
    return transfer.value;
  }

  // Fallback to the raw on-chain amount when normalized value is unavailable.
  const rawValue = transfer.rawContract.value;
  // If there is still no value, treat transfer amount as zero.
  if (!rawValue) return 0;

  try {
    // Fallback path: decode raw token amount and apply token decimals.
    // Convert raw hex/decimal string into bigint first to preserve precision.
    const raw = BigInt(rawValue);
    // Decimals are returned as hex in this response shape.
    const decimalsHex = transfer.rawContract.decimal;
    // Parse decimals and default to 0 if unavailable.
    const decimals = decimalsHex ? Number.parseInt(decimalsHex, 16) : 0;
    // Reject malformed decimal values.
    if (!Number.isFinite(decimals) || decimals < 0) return 0;

    // Cap exponent at 18 to avoid floating-point overflow in conversion.
    const denom = Math.pow(10, Math.min(decimals, 18));
    // Convert bigint-like integer amount into decimal human-readable number.
    return Number(raw) / denom;
  } catch {
    // Any parsing failure degrades safely to zero.
    return 0;
  }
}

/**
 * Build a stable asset identifier for grouping and loop detection.
 *
 * Priority:
 * 1) token contract address (best uniqueness)
 * 2) symbol/native asset fallback
 */
function getAssetKey(transfer: AssetTransfersWithMetadataResult): string {
  // Prefer contract address for deterministic grouping across symbols.
  if (transfer.rawContract.address) {
    return transfer.rawContract.address.toLowerCase();
  }
  // Fallback to symbol for native transfers without contract address.
  return transfer.asset?.toUpperCase() ?? "UNKNOWN";
}

/**
 * Fetch inbound or outbound transfers within the configured lookback window.
 *
 * Notes:
 * - Uses bounded pagination for predictable latency.
 * - Requests newest-first pages so early pages are most relevant.
 * - Stops early when page timestamps are already older than cutoff.
 *
 * This function currently applies a USDC contract filter below.
 */
async function fetchTransfers(
  alchemy: Alchemy,
  address: string,
  direction: "in" | "out",
  cutoffMs: number,
) {
  // Fetch recent pages only; we stop early once results are older than our lookback.
  // Collect all pages into one array before final cutoff filtering.
  const transfers: AssetTransfersWithMetadataResult[] = [];
  // Cursor returned by Alchemy for next page.
  let pageKey: string | undefined;
  // Define USDC addresses by chain so we can isolate stablecoin income-like flow.
  // These values are expected to come from env vars and should be set per env.
  const USDC_ADDRESSES = {
    8453: [process.env.USDC_BASE_MAINNET as string], // Base Mainnet
    84532: [process.env.USDC_BASE_SEPOLIA as string], // Base Sepolia
  };

  // Iterate through bounded pages to prevent unbounded API scans.
  for (let i = 0; i < MAX_PAGES; i++) {
    // Query either inbound or outbound transfers depending on direction.
    const page = await alchemy.core.getAssetTransfers({
      // For outbound mode, the wallet is the sender.
      fromAddress: direction === "out" ? address : undefined,
      // For inbound mode, the wallet is the recipient.
      toAddress: direction === "in" ? address : undefined,
      // Contract filter: currently pinned to Base Sepolia mapping for this setup.
      // If you support multiple chains dynamically, switch this to use chainId.
      contractAddresses: USDC_ADDRESSES[84532 as keyof typeof USDC_ADDRESSES],
      // Include native/external/internal and ERC20 flows relevant to income.
      category: [AssetTransfersCategory.EXTERNAL, AssetTransfersCategory.ERC20],
      // Newest first so early pages are most relevant.
      order: SortingOrder.DESCENDING,
      // Need block timestamp metadata for month bucketing and time windows.
      withMetadata: true,
      // Ignore zero-value noise.
      excludeZeroValue: true,
      // Apply configured page size limit.
      maxCount: PAGE_SIZE,
      // Continue from previous cursor when present.
      pageKey,
    });

    logEligibility(`alchemy page fetched (${direction})`, {
      page: i + 1,
      pageTransfers: page.transfers.length,
      hasNextPage: Boolean(page.pageKey),
    });

    // Merge this page into aggregated result list.
    transfers.push(...page.transfers);
    // Update cursor for potential next request.
    pageKey = page.pageKey;

    // Stop if there are no more pages or this page was empty.
    if (!pageKey || page.transfers.length === 0) {
      break;
    }

    // Estimate oldest transfer on this page to decide if we can stop early.
    const oldestTimestamp = Math.min(
      ...page.transfers.map((item) => Date.parse(item.metadata.blockTimestamp)),
    );

    // If page already goes past cutoff, remaining pages will be even older.
    if (Number.isFinite(oldestTimestamp) && oldestTimestamp < cutoffMs) {
      break;
    }
  }

  // Final defensive filter keeps only transfers inside lookback window.
  const filteredTransfers = transfers.filter((item) => {
    // Parse block timestamp into epoch milliseconds.
    const timestampMs = Date.parse(item.metadata.blockTimestamp);
    // Keep valid timestamps that are not older than cutoff.
    return Number.isFinite(timestampMs) && timestampMs >= cutoffMs;
  });

  logEligibility(`transfers filtered (${direction})`, {
    wallet: address,
    totalFetched: transfers.length,
    totalAfterCutoff: filteredTransfers.length,
  });

  return filteredTransfers;
}

/**
 * Convert raw Alchemy transfers into a strict internal shape.
 *
 * Filters out events that should not affect income scoring:
 * - self-transfers
 * - missing counterparty
 * - zero/invalid amounts
 * - invalid timestamps
 *
 * Output records are ready for month aggregation and loop matching.
 */
function toParsedTransfers(
  transfers: AssetTransfersWithMetadataResult[],
  side: "in" | "out",
  walletAddress: string,
): ParsedTransfer[] {
  // Normalize wallet once for repeated equality checks.
  const wallet = walletAddress.toLowerCase();

  return (
    transfers
      .map((item): ParsedTransfer | null => {
        // Convert block timestamp string into numeric epoch for sorting/comparisons.
        const timestampMs = Date.parse(item.metadata.blockTimestamp);
        // Compute normalized transfer amount.
        const amount = transferAmount(item);
        // Counterparty is sender for inbound and recipient for outbound.
        const counterparty =
          side === "in"
            ? normalizeAddress(item.from)
            : normalizeAddress(item.to ?? "");
        // Normalize endpoints for self-transfer checks.
        const from = normalizeAddress(item.from);
        const to = normalizeAddress(item.to ?? "");
        // Self-transfer means wallet sent to itself and should not count as income.
        const isSelfTransfer = from === wallet && to === wallet;

        // Ignore noisy or non-actionable events before scoring.
        if (
          isSelfTransfer ||
          !counterparty ||
          amount <= 0 ||
          !Number.isFinite(timestampMs)
        ) {
          return null;
        }

        // Build stable month key like 2026-04 for monthly aggregation.
        const monthKey = new Date(timestampMs).toISOString().slice(0, 7);

        // Return normalized transfer record used by downstream heuristics.
        return {
          hash: item.hash,
          counterparty,
          assetKey: getAssetKey(item),
          amount,
          timestampMs,
          monthKey,
          suspicious: false,
        };
      })
      // Remove filtered records while preserving parsed transfer typing.
      .filter((item): item is ParsedTransfer => item !== null)
  );
}

function markSuspiciousLoops(
  inbound: ParsedTransfer[],
  outbound: ParsedTransfer[],
) {
  // Match inbound transfers against prior outbound transfers to find bounce-back patterns.
  // A transfer is considered suspicious when it has:
  // - same counterparty
  // - same asset bucket
  // - similar amount (within tolerance)
  // - return time inside LOOP_WINDOW_MS

  // Group outbound transfers by counterparty + asset for efficient matching.
  const outboundByCounterpartyAndAsset = new Map<string, ParsedTransfer[]>();
  // Track outbound hashes already matched to avoid double counting.
  const consumedOutbound = new Set<string>();

  // Index each outbound transfer into its matching bucket.
  /**
   * Flag suspicious loop patterns in inbound transfers.
   *
   * A transfer is marked suspicious when there is a prior outbound transfer with:
   * - same counterparty
   * - same asset bucket
   * - similar amount (within tolerance)
   * - return time inside LOOP_WINDOW_MS
   *
   * Each outbound transfer can only match once to avoid over-flagging.
   */
  for (const tx of outbound) {
    // Composite key keeps matching strict by both address and asset.
    const key = `${tx.counterparty}|${tx.assetKey}`;
    // Lazily create bucket if it does not exist yet.
    if (!outboundByCounterpartyAndAsset.has(key)) {
      outboundByCounterpartyAndAsset.set(key, []);
    }
    // Append transfer to bucket.
    outboundByCounterpartyAndAsset.get(key)?.push(tx);
  }

  // Sort each bucket chronologically so we can match nearest valid prior outbound.
  for (const list of outboundByCounterpartyAndAsset.values()) {
    list.sort((a, b) => a.timestampMs - b.timestampMs);
  }

  // Sort inbound records so matching follows timeline order.
  const inboundSorted = [...inbound].sort(
    (a, b) => a.timestampMs - b.timestampMs,
  );

  // Evaluate each inbound transfer against candidate outbound records.
  for (const incoming of inboundSorted) {
    // Reuse same composite key used for outbound indexing.
    const key = `${incoming.counterparty}|${incoming.assetKey}`;
    // Pull candidate outbound transfers from same counterparty and asset.
    const candidates = outboundByCounterpartyAndAsset.get(key);
    // Skip if there is no possible loop pair.
    if (!candidates || candidates.length === 0) continue;

    // Search for a prior outbound that looks like a round-trip pair.
    for (const sent of candidates) {
      // Skip outbound already used by another inbound match.
      if (consumedOutbound.has(sent.hash)) continue;
      // Outbound must happen before inbound to form a bounce-back.
      if (sent.timestampMs > incoming.timestampMs) continue;

      // Only treat close-in-time round trips as suspicious loop behavior.
      const age = incoming.timestampMs - sent.timestampMs;
      if (age > LOOP_WINDOW_MS) continue;

      // Similar amounts suggest bounce-back funding instead of external income.
      const delta = Math.abs(incoming.amount - sent.amount);
      const ratio = delta / Math.max(sent.amount, 1e-12);
      if (ratio <= LOOP_AMOUNT_TOLERANCE) {
        // Mark inbound as suspicious so it is discounted from adjusted income.
        incoming.suspicious = true;
        logEligibility("suspicious loop match", {
          inboundHash: incoming.hash,
          outboundHash: sent.hash,
          counterparty: incoming.counterparty,
          assetKey: incoming.assetKey,
          inboundAmount: incoming.amount,
          outboundAmount: sent.amount,
          ageMs: age,
          amountDeltaRatio: Number(ratio.toFixed(6)),
        });
        // Mark outbound as consumed to avoid reusing the same pair.
        consumedOutbound.add(sent.hash);
        // Stop at first valid match.
        break;
      }
    }
  }
}

/**
 * Aggregate monthly inflow metrics and produce eligibility decision.
 *
 * Eligibility rule:
 * - At least MIN_ACTIVE_MONTHS with positive adjusted inflow, and
 * - loopRiskRatio <= MAX_ALLOWED_LOOP_RATIO.
 *
 * adjusted inflow = total inflow - suspicious loop inflow
 *
 * The scoring model is intentionally interpretable:
 * - monthly totals show gross income-like flow
 * - suspicious component shows likely self-inflated flow
 * - adjusted totals are what eligibility is based on
 */
function buildAnalysis(
  address: string,
  chainId: number,
  inbound: ParsedTransfer[],
): EligibilityAnalysis {
  // Bucket inflows by month so the frontend can display month-level income trends.
  const monthlyMap = new Map<
    string,
    {
      totalInflow: number;
      suspiciousLoopInflow: number;
      byAsset: Record<string, number>;
    }
  >();

  // Running totals used for final risk and eligibility decision.
  let totalInflow = 0;
  let suspiciousInflow = 0;
  let flaggedLoopTransferCount = 0;

  // Aggregate each inbound transfer into global and monthly counters.
  for (const tx of inbound) {
    // Add to all-in flow regardless of suspicious status.
    totalInflow += tx.amount;
    // Create month bucket lazily when first transfer for that month appears.
    if (!monthlyMap.has(tx.monthKey)) {
      monthlyMap.set(tx.monthKey, {
        totalInflow: 0,
        suspiciousLoopInflow: 0,
        byAsset: {},
      });
    }

    // Month bucket must exist due to lazy initialization above.
    const month = monthlyMap.get(tx.monthKey)!;
    // Count raw inflow for the month.
    month.totalInflow += tx.amount;

    // Suspicious transfers are tracked separately and discounted later.
    if (tx.suspicious) {
      // Track suspicious contribution inside this month.
      month.suspiciousLoopInflow += tx.amount;
      // Track suspicious contribution globally.
      suspiciousInflow += tx.amount;
      // Increment number of flagged transfers for transparency.
      flaggedLoopTransferCount += 1;
    } else {
      // Non-suspicious transfers contribute to clean asset-level breakdown.
      month.byAsset[tx.assetKey] =
        (month.byAsset[tx.assetKey] ?? 0) + tx.amount;
    }
  }

  // Convert month map into sorted array and compute adjusted inflow per month.
  const monthlyIncome = [...monthlyMap.entries()]
    // Ensure chronological month order (YYYY-MM lexicographically sorts by date).
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([month, data]) => {
      // Adjusted inflow subtracts suspicious loop-like returns.
      const adjustedInflow = Math.max(
        data.totalInflow - data.suspiciousLoopInflow,
        0,
      );
      return {
        // Month identifier.
        month,
        // Rounded values keep response compact and UI-friendly.
        totalInflow: Number(data.totalInflow.toFixed(6)),
        suspiciousLoopInflow: Number(data.suspiciousLoopInflow.toFixed(6)),
        adjustedInflow: Number(adjustedInflow.toFixed(6)),
        // Clean per-asset inflow map.
        byAsset: data.byAsset,
      };
    });

  // Build a fixed six-month window so empty months count as zero in the average.
  const recentMonthKeys = getRecentMonthKeys(new Date(), BORROW_WINDOW_MONTHS);
  const recentMonthIncome = recentMonthKeys.map((month) => {
    const monthData = monthlyMap.get(month);
    return {
      month,
      totalInflow: monthData?.totalInflow ?? 0,
      suspiciousLoopInflow: monthData?.suspiciousLoopInflow ?? 0,
      adjustedInflow: Math.max(
        (monthData?.totalInflow ?? 0) - (monthData?.suspiciousLoopInflow ?? 0),
        0,
      ),
      byAsset: monthData?.byAsset ?? {},
    };
  });

  // Use adjusted income so looped self-funding does not inflate the borrow limit.
  const totalAdjustedIncome = recentMonthIncome.reduce(
    (sum, month) => sum + month.adjustedInflow,
    0,
  );
  const averageMonthlyIncome = totalAdjustedIncome / BORROW_WINDOW_MONTHS;

  // Count months with positive adjusted inflow to detect recurrence.
  const activeMonths = monthlyIncome.filter((m) => m.adjustedInflow > 0).length;
  // Compute suspicious-to-total inflow ratio; zero when there is no inflow.
  const loopRiskRatio = totalInflow > 0 ? suspiciousInflow / totalInflow : 0;
  // A wallet is eligible only when it shows recurring non-loop inflow and low loop risk.
  const eligible =
    activeMonths >= MIN_ACTIVE_MONTHS &&
    loopRiskRatio <= MAX_ALLOWED_LOOP_RATIO;

  // Borrow amount is the six-month average adjusted monthly income when eligible.
  const borrowAmount = eligible ? Number(averageMonthlyIncome.toFixed(2)) : 0;

  // Return normalized analysis object consumed by frontend.
  return {
    address,
    chainId,
    eligible,
    reason: eligible
      ? "Wallet shows consistent non-loop income flow."
      : "Wallet has insufficient consistent inflow or suspicious looped transfers.",
    lookbackDays: LOOKBACK_DAYS,
    borrowAmount,
    averageMonthlyIncome: Number(averageMonthlyIncome.toFixed(6)),
    monthsConsidered: BORROW_WINDOW_MONTHS,
    flaggedLoopTransferCount,
    loopRiskRatio: Number(loopRiskRatio.toFixed(4)),
    monthlyIncome,
  };
}

/**
 * POST /api/eligibility
 *
 * Request body:
 * - address: wallet address to evaluate
 * - chainId: chain used to select Alchemy network settings
 *
 * Response:
 * - ok: true + analysis payload on success
 * - ok: false + error message on validation/runtime failure
 *
 * Logging behavior:
 * - Detailed runtime errors are logged on the server only.
 * - Client receives a generic error message to avoid leaking internals.
 */
export async function POST(request: Request) {
  try {
    // Request is intentionally small: wallet address + current chain id.
    const body = (await request.json()) as {
      address?: string;
      chainId?: number;
    };
    // Trim input address for basic whitespace safety.
    const address = body.address?.trim();
    // Coerce chain id to number for validation and switch logic.
    const chainId = Number(body.chainId);

    // Reject missing or invalid wallet addresses early.
    if (!address || !isAddress(address)) {
      return NextResponse.json<EligibilityResponse>(
        { ok: false, error: "A valid wallet address is required." },
        { status: 400 },
      );
    }

    // Reject non-numeric chain ids.
    if (!Number.isFinite(chainId)) {
      return NextResponse.json<EligibilityResponse>(
        { ok: false, error: "A valid chainId is required." },
        { status: 400 },
      );
    }

    logEligibility("eligibility request received", {
      address,
      chainId,
      lookbackDays: LOOKBACK_DAYS,
    });

    // Build Alchemy client from either API key envs or URL envs.
    const alchemySettings = resolveAlchemySettings(chainId);
    logEligibility("alchemy settings resolved", {
      mode: "url" in alchemySettings ? "url" : "apiKey",
      network:
        "network" in alchemySettings ? alchemySettings.network : "custom-url",
    });
    const alchemy = new Alchemy(alchemySettings);

    // Convert lookback days into millisecond cutoff timestamp.
    const cutoffMs = Date.now() - LOOKBACK_DAYS * 24 * 60 * 60 * 1000;
    // Pull both directions so we can detect round-trip loops before scoring income.
    const [rawInbound, rawOutbound] = await Promise.all([
      fetchTransfers(alchemy, address, "in", cutoffMs),
      fetchTransfers(alchemy, address, "out", cutoffMs),
    ]);

    logEligibility("raw transfers used for eligibility", {
      inboundCount: rawInbound.length,
      outboundCount: rawOutbound.length,
      inbound: rawInbound.map(toTransferLogView),
      outbound: rawOutbound.map(toTransferLogView),
    });

    // Normalize raw Alchemy transfer data into scoring-friendly shape.
    const inbound = toParsedTransfers(rawInbound, "in", address);
    const outbound = toParsedTransfers(rawOutbound, "out", address);

    logEligibility("parsed transfers", {
      inboundParsedCount: inbound.length,
      outboundParsedCount: outbound.length,
      inboundParsed: inbound.map(toParsedTransferLogView),
      outboundParsed: outbound.map(toParsedTransferLogView),
    });

    // Flag suspicious bounce-back flows before computing metrics.
    markSuspiciousLoops(inbound, outbound);

    logEligibility("post loop-detection inbound state", {
      suspiciousInboundCount: inbound.filter((tx) => tx.suspicious).length,
      inboundAfterLoopDetection: inbound.map(toParsedTransferLogView),
    });

    // Build final eligibility analysis payload with monthly and risk metrics.
    const analysis = buildAnalysis(address, chainId, inbound);

    logEligibility("final eligibility analysis", analysis);

    // Return success response with analysis result.
    return NextResponse.json<EligibilityResponse>({
      ok: true,
      analysis,
    });
  } catch (error) {
    // Keep detailed error only in server logs for debugging.
    console.error("Eligibility route error:", error);
    // Hide internal details and return generic server failure message.
    return NextResponse.json<EligibilityResponse>(
      {
        ok: false,
        error: "Unable to evaluate wallet eligibility right now.",
      },
      { status: 500 },
    );
  }
}
