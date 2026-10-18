// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console} from "forge-std/Script.sol";
import {AllowanceFactory} from "../AllowanceFactory.sol";
import {AllowanceAccount} from "../AllowanceAccount.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";

/**
 * @dev Foundry deployment + interaction script for AllowanceAccount.
 *
 * This script:
 * 1. Connects to an existing factory
 * 2. Creates an AllowanceAccount owned by the broadcaster
 * 3. Mints testnet USDC to itself (Arc Testnet USDC supports mint())
 * 4. Funds the account
 * 5. Configures an agent (from a deterministic private key)
 * 6. Signs a PaymentIntent off-chain and submits payWithSig
 *
 * Run with:
 *   forge script contracts/script/AllowanceDemo.s.sol \
 *     --rpc-url https://rpc.testnet.arc.io \
 *     --broadcast \
 *     --private-key $DEMO_PRIVATE_KEY
 */
contract AllowanceDemoScript is Script {
    address constant FACTORY = 0x2D81436A9BC433498dB5B9B8bC7d09f33fd9504f;
    address constant USDC    = 0x3600000000000000000000000000000000000000;

    bytes32 constant PAYMENT_INTENT_TYPEHASH =
        keccak256("PaymentIntent(address agent,address payee,uint256 amount,uint256 nonce,uint256 deadline,bytes32 ref)");

    function run() external {
        // Use the private key from the DEMO_PRIVATE_KEY env var
        uint256 ownerKey = vm.envUint("DEMO_PRIVATE_KEY");
        address ownerAddr = vm.addr(ownerKey);

        // Fixed agent key (deterministic for the demo)
        uint256 agentKey = 0xA11CE;
        address agentAddr = vm.addr(agentKey);
        address payeeAddr = address(0xdEaD);

        console.log("Owner address :", ownerAddr);
        console.log("Agent address :", agentAddr);
        console.log("Payee address :", payeeAddr);

        vm.startBroadcast(ownerKey);

        // -------------------------------------------------------------------
        // 1. Create account
        // -------------------------------------------------------------------
        AllowanceAccount acct = AllowanceAccount(
            AllowanceFactory(FACTORY).createAccount(address(0))
        );
        console.log("AllowanceAccount :", address(acct));

        // -------------------------------------------------------------------
        // 2. Mint testnet USDC and fund
        // -------------------------------------------------------------------
        // Try to mint (Arc Testnet USDC may allow this)
        (bool ok,) = USDC.call(
            abi.encodeWithSignature("mint(address,uint256)", ownerAddr, 10_000_000)
        );
        if (ok) {
            console.log("Minted 10 USDC to owner");
        } else {
            console.log("Mint not available, using existing balance");
        }

        uint256 bal = IERC20(USDC).balanceOf(ownerAddr);
        console.log("Owner USDC balance (6-dec):", bal);

        uint128 fundAmt = 5_000_000; // 5 USDC
        IERC20(USDC).approve(address(acct), fundAmt);
        acct.fund(fundAmt);
        console.log("Funded account with 5 USDC");

        // -------------------------------------------------------------------
        // 3. Set agent
        // -------------------------------------------------------------------
        uint64 expires = uint64(block.timestamp + 30 days);
        acct.setAgent(
            agentAddr,
            "demo-agent",
            1_000_000,  // maxPerPayment: 1 USDC
            2_000_000,  // periodLimit:   2 USDC / day
            86_400,     // periodSeconds: 1 day
            5_000_000,  // totalLimit:    5 USDC
            expires,
            false       // no payee restriction
        );
        console.log("Agent configured:", agentAddr);

        vm.stopBroadcast();

        // -------------------------------------------------------------------
        // 4. Build PaymentIntent and sign as agent (off-chain, using vm.sign)
        // -------------------------------------------------------------------
        AllowanceAccount.PaymentIntent memory intent = AllowanceAccount.PaymentIntent({
            agent:    agentAddr,
            payee:    payeeAddr,
            amount:   500_000, // 0.5 USDC
            nonce:    1,
            deadline: block.timestamp + 3600,
            ref:      bytes32("ALLOWANCE-DEMO")
        });

        // Compute EIP-712 digest
        bytes32 domainSep = keccak256(abi.encode(
            keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"),
            keccak256("Allowance"),
            keccak256("1"),
            block.chainid,
            address(acct)
        ));
        bytes32 structHash = keccak256(abi.encode(
            PAYMENT_INTENT_TYPEHASH,
            intent.agent, intent.payee, intent.amount,
            intent.nonce, intent.deadline, intent.ref
        ));
        bytes32 digest = keccak256(abi.encodePacked("\x19\x01", domainSep, structHash));
        console.log("Payment intent digest:");
        console.logBytes32(digest);

        (uint8 v, bytes32 r, bytes32 s) = vm.sign(agentKey, digest);
        bytes memory sig = abi.encodePacked(r, s, v);
        console.log("Signature length:", sig.length);

        // -------------------------------------------------------------------
        // 5. Relay payWithSig (relayer = owner for simplicity)
        // -------------------------------------------------------------------
        vm.startBroadcast(ownerKey);
        acct.payWithSig(intent, sig);
        vm.stopBroadcast();

        console.log("\n=== payWithSig completed ===");
        console.log("Paid 0.5 USDC to", payeeAddr);
        console.log("Account totalPaid:", acct.totalPaid());
        console.log("Account balance  :", acct.balance());
    }
}
