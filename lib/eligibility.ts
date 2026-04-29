// Month-level inflow snapshot used in eligibility scoring and UI summaries.
export type MonthlyIncomeBreakdown = {
  month: string;
  totalInflow: number;
  suspiciousLoopInflow: number;
  adjustedInflow: number;
  byAsset: Record<string, number>;
};

// Full analysis payload returned from the eligibility API.
export type EligibilityAnalysis = {
  address: string;
  chainId: number;
  eligible: boolean;
  reason: string;
  lookbackDays: number;
  borrowAmount: number;
  averageMonthlyIncome: number;
  monthsConsidered: number;
  flaggedLoopTransferCount: number;
  loopRiskRatio: number;
  monthlyIncome: MonthlyIncomeBreakdown[];
};

// API contract for success/failure response handling on the client.
export type EligibilityResponse = {
  ok: boolean;
  analysis?: EligibilityAnalysis;
  error?: string;
};
