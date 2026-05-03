"use client";

import { useState } from "react";
// Icon components used in the navbar UI
import { Bell, CheckCircle } from "lucide-react";
// wagmi imports: wallet helpers and types
import type { Connector } from "wagmi";
import {
  // Provides the connected account and connection status
  useAccount,
  // Returns the currently selected chain id
  useChainId,
  // Connect helpers: list of connectors and connect action
  useConnect,
  // Disconnect helpers
  useDisconnect,
  // Typed-data signing helper (EIP-712)
  useSignTypedData,
} from "wagmi";
// Chain metadata for Base Sepolia used when attempting network switch/add
import { baseSepolia } from "wagmi/chains";
// Utility to wait for a transaction receipt after submitting a tx
import { waitForTransactionReceipt } from "wagmi/actions";
// shadcn-imports
import {
  Popover,
  PopoverContent,
  PopoverDescription,
  PopoverHeader,
  PopoverTitle,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Calendar } from "@/components/ui/calendar";
import {
  createBorrowIntentData,
  createBorrowPermitData,
  isBorrowAmountValid,
  validateBorrowAmount,
  splitSignature,
  type BorrowIntentSignature,
  type BorrowPermitData,
  type BorrowPermitSignature,
  USDC_CONTRACT_ADDRESS,
  USDC_PERMIT_DOMAIN,
} from "@/lib/actions/borrowAction";
import { borrowFromContract } from "@/lib/actions/ContractAction";
import { config } from "@/config";
import type {
  EligibilityAnalysis,
  EligibilityResponse,
} from "@/lib/eligibility";
import { CONTRACT_ABI, CONTRACT_ADDRESS } from "@/constants";
import { parseEventLogs } from "viem";

const Navbar = () => {
  // UI state for wallet popover and eligibility check status.
  // Controls whether the wallet popover is visible.
  const [isWalletPopoverOpen, setIsWalletPopoverOpen] = useState(false);
  // Controls whether to show connector picker or connected-wallet actions.
  const [showConnectorPicker, setShowConnectorPicker] = useState(false);
  // Shows loading state while eligibility API call is in-flight.
  const [isCheckingEligibility, setIsCheckingEligibility] = useState(false);
  // Stores any user-facing error from the eligibility request.
  const [eligibilityError, setEligibilityError] = useState<string | null>(null);
  // Stores latest eligibility response from server.
  const [eligibilityResult, setEligibilityResult] =
    useState<EligibilityAnalysis | null>(null);

  // --- Borrow UI state --------------------------------------------------
  // Track whether the borrow modal is visible.
  const [isBorrowDialogOpen, setIsBorrowDialogOpen] = useState(false);
  // Controlled input value for the borrow amount (human units, e.g. 12.50).
  const [borrowAmountInput, setBorrowAmountInput] = useState("");
  // Stores validation error for the borrow amount input (if any).
  const [borrowAmountError, setBorrowAmountError] = useState<string | null>(
    null,
  );
  // Optional repayment date chosen by user; time will be set to borrow-time clock.
  const [selectedRepayDate, setSelectedRepayDate] = useState<Date | undefined>(
    undefined,
  );
  const [repayDateError, setRepayDateError] = useState<string | null>(null);

  // --- Signing state ---------------------------------------------------
  // Tracks the borrow intent signing flow.
  const [isSigning, setIsSigning] = useState(false);
  // Generic UI-visible error string for any signing or flow issues.
  const [signError, setSignError] = useState<string | null>(null);
  // Stores the signed borrow intent payload returned after `signMessage`.
  const [signedIntent, setSignedIntent] =
    useState<BorrowIntentSignature | null>(null);

  // Dialog step state controls the modal sub-views (amount -> sign -> permit -> confirmation).
  const [dialogStep, setDialogStep] = useState<
    | "amount"
    | "signing"
    | "confirmation"
    | "permit"
    | "permit-signing"
    | "permit-confirmation"
  >("amount");

  // Mobile menu state for small screens
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  // ERC-2612 permit signing state.
  // Holds the structured permit data used to build the EIP-712 typed-data message.
  const [permitData, setPermitData] = useState<BorrowPermitData | null>(null);
  // Parsed v,r,s permit signature pieces for submitting to the contract.
  const [permitSignature, setPermitSignature] =
    useState<BorrowPermitSignature | null>(null);
  // UI flag shown while the wallet prompts the user to sign the typed-data permit.
  const [isSigningPermit, setIsSigningPermit] = useState(false);
  // Stores the resulting borrow transaction hash returned after submitting to the contract.
  const [borrowTxHash, setBorrowTxHash] = useState<`0x${string}` | null>(null);

  const getMaxRepayDate = () => {
    const max = new Date();
    max.setDate(max.getDate() + 7);
    return max;
  };

  const isRepayDateWithinWindow = (date: Date) => {
    const now = new Date();
    const max = getMaxRepayDate();
    return date >= now && date <= max;
  };
  // Wagmi hooks provide current wallet session and connector actions.
  // Current connected wallet address and connection boolean.
  const { address, isConnected } = useAccount();
  // Active chain id used to route backend analysis to matching network.
  const chainId = useChainId();
  // Connector operations and loading state for wallet connection.
  const { connectAsync, connectors, isPending } = useConnect();
  // Disconnect operations and loading state for wallet disconnection.
  const {
    disconnect,
    disconnectAsync,
    isPending: isDisconnecting,
  } = useDisconnect();
  // Signing hook for ERC-2612 permit (EIP-712 typed data).
  const { signTypedDataAsync } = useSignTypedData();

  // Compact wallet label for the navbar button.
  const shortAddress = address
    ? `${address.slice(0, 6)}...${address.slice(-4)}`
    : "Connect Wallet";

  /**
   * Attempt to connect using the selected wallet connector.
   * - prevents overlapping wallet actions
   * - disconnects an existing session first for a clean switch
   */
  const handleConnectorSelect = async (connector: Connector) => {
    // Prevent overlapping connect/disconnect actions.
    if (isPending || isDisconnecting) return;
    // Connection flow can be rejected by the user, so keep it in try/catch.
    try {
      // If a wallet is already connected, disconnect first to avoid mixed state.
      if (isConnected) {
        // Await disconnect completion before starting next connection.
        await disconnectAsync();
      }
      // Before connecting, if an injected provider exists, check its chain
      // and attempt to switch/add Base Sepolia so the user connects on the
      // expected network.
      try {
        // Use any injected provider (MetaMask, Brave, etc.) if available
        const injected = (window as any)?.ethereum;
        if (injected) {
          // Ask the provider for its currently selected chain id (hex string)
          const hexCurrent = await injected.request({ method: "eth_chainId" });
          // Convert the hex chain id into a numeric id for comparison
          const currentId =
            typeof hexCurrent === "string"
              ? parseInt(hexCurrent, 16)
              : undefined;
          // If the wallet is not already on Base Sepolia, attempt to switch it
          if (currentId !== baseSepolia.id) {
            // Prepare the hex chain id value required by wallet RPC methods
            const hexChainId = `0x${baseSepolia.id.toString(16)}`;
            try {
              // Request the wallet to switch to Base Sepolia
              await injected.request({
                method: "wallet_switchEthereumChain",
                params: [{ chainId: hexChainId }],
              });
            } catch (switchErr: any) {
              // If the chain is not known to the wallet, providers commonly use code 4902
              const isUnknownChain =
                switchErr?.code === 4902 ||
                /Unrecognized chain/i.test(switchErr?.message ?? "");
              if (isUnknownChain) {
                // Derive a reasonable RPC URL from the chain definition (best-effort)
                const rpcUrl = ((baseSepolia as any).rpcUrls?.default
                  ?.http?.[0] ??
                  (baseSepolia as any).rpcUrls?.[0] ??
                  "") as string;
                // Ask the wallet to add Base Sepolia to the user's networks
                await injected.request({
                  method: "wallet_addEthereumChain",
                  params: [
                    {
                      chainId: hexChainId,
                      chainName: baseSepolia.name ?? "Base Sepolia",
                      nativeCurrency: baseSepolia.nativeCurrency ?? {
                        name: "ETH",
                        symbol: "ETH",
                        decimals: 18,
                      },
                      rpcUrls: rpcUrl ? [rpcUrl] : [],
                    },
                  ],
                });
                // After adding the chain, request a switch again
                await injected.request({
                  method: "wallet_switchEthereumChain",
                  params: [{ chainId: hexChainId }],
                });
              } else {
                // Re-throw unexpected errors so outer catch can handle/log them
                throw switchErr;
              }
            }
          }
        }
      } catch (err) {
        console.error("Failed to switch/add Base Sepolia pre-connect:", err);
        // Continue to connect anyway; wallets may still prompt to switch.
      }

      // Connect using selected connector.
      await connectAsync({ connector });
      // Reset UI to collapsed state after success.
      setShowConnectorPicker(false);
      setIsWalletPopoverOpen(false);
    } catch {
      // User may reject wallet connection.
    }
  };
  /**
   * Disconnect the current wallet and reset the popover UI.
   * Safe to call repeatedly; guards against concurrent disconnects.
   */
  const handleDisconnectWallet = () => {
    // Do not queue another disconnect while one is pending.
    if (isDisconnecting) return;
    // Disconnect current wallet session.
    disconnect();
    // Reset popover UI after disconnect.
    setIsWalletPopoverOpen(false);
    setShowConnectorPicker(false);
  };
  /**
   * Show connector picker to switch from current wallet.
   * Prevents switching while another wallet action is pending.
   */
  const handleSwitchWallet = () => {
    // Block switch while another wallet action is pending.
    if (isPending || isDisconnecting) return;
    // Open connector picker so user can choose another wallet.
    setShowConnectorPicker(true);
  };

  /**
   * Toggle the wallet popover from the navbar button. When closed,
   * sub-views (like the connector picker) are reset.
   */
  const handleWalletButtonClick = () => {
    // Show connector list when disconnected, else show connected-wallet menu.
    setShowConnectorPicker(!isConnected);
    // Open wallet popover on button click.
    setIsWalletPopoverOpen(true);
  };

  /**
   * Keep nested picker state in sync when the popover opens/closes.
   * Ensures connector picker doesn't remain visible when popover closes.
   */
  const handlePopoverOpenChange = (open: boolean) => {
    // Apply external open state from popover component.
    setIsWalletPopoverOpen(open);
    // When popover closes, also reset connector-picker sub-view.
    if (!open) {
      setShowConnectorPicker(false);
    }
  };

  /**
   * Check backend eligibility for the currently connected wallet.
   * - Requires a connected wallet to run
   * - Shows loading state while request is in-flight
   * - Persists the returned `EligibilityAnalysis` to `eligibilityResult`
   */
  const handleCheckEligibility = async () => {
    // Eligibility checks are tied to an on-chain identity, so require a connected wallet.
    if (!isConnected || !address) {
      // Clear stale success state when precondition fails.
      setEligibilityResult(null);
      // Show actionable guidance in navbar.
      setEligibilityError("Connect a wallet first to check eligibility.");
      return;
    }

    // Enter loading state and clear stale errors.
    setIsCheckingEligibility(true);
    setEligibilityError(null);

    try {
      // Server-side endpoint runs Alchemy analysis and anti-loop heuristics.
      const response = await fetch("/api/eligibility", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          // Send connected wallet for analysis.
          address,
          // Send active chain to select matching Alchemy network.
          chainId,
        }),
      });

      // Parse structured API response.
      const payload = (await response.json()) as EligibilityResponse;
      // Normalize all non-success outcomes into a single user-facing error path.
      if (!response.ok || !payload.ok || !payload.analysis) {
        // Clear old result to avoid showing stale eligibility info.
        setEligibilityResult(null);
        setEligibilityError(payload.error ?? "Could not check eligibility.");
        return;
      }

      // Save fresh analysis result for UI display.
      setEligibilityResult(payload.analysis);
    } catch {
      // Network/parse errors map to generic retry message.
      setEligibilityResult(null);
      setEligibilityError("Could not check eligibility. Please try again.");
    } finally {
      // Always leave loading state when request completes.
      setIsCheckingEligibility(false);
    }
  };

  /**
   * Open the borrow modal and reset any previous borrow flow state.
   * Only allowed when the user has an `eligibilityResult` showing eligibility.
   */
  const handleBorrowDialogOpen = () => {
    if (!eligibilityResult?.eligible) return;
    setBorrowAmountInput("");
    setBorrowAmountError(null);
    setSelectedRepayDate(undefined);
    setRepayDateError(null);
    setDialogStep("amount");
    setSignedIntent(null);
    setSignError(null);
    setBorrowTxHash(null);
    setIsBorrowDialogOpen(true);
  };

  /**
   * Validate and update the borrow amount input.
   * Stores a human-friendly validation message in `borrowAmountError`.
   */
  const handleBorrowAmountChange = (value: string) => {
    const maxBorrowAmount = eligibilityResult?.borrowAmount ?? 0;
    // Update controlled input value
    setBorrowAmountInput(value);
    // Validate at input time and store any message for UI display
    setBorrowAmountError(validateBorrowAmount(value, maxBorrowAmount));
  };

  /**
   * Confirm the borrow intent by asking the user to sign typed data that
   * matches the contract's `signedPermit` modifier. After the intent is
   * signed we prepare the ERC-2612 permit payload and advance the dialog.
   */
  const handleConfirmBorrow = async () => {
    // Guard: require eligibility and connected wallet
    if (!eligibilityResult?.eligible || !address) return;

    const amount = Number(borrowAmountInput);
    const maxBorrowAmount = eligibilityResult.borrowAmount;
    if (!Number.isFinite(amount) || amount <= 0 || amount > maxBorrowAmount) {
      return;
    }

    if (!selectedRepayDate) {
      setRepayDateError("Pick a repayment date first.");
      return;
    }

    const now = new Date();
    const deadlineDate = new Date(selectedRepayDate);
    // Keep the selected day, but enforce the current time-of-day at borrow moment.
    deadlineDate.setHours(
      now.getHours(),
      now.getMinutes(),
      now.getSeconds(),
      now.getMilliseconds(),
    );

    if (!isRepayDateWithinWindow(deadlineDate)) {
      setRepayDateError("Repayment date must be within the next 7 days.");
      return;
    }

    // Move to signing state and clear any previous errors shown in the UI.
    setDialogStep("signing");
    setSignError(null);
    setRepayDateError(null);
    setIsSigning(true);

    try {
      // Build the borrow-intent EIP-712 typed-data structure that the contract
      // will recover and verify on-chain (amount, chainId, deadline, nonce).
      const intentData = createBorrowIntentData(
        amount,
        chainId,
        Math.floor(deadlineDate.getTime() / 1000),
      );

      // Debug: show typed-data structure in dev console (harmless in prod).
      console.log({ intentData });

      // Prompt the user's wallet to sign the typed-data intent. This produces
      // an EIP-712 signature string that the contract can later recover.
      const signature = await signTypedDataAsync({
        domain: intentData.domain,
        types: intentData.types,
        primaryType: "PermitRequest",
        message: intentData.message,
      });

      // Save the signed intent in local UI state so it can be displayed and
      // later attached to the on-chain borrow transaction.
      setSignedIntent({
        address: address as `0x${string}`,
        amount,
        chainId,
        nonce: intentData.nonce,
        deadline: intentData.deadline,
        message: `Borrow intent for USDC ${amount.toFixed(2)} with nonce ${intentData.nonce.toString()} and deadline ${new Date(intentData.deadline * 1000).toISOString()}.`,
        signature,
        timestamp: Math.floor(Date.now() / 1000),
      });

      // Prepare the ERC-2612 permit typed-data payload so the user can sign
      // a permit authorizing the contract to transfer USDC on their behalf.
      setPermitData(
        createBorrowPermitData(
          address as `0x${string}`,
          CONTRACT_ADDRESS as `0x${string}`,
          amount,
        ),
      );
      // Move the dialog to the permit step so the UI asks the user to sign it.
      setDialogStep("permit");
    } catch (error) {
      // User rejected signing or a runtime error occurred.
      setSignError(
        error instanceof Error
          ? error.message
          : "Failed to sign the borrow intent. Please try again.",
      );
      setDialogStep("amount");
    } finally {
      setIsSigning(false);
    }
  };

  const borrowAmountIsValid = isBorrowAmountValid(
    borrowAmountInput,
    borrowAmountError,
    eligibilityResult?.borrowAmount ?? 0,
  );

  /**
   * Request and handle the ERC-2612 permit signature using EIP-712 typed-data.
   * - Prompts the wallet to sign the structured permit payload
   * - Parses the resulting signature into `v`, `r`, `s` and attaches the deadline
   * - Submits the on-chain `borrow` transaction using the signed permit
   */
  const handleSignPermit = async () => {
    if (!permitData || !signedIntent) return;

    setIsSigningPermit(true);
    setSignError(null);
    setDialogStep("permit-signing");

    try {
      // Build and sign the ERC-2612 permit using EIP-712 so the contract can
      // later call `permit`/`transferFrom` for the approved amount.
      const signature = await signTypedDataAsync({
        domain: {
          name: USDC_PERMIT_DOMAIN.name,
          version: USDC_PERMIT_DOMAIN.version,
          chainId: chainId,
          verifyingContract: USDC_CONTRACT_ADDRESS,
        },
        types: {
          Permit: [
            { name: "owner", type: "address" },
            { name: "spender", type: "address" },
            { name: "value", type: "uint256" },
            { name: "nonce", type: "uint256" },
            { name: "deadline", type: "uint256" },
          ],
        },
        primaryType: "Permit",
        message: {
          owner: permitData.owner,
          spender: permitData.spender,
          value: permitData.value,
          nonce: permitData.nonce,
          deadline: BigInt(permitData.deadline),
        },
      });

      // Split the returned signature string into v, r, s so it can be passed to
      // the contract's `borrow` function which expects those fields.
      const parsedPermitSignature = {
        ...splitSignature(signature as `0x${string}`),
        deadline: permitData.deadline,
      };
      setPermitSignature(parsedPermitSignature);

      // With the signed intent and permit ready, call into the contract flow
      // which simulates and then writes the `borrow` transaction.
      const borrowHash = await borrowFromContract({
        borrower: signedIntent.address,
        amount: permitData.value,
        deadline: BigInt(signedIntent.deadline),
        nonce: signedIntent.nonce,
        signature: signedIntent.signature as `0x${string}`,
      });
      setBorrowTxHash(borrowHash);

      // Wait for the transaction to be mined and obtain the receipt.
      const receipt = await waitForTransactionReceipt(config, {
        hash: borrowHash,
      });
      // Parse the logs for the `Borrowed` event emitted by our contract.
      const borrowEvents = parseEventLogs({
        abi: CONTRACT_ABI,
        logs: receipt.logs,
        eventName: "Borrowed",
      });

      // Ensure at least one Borrowed event was found in the receipt logs.
      if (!borrowEvents.length) {
        throw new Error(
          "Borrowed event was not found in the transaction receipt.",
        );
      }

      // Grab the first parsed event and normalize typing for access.
      const borrowEvent = borrowEvents[0] as unknown as {
        args: {
          borrower: `0x${string}`;
          amount: bigint;
          deadline: bigint;
        };
      };
      const eventArgs = borrowEvent.args;

      // Verify the event's borrower matches the address that signed the intent.
      // This protects against mismatched or replayed signatures.
      if (
        eventArgs.borrower.toLowerCase() !== signedIntent.address.toLowerCase()
      ) {
        throw new Error(
          "Borrowed event borrower did not match the signed intent.",
        );
      }

      // Persist the successful borrow in Supabase after the on-chain event is emitted.
      // Persist on-chain-confirmed borrow into our backend. The server will
      // store the borrower, numeric amounts (convert from token base units),
      // on-chain deadline, nonce and both intent & permit signature pieces.
      const syncResponse = await fetch("/api/borrow/sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          user_address: signedIntent.address,
          // eventArgs.amount is in USDC base units (1e6), convert to float
          total_debt: Number(eventArgs.amount) / 1e6,
          remaining_debt: Number(eventArgs.amount) / 1e6,
          // deadline preserved as unix seconds
          deadline: Number(eventArgs.deadline),
          // nonce used on-chain for the signed intent
          nonce: signedIntent.nonce.toString(),
          status: "borrowed",
          // store the original typed-data intent signature (hex)
          borrow_signature: signedIntent.signature,
          // permit signature split components used by contract call
          permit_v: parsedPermitSignature.v,
          permit_r: parsedPermitSignature.r,
          permit_s: parsedPermitSignature.s,
          // mark the record as processed since the event was observed
          is_processed: true,
        }),
      });

      if (!syncResponse.ok) {
        setSignError(
          "Borrow succeeded on-chain, but the Supabase record could not be saved.",
        );
      }

      // Move to final confirmation showing both signatures.
      setDialogStep("permit-confirmation");
    } catch (error) {
      // User rejected permit signing or error occurred
      setSignError(
        error instanceof Error
          ? error.message
          : "Failed to complete the borrow flow. Please try again.",
      );
      setDialogStep("permit");
    } finally {
      setIsSigningPermit(false);
    }
  };

  return (
    <nav className="px-4 sm:px-8 py-4 border-b border-zinc-800 font-poppins">
      <div className="w-11/12 sm:w-10/12 mx-auto flex flex-col sm:flex-row items-center justify-between gap-4 sm:gap-0">
        <div className="w-full flex items-center gap-8 justify-start">
          <div className="flex items-center gap-2">
            <div className="flex flex-col gap-0.5">
              {[...Array(4)].map((_, i) => (
                <div key={i} className="h-1 w-6 bg-gold transform -skew-x-64" />
              ))}
            </div>
            <span className="text-xl font-semibold tracking-loose font-fjalla">
              Creloloan
            </span>
          </div>
          <div className="hidden sm:flex gap-6 text-xs font-medium">
            <a href="#" className="text-zinc-400">
              Earn
            </a>
            {/* <a href="#" className="text-gold">
              Vaults
            </a> */}
            <a href="#" className="text-gold font-semibold">
              Loans
            </a>
          </div>
        </div>

        <div className="flex items-center gap-4">
          <button
            type="button"
            onClick={() => setMobileMenuOpen((v) => !v)}
            className="sm:hidden p-2 rounded-md bg-white/5 text-zinc-200"
            aria-label="Toggle menu"
          >
            <div className="space-y-1">
              <span className="block w-5 h-0.5 bg-zinc-200" />
              <span className="block w-5 h-0.5 bg-zinc-200" />
              <span className="block w-5 h-0.5 bg-zinc-200" />
            </div>
          </button>
          {/* <div className="bg-zinc-950 px-3 py-1.5 rounded-full border border-zinc-800 text-xs font-mono">
            0x7616...7f7e
          </div> */}
          <Popover
            open={isWalletPopoverOpen}
            onOpenChange={handlePopoverOpenChange}
          >
            <PopoverTrigger asChild>
              <button
                type="button"
                onClick={handleWalletButtonClick}
                disabled={isPending || isDisconnecting}
                className="w-36 bg-black/90 hover:bg-black/70 disabled:opacity-60 disabled:cursor-not-allowed cursor-pointer text-white text-xs font-poppins p-2 rounded-md"
              >
                {isConnected
                  ? shortAddress
                  : isPending
                    ? "Connecting..."
                    : "Connect Wallet"}
              </button>
            </PopoverTrigger>
            <PopoverContent className="w-64 bg-black/90 text-white" align="end">
              {showConnectorPicker || !isConnected ? (
                <>
                  <PopoverHeader>
                    <PopoverTitle>Choose Wallet</PopoverTitle>
                    <PopoverDescription className="text-white/70">
                      Select the wallet you want to connect.
                    </PopoverDescription>
                  </PopoverHeader>

                  <div className="mt-2 flex flex-col gap-2">
                    {connectors.map((connector: Connector) => (
                      <button
                        key={connector.uid}
                        type="button"
                        onClick={() => void handleConnectorSelect(connector)}
                        disabled={isPending || isDisconnecting}
                        className="w-full rounded-md bg-white/10 px-3 py-2 text-left text-xs font-poppins hover:bg-white/20 disabled:opacity-60 disabled:cursor-not-allowed"
                      >
                        {connector.name}
                      </button>
                    ))}
                  </div>
                </>
              ) : (
                <>
                  <PopoverHeader>
                    <PopoverTitle>Wallet Connected</PopoverTitle>
                    <PopoverDescription className="text-white/70 break-all">
                      {address}
                    </PopoverDescription>
                  </PopoverHeader>

                  <div className="mt-2 flex flex-col gap-2">
                    <button
                      type="button"
                      onClick={handleSwitchWallet}
                      disabled={isPending || isDisconnecting}
                      className="w-full rounded-md bg-white/10 px-3 py-2 text-left text-xs font-poppins hover:bg-white/20 disabled:opacity-60 disabled:cursor-not-allowed"
                    >
                      Switch Wallet
                    </button>
                    <button
                      type="button"
                      onClick={handleDisconnectWallet}
                      disabled={isDisconnecting}
                      className="w-full rounded-md bg-red-500/20 px-3 py-2 text-left text-xs font-poppins text-red-200 hover:bg-red-500/30 disabled:opacity-60 disabled:cursor-not-allowed"
                    >
                      {isDisconnecting
                        ? "Disconnecting..."
                        : "Disconnect Wallet"}
                    </button>
                  </div>
                </>
              )}
            </PopoverContent>
          </Popover>
          {/* Mobile menu content */}
          {mobileMenuOpen && (
            <div className="sm:hidden mt-3 w-full">
              <div className="flex flex-col gap-3 bg-zinc-950/80 rounded-lg p-3 border border-zinc-800">
                <div className="flex gap-4">
                  <a href="#" className="text-zinc-400 text-sm">
                    Earn
                  </a>
                  <a href="#" className="text-gold font-semibold text-sm">
                    Loans
                  </a>
                </div>
                <div className="flex flex-col gap-2">
                  <button
                    type="button"
                    onClick={handleWalletButtonClick}
                    className="w-full bg-black/90 hover:bg-black/70 disabled:opacity-60 disabled:cursor-not-allowed cursor-pointer text-white text-xs font-poppins p-2 rounded-md"
                  >
                    {isConnected
                      ? shortAddress
                      : isPending
                        ? "Connecting..."
                        : "Connect Wallet"}
                  </button>
                  <button
                    type="button"
                    onClick={() => void handleCheckEligibility()}
                    disabled={isCheckingEligibility}
                    className="w-full rounded-md border border-zinc-700 bg-transparent px-3 py-2 text-xs font-poppins text-zinc-200 hover:bg-zinc-800"
                  >
                    {isCheckingEligibility
                      ? "Checking..."
                      : "Check Eligibility"}
                  </button>
                </div>
              </div>
            </div>
          )}
          <div className="w-72 flex flex-col items-start gap-1.5 text-xs text-zinc-300 font-semibold">
            <button
              type="button"
              onClick={() => void handleCheckEligibility()}
              disabled={isCheckingEligibility}
              className="cursor-pointer disabled:opacity-60 disabled:cursor-not-allowed"
            >
              {isCheckingEligibility ? "Checking..." : "Check Eligibility"}
            </button>
            {eligibilityError && (
              <p className="text-[10px] text-red-300 leading-tight">
                Please try again.
              </p>
            )}
            {eligibilityResult && (
              <div className="text-[10px] leading-tight text-zinc-300">
                {eligibilityResult.eligible ? (
                  <span className="flex gap-1 items-center">
                    <p>Eligible to</p>
                    <span className="text-gold">{`USDC ${eligibilityResult.borrowAmount.toFixed(2)}`}</span>
                    <button
                      type="button"
                      onClick={handleBorrowDialogOpen}
                      className="bg-gold text-black text-[11px] rounded-sm ml-2 px-2 py-1 cursor-pointer duration-500 hover:bg-gold/80 transition-colors"
                    >
                      Borrow
                    </button>
                  </span>
                ) : (
                  "Not Eligible"
                )}
              </div>
            )}
          </div>
          <div className="flex gap-3 text-zinc-400">
            <Bell size={18} />
          </div>
        </div>
      </div>
      <Dialog open={isBorrowDialogOpen} onOpenChange={setIsBorrowDialogOpen}>
        <DialogContent className="bg-zinc-950 text-zinc-100 border border-zinc-800 sm:max-w-md font-poppins">
          {dialogStep === "amount" && (
            <>
              <DialogHeader>
                <DialogTitle className="font-semibold text-sm">
                  How much do you want to borrow?
                </DialogTitle>
                <DialogDescription className="text-zinc-400 text-xs">
                  Enter an amount up to USDC
                  {` ${eligibilityResult?.borrowAmount.toFixed(2) ?? "0.00"}`}.
                </DialogDescription>
              </DialogHeader>

              <div className="space-y-2">
                <label
                  htmlFor="borrow-amount"
                  className="text-xs text-zinc-300"
                >
                  Borrow Amount (USDC)
                </label>
                <input
                  id="borrow-amount"
                  type="number"
                  min="0"
                  step="0.01"
                  value={borrowAmountInput}
                  onChange={(event) =>
                    handleBorrowAmountChange(event.target.value)
                  }
                  placeholder="0.00"
                  className="w-full rounded-md border border-zinc-700 bg-black/60 px-3 py-2 text-sm text-zinc-100 outline-none mt-2 focus:border-gold"
                />
                {borrowAmountError && (
                  <p className="text-[11px] text-red-300">
                    {borrowAmountError}
                  </p>
                )}
              </div>

              <div className="space-y-2">
                <label className="text-xs text-zinc-300">
                  Repayment Date (max 7 days)
                </label>
                <div className="rounded-md border border-zinc-700 bg-black/60 p-2">
                  <Calendar
                    mode="single"
                    selected={selectedRepayDate}
                    onSelect={(date) => {
                      setSelectedRepayDate(date);
                      if (!date) {
                        setRepayDateError("Pick a repayment date first.");
                        return;
                      }

                      const now = new Date();
                      const deadlineDate = new Date(date);
                      deadlineDate.setHours(
                        now.getHours(),
                        now.getMinutes(),
                        now.getSeconds(),
                        now.getMilliseconds(),
                      );

                      if (!isRepayDateWithinWindow(deadlineDate)) {
                        setRepayDateError(
                          "Repayment date must be within the next 7 days.",
                        );
                        return;
                      }

                      setRepayDateError(null);
                    }}
                    disabled={(date) => {
                      const minDate = new Date();
                      minDate.setHours(0, 0, 0, 0);

                      const maxDate = getMaxRepayDate();
                      maxDate.setHours(23, 59, 59, 999);

                      return date < minDate || date > maxDate;
                    }}
                    className="rounded-md"
                  />
                </div>

                {selectedRepayDate && !repayDateError && (
                  <p className="text-[11px] text-zinc-400">
                    Deadline will use this date at your borrow time.
                  </p>
                )}

                {repayDateError && (
                  <p className="text-[11px] text-red-300">{repayDateError}</p>
                )}
              </div>

              <DialogFooter className="bg-zinc-900/60 border-zinc-800">
                <button
                  type="button"
                  onClick={() => setIsBorrowDialogOpen(false)}
                  className="rounded-md border border-zinc-700 bg-transparent px-3 py-2 text-xs text-zinc-200 hover:bg-zinc-800"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={() => void handleConfirmBorrow()}
                  disabled={!borrowAmountIsValid}
                  className="rounded-md bg-gold px-3 py-2 text-xs font-semibold text-black disabled:cursor-not-allowed disabled:opacity-60 hover:bg-gold/90"
                >
                  Sign Intent
                </button>
              </DialogFooter>
            </>
          )}

          {dialogStep === "signing" && (
            <>
              <DialogHeader>
                <DialogTitle className="font-semibold text-sm">
                  Sign Borrow Intent
                </DialogTitle>
                <DialogDescription className="text-zinc-400 text-xs">
                  Sign the borrow intent in your wallet to confirm the
                  agreement.
                </DialogDescription>
              </DialogHeader>

              <div className="space-y-4">
                <div className="flex items-center justify-center py-8">
                  <div className="animate-spin rounded-full h-8 w-8 border border-gold border-t-transparent" />
                </div>
                <p className="text-center text-sm text-zinc-300">
                  Waiting for wallet signature...
                </p>
              </div>

              <DialogFooter className="bg-zinc-900/60 border-zinc-800">
                <button
                  type="button"
                  disabled
                  className="rounded-md border border-zinc-700 bg-transparent px-3 py-2 text-xs text-zinc-200 disabled:opacity-60"
                >
                  Signing...
                </button>
              </DialogFooter>
            </>
          )}

          {dialogStep === "confirmation" && signedIntent && (
            <>
              <DialogHeader>
                <div className="flex items-center gap-2">
                  <CheckCircle size={20} className="text-green-500" />
                  <DialogTitle className="font-semibold text-sm">
                    Intent Signed Successfully
                  </DialogTitle>
                </div>
                <DialogDescription className="text-zinc-400 text-xs">
                  Now sign the USDC permit to authorize borrowing.
                </DialogDescription>
              </DialogHeader>

              <div className="space-y-3 bg-zinc-900/60 rounded-md p-3">
                <div>
                  <p className="text-[11px] text-zinc-500 mb-1">Amount</p>
                  <p className="text-sm font-semibold text-zinc-100">
                    USDC {signedIntent.amount.toFixed(2)}
                  </p>
                </div>
                <div>
                  <p className="text-[11px] text-zinc-500 mb-1">Chain ID</p>
                  <p className="text-sm font-semibold text-zinc-100">
                    {signedIntent.chainId}
                  </p>
                </div>
              </div>

              <DialogFooter className="bg-zinc-900/60 border-zinc-800">
                <button
                  type="button"
                  onClick={() => setDialogStep("permit")}
                  className="rounded-md bg-gold px-3 py-2 text-xs font-semibold text-black hover:bg-gold/90"
                >
                  Next: Sign Permit
                </button>
              </DialogFooter>
            </>
          )}

          {dialogStep === "permit" && permitData && (
            <>
              <DialogHeader>
                <DialogTitle className="font-semibold text-sm">
                  Authorize USDC Permit
                </DialogTitle>
                <DialogDescription className="text-zinc-400 text-xs">
                  Sign the ERC-2612 permit to authorize the borrow. You will not
                  lose funds unless you don't repay by the deadline.
                </DialogDescription>
              </DialogHeader>

              <div className="space-y-3 bg-zinc-900/60 rounded-md p-3">
                <div>
                  <p className="text-[11px] text-zinc-500 mb-1">
                    Permit Amount
                  </p>
                  <p className="text-sm font-semibold text-zinc-100">
                    USDC {(Number(permitData.value) / 1e6).toFixed(2)}
                  </p>
                </div>
                <div>
                  <p className="text-[11px] text-zinc-500 mb-1">Deadline</p>
                  <p className="text-sm font-semibold text-zinc-100">
                    {new Date(permitData.deadline * 1000).toLocaleString()}
                  </p>
                </div>
                <div>
                  <p className="text-[11px] text-zinc-500 mb-1">
                    Spender (Contract)
                  </p>
                  <p className="text-[10px] font-mono text-zinc-400 break-all">
                    {permitData.spender}
                  </p>
                </div>
              </div>

              <DialogFooter className="bg-zinc-900/60 border-zinc-800">
                <button
                  type="button"
                  onClick={() => setDialogStep("confirmation")}
                  className="rounded-md border border-zinc-700 bg-transparent px-3 py-2 text-xs text-zinc-200 hover:bg-zinc-800"
                >
                  Back
                </button>
                <button
                  type="button"
                  onClick={() => void handleSignPermit()}
                  disabled={isSigningPermit}
                  className="rounded-md bg-gold px-3 py-2 text-xs font-semibold text-black hover:bg-gold/90 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {isSigningPermit ? "Signing..." : "Sign Permit"}
                </button>
              </DialogFooter>
            </>
          )}

          {dialogStep === "permit-signing" && (
            <>
              <DialogHeader>
                <DialogTitle className="font-semibold text-sm">
                  Sign USDC Permit
                </DialogTitle>
                <DialogDescription className="text-zinc-400 text-xs">
                  Confirm the permit in your wallet to authorize the borrow.
                </DialogDescription>
              </DialogHeader>

              <div className="space-y-4">
                <div className="flex items-center justify-center py-8">
                  <div className="animate-spin rounded-full h-8 w-8 border border-gold border-t-transparent" />
                </div>
                <p className="text-center text-sm text-zinc-300">
                  Waiting for permit signature...
                </p>
              </div>

              <DialogFooter className="bg-zinc-900/60 border-zinc-800">
                <button
                  type="button"
                  disabled
                  className="rounded-md border border-zinc-700 bg-transparent px-3 py-2 text-xs text-zinc-200 disabled:opacity-60"
                >
                  Signing...
                </button>
              </DialogFooter>
            </>
          )}

          {dialogStep === "permit-confirmation" &&
            signedIntent &&
            permitSignature && (
              <>
                <DialogHeader>
                  <div className="flex items-center gap-2">
                    <CheckCircle size={20} className="text-green-500" />
                    <DialogTitle className="font-semibold text-sm">
                      Borrow Intent Complete
                    </DialogTitle>
                  </div>
                  <DialogDescription className="text-zinc-400 text-xs">
                    Both signatures have been collected. Ready to borrow!
                  </DialogDescription>
                </DialogHeader>

                <div className="space-y-3">
                  <div className="bg-blue-500/20 border border-blue-500/50 rounded-md p-3">
                    <p className="text-[11px] font-semibold text-blue-300 mb-2">
                      Intent Signature ✓
                    </p>
                    <p className="text-[10px] font-mono text-zinc-400 break-all">
                      {signedIntent.signature.slice(0, 40)}...
                    </p>
                  </div>

                  <div className="bg-purple-500/20 border border-purple-500/50 rounded-md p-3">
                    <p className="text-[11px] font-semibold text-purple-300 mb-2">
                      USDC Permit ✓
                    </p>
                    <div className="space-y-1">
                      <p className="text-[10px] font-mono text-zinc-400">
                        <span className="text-zinc-500">v:</span>{" "}
                        {permitSignature.v}
                      </p>
                      <p className="text-[10px] font-mono text-zinc-400 break-all">
                        <span className="text-zinc-500">r:</span>{" "}
                        {permitSignature.r.slice(0, 30)}...
                      </p>
                      <p className="text-[10px] font-mono text-zinc-400 break-all">
                        <span className="text-zinc-500">s:</span>{" "}
                        {permitSignature.s.slice(0, 30)}...
                      </p>
                    </div>
                  </div>

                  <div className="bg-zinc-900/60 rounded-md p-3">
                    <p className="text-[11px] text-zinc-500 mb-2">
                      Borrow Details
                    </p>
                    <div className="space-y-1">
                      <div className="flex justify-between">
                        <span className="text-[10px] text-zinc-500">
                          Amount:
                        </span>
                        <span className="text-[10px] font-semibold text-zinc-100">
                          USDC {signedIntent.amount.toFixed(2)}
                        </span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-[10px] text-zinc-500">
                          Deadline:
                        </span>
                        <span className="text-[10px] font-semibold text-zinc-100">
                          {new Date(
                            permitSignature.deadline * 1000,
                          ).toLocaleString()}
                        </span>
                      </div>
                      {borrowTxHash && (
                        <div className="flex justify-between gap-3">
                          <span className="text-[10px] text-zinc-500">
                            Tx Hash:
                          </span>
                          <span className="text-[10px] font-mono font-semibold text-zinc-100 break-all text-right">
                            {borrowTxHash}
                          </span>
                        </div>
                      )}
                    </div>
                  </div>
                </div>

                <DialogFooter className="bg-zinc-900/60 border-zinc-800">
                  <button
                    type="button"
                    onClick={() => setIsBorrowDialogOpen(false)}
                    className="rounded-md bg-gold px-3 py-2 text-xs font-semibold text-black hover:bg-gold/90"
                  >
                    Complete Borrow
                  </button>
                </DialogFooter>
              </>
            )}

          {signError && (
            <div className="bg-red-500/20 border border-red-500/50 rounded-md p-3">
              <p className="text-[11px] text-red-300">{signError}</p>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </nav>
  );
};

export default Navbar;
