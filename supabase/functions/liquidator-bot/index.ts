import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  createWalletClient,
  http,
  parseEventLogs,
  publicActions,
} from "https://esm.sh/viem";
import { privateKeyToAccount } from "https://esm.sh/viem/accounts";
import { baseSepolia } from "https://esm.sh/viem/chains";
// Import Supabase client for DB access in the Deno function.
// Import viem helpers for creating a wallet client, HTTP transport,
// parsing event logs from receipts, and enabling public actions.

Deno.serve(async (req) => {
  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  const CONTRACT_ABI = [
    {
      inputs: [
        { internalType: "address", name: "_usdcToken", type: "address" },
      ],
      stateMutability: "nonpayable",
      type: "constructor",
    },
    {
      inputs: [],
      name: "CRELOLOAN_UserDoesNothaveEnoughBalance",
      type: "error",
    },
    { inputs: [], name: "ECDSAInvalidSignature", type: "error" },
    {
      inputs: [{ internalType: "uint256", name: "length", type: "uint256" }],
      name: "ECDSAInvalidSignatureLength",
      type: "error",
    },
    {
      inputs: [{ internalType: "bytes32", name: "s", type: "bytes32" }],
      name: "ECDSAInvalidSignatureS",
      type: "error",
    },
    { inputs: [], name: "InvalidShortString", type: "error" },
    { inputs: [], name: "ReentrancyGuardReentrantCall", type: "error" },
    {
      inputs: [{ internalType: "address", name: "token", type: "address" }],
      name: "SafeERC20FailedOperation",
      type: "error",
    },
    {
      inputs: [{ internalType: "string", name: "str", type: "string" }],
      name: "StringTooLong",
      type: "error",
      // Deno HTTP function entry point. The handler is async and receives the
      // incoming Request object (not used here beyond function invocation).
    },
    {
      anonymous: false,
      inputs: [
        {
          indexed: true,
          internalType: "address",
          name: "borrower",
          type: "address",
        },
        {
          indexed: false,
          internalType: "uint256",
          name: "amount",
          type: "uint256",
        },
        {
          indexed: false,
          internalType: "uint256",
          name: "deadline",
          type: "uint256",
        },
      ],
      name: "Borrowed",
      type: "event",
    },
    {
      anonymous: false,
      inputs: [
        {
          indexed: true,
          internalType: "address",
          name: "borrower",
          type: "address",
        },
        {
          indexed: false,
          internalType: "uint256",
          name: "amount",
          type: "uint256",
        },
      ],
      name: "Collected",
      type: "event",
    },
    {
      anonymous: false,
      inputs: [],
      name: "EIP712DomainChanged",
      type: "event",
    },
    {
      anonymous: false,
      inputs: [
        {
          indexed: true,
          internalType: "address",
          name: "borrower",
          type: "address",
        },
        {
          indexed: false,
          internalType: "uint256",
          name: "amount",
          type: "uint256",
        },
      ],
      name: "Repaid",
      type: "event",
    },
    {
      inputs: [
        { internalType: "address", name: "borrower", type: "address" },
        { internalType: "uint256", name: "amount", type: "uint256" },
        { internalType: "uint256", name: "deadline", type: "uint256" },
        { internalType: "uint256", name: "nonce", type: "uint256" },
        { internalType: "bytes", name: "signature", type: "bytes" },
      ],
      name: "borrow",
      outputs: [],
      stateMutability: "nonpayable",
      type: "function",
    },
    {
      inputs: [
        { internalType: "address", name: "borrower", type: "address" },
        { internalType: "uint256", name: "amount", type: "uint256" },
        { internalType: "uint256", name: "deadline", type: "uint256" },
        { internalType: "uint256", name: "nonce", type: "uint256" },
        { internalType: "bytes", name: "signature", type: "bytes" },
        { internalType: "uint8", name: "v", type: "uint8" },
        { internalType: "bytes32", name: "r", type: "bytes32" },
        { internalType: "bytes32", name: "s", type: "bytes32" },
      ],
      name: "collect",
      outputs: [],
      stateMutability: "nonpayable",
      type: "function",
    },
    {
      inputs: [],
      name: "eip712Domain",
      outputs: [
        { internalType: "bytes1", name: "fields", type: "bytes1" },
        { internalType: "string", name: "name", type: "string" },
        { internalType: "string", name: "version", type: "string" },
        { internalType: "uint256", name: "chainId", type: "uint256" },
        { internalType: "address", name: "verifyingContract", type: "address" },
        { internalType: "bytes32", name: "salt", type: "bytes32" },
        { internalType: "uint256[]", name: "extensions", type: "uint256[]" },
      ],
      stateMutability: "view",
      type: "function",
    },
    {
      inputs: [{ internalType: "uint256", name: "amount", type: "uint256" }],
      name: "fundContract",
      outputs: [],
      stateMutability: "nonpayable",
      type: "function",
    },
    {
      inputs: [{ internalType: "address", name: "", type: "address" }],
      name: "loans",
      outputs: [
        { internalType: "uint256", name: "totalDebt", type: "uint256" },
        { internalType: "uint256", name: "remainingDebt", type: "uint256" },
        { internalType: "uint256", name: "deadline", type: "uint256" },
        { internalType: "bool", name: "permitUsed", type: "bool" },
      ],
      stateMutability: "view",
      type: "function",
    },
    {
      inputs: [
        { internalType: "address", name: "borrower", type: "address" },
        { internalType: "uint256", name: "amount", type: "uint256" },
      ],
      name: "repay",
      outputs: [],
      stateMutability: "nonpayable",
      type: "function",
    },
  ];

  const CONTRACT_ADDRESS = "0x843f153f9d3f50aa9e861abc25653cb3f57a1b3e";

  const { data: overdueLoans, error: overdueError } = await supabase
    .from("loans")
    .select(
      "id,user_address,total_debt,remaining_debt,deadline,borrow_signature,permit_v,permit_r,permit_s,status",
    )
    .eq("status", "borrowed")
    .gt("remaining_debt", 0)
    .lt("deadline", new Date().toISOString())
    .order("deadline", { ascending: true });

  if (overdueError) {
    console.error("Failed to fetch overdue loans:", overdueError);
    return new Response("Failed to fetch overdue loans.", { status: 500 });
  }

  if (!overdueLoans || overdueLoans.length === 0) {
    return new Response("No overdue loans.");
  }

  // 2. Setup Viem Wallet (Your Admin/Bot Private Key)
  const account = privateKeyToAccount(
    Deno.env.get("BOT_PRIVATE_KEY") as `0x${string}`,
  );
  const client = createWalletClient({
    account,
    chain: baseSepolia,
    transport: http(Deno.env.get("ALCHEMY_RPC_URL")),
  }).extend(publicActions);

  for (const loan of overdueLoans) {
    try {
      if (!loan.nonce) {
        console.error(`Skipping loan ${loan.id}: missing nonce.`);
        continue;
      }
      // The contract ABI is defined inline so this function can parse events
      // and call contract methods. Keep this in-sync with your deployed
      // contract's ABI when upgrading.

      const deadlineUnix = Math.floor(new Date(loan.deadline).getTime() / 1000);
      const collectAmount = BigInt(
        Math.max(Math.round(Number(loan.remaining_debt) * 1e6), 0),
      );

      const hash = await client.writeContract({
        address: CONTRACT_ADDRESS as `0x${string}`,
        abi: CONTRACT_ABI,
        functionName: "collect",
        args: [
          loan.user_address,
          collectAmount,
          BigInt(deadlineUnix),
          BigInt(loan.nonce),
          loan.borrow_signature,
          Number(loan.permit_v),
          loan.permit_r,
          loan.permit_s,
        ],
      });

      const receipt = await client.waitForTransactionReceipt({ hash });
      const collectedEvents = parseEventLogs({
        abi: CONTRACT_ABI,
        logs: receipt.logs,
        eventName: "Collected",
      });

      if (!collectedEvents.length) {
        throw new Error(
          "Collected event was not found in the transaction receipt.",
        );
      }

      const collectedEvent = collectedEvents[0] as unknown as {
        args: {
          borrower: `0x${string}`;
          amount: bigint;
        };
      };

      if (
        collectedEvent.args.borrower.toLowerCase() !==
        loan.user_address.toLowerCase()
      ) {
        throw new Error(
          "Collected event borrower did not match the overdue loan.",
        );
      }

      const collectedAmount = Number(collectedEvent.args.amount) / 1e6;
      const nextRemainingDebt = Math.max(
        Number(loan.remaining_debt) - collectedAmount,
        0,
      );

      const { error: updateError } = await supabase
        .from("loans")
        .update({
          remaining_debt: nextRemainingDebt,
          status: nextRemainingDebt > 0 ? "borrowed" : "collected",
          is_processed: true,
        })
        .eq("id", loan.id);

      if (updateError) {
        throw new Error(
          `Failed to update loan ${loan.id}: ${updateError.message}`,
        );
      }
    } catch (err) {
      console.error(`Failed to collect overdue loan ${loan.id}:`, err);
    }
  }

  return new Response("Overdue collection sweep completed.");
});
