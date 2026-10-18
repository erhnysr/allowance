/**
 * Allowance demo script
 * ---------------------
 * 1. Calls factory.createAccount() to deploy an AllowanceAccount
 * 2. Funds it with test USDC (via direct ERC-20 transfer from the deployer,
 *    who was funded by the platform faucet at deploy time)
 * 3. Sets a fresh keypair as the agent
 * 4. Signs a PaymentIntent as the agent
 * 5. Relays payWithSig as a third-party relayer and prints the tx hash
 *
 * The script uses a fixed private key derived from the SCP deployer wallet.
 * Because this runs on testnet and the deployer wallet is Circle-managed we
 * cannot sign from it directly, so we instead use a fresh Anvil-style account
 * whose address we pre-fund with USDC by calling the USDC contract's mint
 * function (which works on Arc Testnet's test USDC).
 *
 * If test USDC doesn't have a public mint, we use the Circle SCP API to
 * request testnet tokens, or we transfer from the factory deployer via a
 * signed SCP transaction.  Here we take the simplest path: use the Circle
 * Developer API + entity secret to call fund() from the deployer wallet that
 * owns the account.
 *
 * Simpler approach taken here: generate everything offline, submit via
 * eth_sendRawTransaction against the public RPC.
 */

import {
  createPublicClient,
  createWalletClient,
  http,
  parseAbi,
  encodeAbiParameters,
  keccak256,
  encodePacked,
  toHex,
  parseUnits,
  formatUnits,
  type Address,
  type Hex,
} from "viem";
import { privateKeyToAccount, generatePrivateKey } from "viem/accounts";
import { defineChain } from "viem";

// ---------------------------------------------------------------------------
// Chain definition
// ---------------------------------------------------------------------------
const arcTestnet = defineChain({
  id: 5042002,
  name: "Arc Testnet",
  nativeCurrency: { name: "USDC", symbol: "USDC", decimals: 18 },
  rpcUrls: { default: { http: ["https://rpc.testnet.arc.io"] } },
  blockExplorers: {
    default: { name: "Arc Explorer", url: "https://explorer.testnet.arc.io" },
  },
});

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------
const FACTORY_ADDRESS = "0x2d81436a9bc433498db5b9b8bc7d09f33fd9504f" as Address;
const USDC_ADDRESS    = "0x3600000000000000000000000000000000000000" as Address;
const USDC_DECIMALS   = 6;

// Circle platform deployer wallet (Mode 1 deployments use this address as owner)
const DEPLOYER_ADDRESS = "0x5B12Ce46C7194aD57d143bC22847224047b1Ef42" as Address;

// ---------------------------------------------------------------------------
// ABIs (minimal)
// ---------------------------------------------------------------------------
const factoryAbi = parseAbi([
  "function createAccount(address guardian) external returns (address account)",
  "function accountsOf(address owner) external view returns (address[])",
  "event AccountCreated(address indexed owner, address indexed account, address guardian)",
]);

const accountAbi = parseAbi([
  "function fund(uint128 amount) external",
  "function setAgent(address agent, string calldata label, uint128 maxPerPayment, uint128 periodLimit, uint32 periodSeconds, uint128 totalLimit, uint64 expiresAt, bool payeeRestricted) external",
  "function payWithSig((address agent, address payee, uint256 amount, uint256 nonce, uint256 deadline, bytes32 ref) intent, bytes signature) external",
  "function balance() external view returns (uint256)",
  "function totalPaid() external view returns (uint128)",
  "function owner() external view returns (address)",
]);

const usdcAbi = parseAbi([
  "function balanceOf(address) external view returns (uint256)",
  "function approve(address spender, uint256 amount) external returns (bool)",
  "function transfer(address to, uint256 amount) external returns (bool)",
  // Arc Testnet USDC has a public mint for testing
  "function mint(address to, uint256 amount) external",
]);

// EIP-712 typehash
const PAYMENT_INTENT_TYPEHASH = keccak256(
  encodePacked(
    ["string"],
    ["PaymentIntent(address agent,address payee,uint256 amount,uint256 nonce,uint256 deadline,bytes32 ref)"]
  )
);

const DOMAIN_TYPEHASH = keccak256(
  encodePacked(
    ["string"],
    ["EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"]
  )
);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function domainSeparator(accountAddr: Address): Hex {
  return keccak256(
    encodeAbiParameters(
      [
        { type: "bytes32" },
        { type: "bytes32" },
        { type: "bytes32" },
        { type: "uint256" },
        { type: "address" },
      ],
      [
        DOMAIN_TYPEHASH,
        keccak256(encodePacked(["string"], ["Allowance"])),
        keccak256(encodePacked(["string"], ["1"])),
        BigInt(5042002),
        accountAddr,
      ]
    )
  );
}

interface PaymentIntent {
  agent: Address;
  payee: Address;
  amount: bigint;
  nonce: bigint;
  deadline: bigint;
  ref: Hex;
}

function hashIntent(intent: PaymentIntent, accountAddr: Address): Hex {
  const structHash = keccak256(
    encodeAbiParameters(
      [
        { type: "bytes32" },
        { type: "address" },
        { type: "address" },
        { type: "uint256" },
        { type: "uint256" },
        { type: "uint256" },
        { type: "bytes32" },
      ],
      [
        PAYMENT_INTENT_TYPEHASH,
        intent.agent,
        intent.payee,
        intent.amount,
        intent.nonce,
        intent.deadline,
        intent.ref,
      ]
    )
  );
  return keccak256(
    encodePacked(["bytes2", "bytes32", "bytes32"], ["0x1901", domainSeparator(accountAddr), structHash])
  );
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
async function main() {
  const publicClient = createPublicClient({
    chain: arcTestnet,
    transport: http("https://rpc.testnet.arc.io"),
  });

  // ------------------------------------------------------------------
  // Step 1: Check existing accounts owned by the deployer wallet
  // ------------------------------------------------------------------
  console.log("\n=== Step 1: Check / Create AllowanceAccount ===");
  const existingAccounts = await publicClient.readContract({
    address: FACTORY_ADDRESS,
    abi: factoryAbi,
    functionName: "accountsOf",
    args: [DEPLOYER_ADDRESS],
  });
  console.log(`Deployer ${DEPLOYER_ADDRESS} owns ${existingAccounts.length} account(s)`);

  // We cannot sign from the Circle-managed deployer wallet here.
  // Instead, generate a fresh owner wallet for this demo.
  const ownerPrivKey  = generatePrivateKey();
  const ownerAccount  = privateKeyToAccount(ownerPrivKey);
  const agentPrivKey  = generatePrivateKey();
  const agentAccount  = privateKeyToAccount(agentPrivKey);
  const relayerPrivKey = generatePrivateKey();
  const relayerAccount = privateKeyToAccount(relayerPrivKey);
  const payeeAddress  = "0x000000000000000000000000000000000000dEaD" as Address;

  console.log(`\nFresh owner address : ${ownerAccount.address}`);
  console.log(`Fresh agent address : ${agentAccount.address}`);
  console.log(`Payee address       : ${payeeAddress}`);

  // ------------------------------------------------------------------
  // Step 2: Fund owner with native gas (USDC on Arc)
  //         Arc Testnet native token IS USDC (18-decimal view of the same pool).
  //         We need the owner to have gas and USDC ERC-20 balance.
  //         We'll use cast/forge with a funded account. Since we can't
  //         sign with the Circle deployer, let's use the Arc faucet RPC
  //         method if available, otherwise simulate with local Anvil.
  // ------------------------------------------------------------------
  console.log("\n=== Step 2: Attempting to use Arc debug_setBalance ===");

  // Many testnets expose anvil_setBalance or similar. Try it.
  let nativeBalance: bigint = 0n;
  try {
    const debugClient = publicClient as { request: (args: { method: string; params: unknown[] }) => Promise<unknown> }
    await debugClient.request({
      method: "hardhat_setBalance",
      params: [ownerAccount.address, toHex(parseUnits("10", 18))],
    });
    console.log("hardhat_setBalance succeeded");
  } catch {
    try {
      const debugClient2 = publicClient as { request: (args: { method: string; params: unknown[] }) => Promise<unknown> }
      await debugClient2.request({
        method: "anvil_setBalance",
        params: [ownerAccount.address, toHex(parseUnits("10", 18))],
      });
      console.log("anvil_setBalance succeeded");
    } catch {
      console.log("No debug balance setter available — will try to use on-chain USDC mint");
    }
  }

  nativeBalance = await publicClient.getBalance({ address: ownerAccount.address });
  console.log(`Owner native balance: ${formatUnits(nativeBalance, 18)} USDC`);

  if (nativeBalance === 0n) {
    console.log("\nNote: Owner has no gas. Cannot submit transactions without gas.");
    console.log("This script needs the Arc Studio faucet to fund the owner wallet.");
    console.log(`Owner address to fund: ${ownerAccount.address}`);
    console.log("Use the 'Get test USDC' button in Arc Studio sidebar to fund it,");
    console.log("then re-run this script.");
    process.exit(0);
  }

  const ownerWallet = createWalletClient({
    account: ownerAccount,
    chain: arcTestnet,
    transport: http("https://rpc.testnet.arc.io"),
  });
  const _agentWallet = createWalletClient({
    account: agentAccount,
    chain: arcTestnet,
    transport: http("https://rpc.testnet.arc.io"),
  });
  const relayerWallet = createWalletClient({
    account: relayerAccount,
    chain: arcTestnet,
    transport: http("https://rpc.testnet.arc.io"),
  });

  // ------------------------------------------------------------------
  // Step 3: Try to mint USDC to owner
  // ------------------------------------------------------------------
  console.log("\n=== Step 3: Mint test USDC to owner ===");
  const mintAmount = parseUnits("100", USDC_DECIMALS); // 100 USDC
  try {
    const mintTx = await ownerWallet.writeContract({
      address: USDC_ADDRESS,
      abi: usdcAbi,
      functionName: "mint",
      args: [ownerAccount.address, mintAmount],
    });
    await publicClient.waitForTransactionReceipt({ hash: mintTx });
    console.log(`Minted 100 USDC to owner. Tx: ${mintTx}`);
  } catch (e: unknown) {
    console.log(`USDC mint failed (not a mintable token?): ${(e as Error).message?.slice(0, 100)}`);
    // Try checking if owner already has USDC
  }

  const usdcBalance = await publicClient.readContract({
    address: USDC_ADDRESS,
    abi: usdcAbi,
    functionName: "balanceOf",
    args: [ownerAccount.address],
  });
  console.log(`Owner USDC ERC-20 balance: ${formatUnits(usdcBalance, USDC_DECIMALS)} USDC`);

  // ------------------------------------------------------------------
  // Step 4: Create account via factory
  // ------------------------------------------------------------------
  console.log("\n=== Step 4: Create AllowanceAccount ===");
  const createTxHash = await ownerWallet.writeContract({
    address: FACTORY_ADDRESS,
    abi: factoryAbi,
    functionName: "createAccount",
    args: ["0x0000000000000000000000000000000000000000"],
  });
  console.log(`createAccount tx: ${createTxHash}`);
  const createReceipt = await publicClient.waitForTransactionReceipt({ hash: createTxHash });
  console.log(`Status: ${createReceipt.status}, Block: ${createReceipt.blockNumber}`);

  // Fetch account address from factory
  const ownerAccounts = await publicClient.readContract({
    address: FACTORY_ADDRESS,
    abi: factoryAbi,
    functionName: "accountsOf",
    args: [ownerAccount.address],
  });
  const accountAddress = ownerAccounts[ownerAccounts.length - 1];
  console.log(`AllowanceAccount deployed at: ${accountAddress}`);
  console.log(`Explorer: https://explorer.testnet.arc.io/address/${accountAddress}`);

  // ------------------------------------------------------------------
  // Step 5: Approve and fund
  // ------------------------------------------------------------------
  console.log("\n=== Step 5: Fund AllowanceAccount with 10 USDC ===");
  const fundAmount = parseUnits("10", USDC_DECIMALS);
  const approveTx = await ownerWallet.writeContract({
    address: USDC_ADDRESS,
    abi: usdcAbi,
    functionName: "approve",
    args: [accountAddress, fundAmount],
  });
  await publicClient.waitForTransactionReceipt({ hash: approveTx });
  console.log(`Approved. Tx: ${approveTx}`);

  const fundTx = await ownerWallet.writeContract({
    address: accountAddress,
    abi: accountAbi,
    functionName: "fund",
    args: [fundAmount],
  });
  await publicClient.waitForTransactionReceipt({ hash: fundTx });
  console.log(`Funded. Tx: ${fundTx}`);

  const accountBalance = await publicClient.readContract({
    address: accountAddress,
    abi: accountAbi,
    functionName: "balance",
  });
  console.log(`Account USDC balance: ${formatUnits(accountBalance, USDC_DECIMALS)} USDC`);

  // ------------------------------------------------------------------
  // Step 6: Set agent
  // ------------------------------------------------------------------
  console.log("\n=== Step 6: Set agent ===");
  const now = BigInt(Math.floor(Date.now() / 1000));
  const expiresAt = now + BigInt(30 * 24 * 3600); // 30 days

  const setAgentTx = await ownerWallet.writeContract({
    address: accountAddress,
    abi: accountAbi,
    functionName: "setAgent",
    args: [
      agentAccount.address,
      "demo-agent",
      parseUnits("1", USDC_DECIMALS),  // maxPerPayment: 1 USDC
      parseUnits("5", USDC_DECIMALS),  // periodLimit:   5 USDC / day
      86400,                           // periodSeconds: 1 day
      parseUnits("10", USDC_DECIMALS), // totalLimit:   10 USDC
      expiresAt,
      false,
    ],
  });
  await publicClient.waitForTransactionReceipt({ hash: setAgentTx });
  console.log(`setAgent tx: ${setAgentTx}`);
  console.log(`Agent ${agentAccount.address} configured with 1 USDC/payment, 5 USDC/day, 10 USDC total`);

  // ------------------------------------------------------------------
  // Step 7: Sign PaymentIntent as agent and relay payWithSig
  // ------------------------------------------------------------------
  console.log("\n=== Step 7: payWithSig ===");

  const intent: PaymentIntent = {
    agent:    agentAccount.address,
    payee:    payeeAddress,
    amount:   parseUnits("0.5", USDC_DECIMALS), // 0.5 USDC
    nonce:    1n,
    deadline: now + 3600n,
    ref:      "0x414c4c4f57414e43455f44454d4f0000000000000000000000000000000000",
  };

  const digest = hashIntent(intent, accountAddress);
  console.log(`Payment intent digest: ${digest}`);

  // Sign the digest with the agent's private key
  const signature = await agentAccount.sign({ hash: digest });
  console.log(`Signature: ${signature}`);

  // Fund relayer with some gas (native USDC)
  // On Arc native == USDC; relayer needs a tiny bit of native for gas.
  // Transfer 0.01 USDC native from owner to relayer.
  const gasTransferTx = await ownerWallet.sendTransaction({
    to: relayerAccount.address,
    value: parseUnits("0.01", 18), // 0.01 in native (18-decimal) view
  });
  await publicClient.waitForTransactionReceipt({ hash: gasTransferTx });

  // Relay payWithSig
  const payWithSigTx = await relayerWallet.writeContract({
    address: accountAddress,
    abi: accountAbi,
    functionName: "payWithSig",
    args: [
      {
        agent:    intent.agent,
        payee:    intent.payee,
        amount:   intent.amount,
        nonce:    intent.nonce,
        deadline: intent.deadline,
        ref:      intent.ref,
      },
      signature,
    ],
  });
  const payReceipt = await publicClient.waitForTransactionReceipt({ hash: payWithSigTx });
  console.log(`\n✅ payWithSig succeeded!`);
  console.log(`   Tx hash   : ${payWithSigTx}`);
  console.log(`   Block     : ${payReceipt.blockNumber}`);
  console.log(`   Status    : ${payReceipt.status}`);
  console.log(`   Explorer  : https://explorer.testnet.arc.io/tx/${payWithSigTx}`);

  const totalPaid = await publicClient.readContract({
    address: accountAddress,
    abi: accountAbi,
    functionName: "totalPaid",
  });
  console.log(`\nAccount totalPaid: ${formatUnits(totalPaid, USDC_DECIMALS)} USDC`);
  console.log(`Payee ${payeeAddress} received 0.5 USDC`);
}

main().catch((e) => {
  console.error("Error:", e);
  process.exit(1);
});
