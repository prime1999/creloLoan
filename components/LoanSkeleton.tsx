"use client";

export const LoanSkeleton = () => (
  <div className="relative overflow-hidden rounded-3xl border border-white/10 bg-gradient-to-br from-zinc-950 via-zinc-950 to-zinc-900/80 p-[1px] animate-pulse">
    <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_right,rgba(245,158,11,0.12),transparent_36%),radial-gradient(circle_at_bottom_left,rgba(59,130,246,0.08),transparent_32%)] opacity-70" />
    <div className="relative rounded-[23px] border border-white/5 bg-zinc-950/95 p-5 sm:p-6">
      <div className="flex flex-wrap items-start justify-between gap-4 mb-5">
        <div className="space-y-3">
          <div className="h-6 w-28 rounded-full bg-zinc-800/80" />
          <div>
            <div className="mb-2 h-3 w-24 rounded bg-zinc-800/70" />
            <div className="flex items-center gap-3">
              <div className="h-11 w-11 rounded-2xl bg-zinc-800/70" />
              <div className="space-y-2">
                <div className="h-6 w-36 rounded bg-zinc-800/80" />
                <div className="h-3 w-48 rounded bg-zinc-800/60" />
              </div>
            </div>
          </div>
        </div>
        <div className="h-8 w-28 rounded-full border border-zinc-800 bg-zinc-900/80" />
      </div>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        <div className="rounded-2xl border border-white/6 bg-white/[0.03] p-4">
          <div className="mb-3 h-3 w-20 rounded bg-zinc-800/70" />
          <div className="h-8 w-28 rounded bg-zinc-800/80" />
          <div className="mt-3 h-3 w-32 rounded bg-zinc-800/60" />
        </div>
        <div className="rounded-2xl border border-white/6 bg-white/[0.03] p-4">
          <div className="mb-3 h-3 w-28 rounded bg-zinc-800/70" />
          <div className="h-8 w-28 rounded bg-zinc-800/80" />
          <div className="mt-3 h-2 w-full rounded-full bg-zinc-800/80" />
        </div>
        <div className="rounded-2xl border border-white/6 bg-white/[0.03] p-4 sm:col-span-2 xl:col-span-1">
          <div className="mb-3 h-3 w-20 rounded bg-zinc-800/70" />
          <div className="h-5 w-40 rounded bg-zinc-800/80" />
          <div className="mt-4 h-12 rounded-2xl border border-dashed border-zinc-800 bg-zinc-900/70" />
        </div>
      </div>

      <div className="mt-4 flex items-center justify-end gap-3">
        <div className="h-9 w-28 rounded-3xl border border-zinc-800 bg-zinc-900/80" />
      </div>
    </div>
  </div>
);

export const LoansSkeletonGroup = ({ count = 3 }: { count?: number }) => (
  <div className="grid gap-4">
    {Array.from({ length: count }).map((_, i) => (
      <LoanSkeleton key={i} />
    ))}
  </div>
);
