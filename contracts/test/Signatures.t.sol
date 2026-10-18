// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {AllowanceAccount} from "../AllowanceAccount.sol";
import {AllowanceTestBase} from "./TestHelpers.sol";

contract SignaturesTest is AllowanceTestBase {

    uint128 constant AMT     = 100_000;  // 0.1 USDC
    uint128 constant BIG_AMT = 60_000_000; // 60 USDC — used for period-limit test

    function setUp() public override {
        super.setUp();
        _fund(200_000_000); // 200 USDC
        _setAgent1(); // default policy: maxPer=500_000, period=1_000_000/day, total=100 USDC
    }

    // -----------------------------------------------------------------------
    // Valid signature pays
    // -----------------------------------------------------------------------

    function test_payWithSig_valid() public {
        (AllowanceAccount.PaymentIntent memory intent, bytes memory sig) = _signIntent(
            agentKey1, agent1, payee1, AMT, 1, block.timestamp + 1 hours, bytes32("r1"), address(account)
        );

        uint256 before = usdc.balanceOf(payee1);
        account.payWithSig(intent, sig);
        assertEq(usdc.balanceOf(payee1), before + AMT);
        assertEq(account.paymentCount(), 1);
        assertTrue(account.nonceUsed(agent1, 1));
    }

    function test_payWithSig_relayerPaysGas() public {
        (AllowanceAccount.PaymentIntent memory intent, bytes memory sig) = _signIntent(
            agentKey1, agent1, payee1, AMT, 2, block.timestamp + 1 hours, bytes32(0), address(account)
        );

        vm.prank(relayer);
        vm.expectEmit(true, true, false, true, address(account));
        emit AllowanceAccount.Paid(agent1, payee1, AMT, bytes32(0), relayer);
        account.payWithSig(intent, sig);
    }

    // -----------------------------------------------------------------------
    // Wrong signer
    // -----------------------------------------------------------------------

    function test_payWithSig_wrongSigner() public {
        uint256 wrongKey = 0xBAD;
        // Sign with wrong key but claim agent1
        (AllowanceAccount.PaymentIntent memory intent, bytes memory sig) = _signIntent(
            wrongKey, agent1, payee1, AMT, 1, block.timestamp + 1 hours, bytes32(0), address(account)
        );
        vm.expectRevert(AllowanceAccount.InvalidSignature.selector);
        account.payWithSig(intent, sig);
    }

    // -----------------------------------------------------------------------
    // Signature for a different account (domain separation)
    // -----------------------------------------------------------------------

    function test_payWithSig_wrongAccountDomain() public {
        // Create a second account
        vm.prank(owner);
        AllowanceAccount account2 = AllowanceAccount(factory.createAccount(address(0)));
        usdc.mint(owner, 1_000_000);
        vm.prank(owner);
        usdc.approve(address(account2), type(uint256).max);
        vm.prank(owner);
        account2.fund(1_000_000);
        vm.prank(owner);
        account2.setAgent(
            agent1, "a1", MAX_PER, PERIOD, PSEC, TOTAL,
            uint64(block.timestamp + EXPIRES_IN), false
        );

        // Sign for account (the first one)
        (AllowanceAccount.PaymentIntent memory intent, bytes memory sig) = _signIntent(
            agentKey1, agent1, payee1, AMT, 1, block.timestamp + 1 hours, bytes32(0), address(account)
        );

        // Try to relay on account2 — different verifyingContract → wrong domain
        vm.expectRevert(AllowanceAccount.InvalidSignature.selector);
        account2.payWithSig(intent, sig);
    }

    // -----------------------------------------------------------------------
    // Expired deadline
    // -----------------------------------------------------------------------

    function test_payWithSig_expiredDeadline() public {
        uint256 deadline = block.timestamp - 1;
        (AllowanceAccount.PaymentIntent memory intent, bytes memory sig) = _signIntent(
            agentKey1, agent1, payee1, AMT, 1, deadline, bytes32(0), address(account)
        );
        vm.expectRevert(AllowanceAccount.DeadlinePassed.selector);
        account.payWithSig(intent, sig);
    }

    function test_payWithSig_deadlineExact_passes() public {
        // deadline == block.timestamp is still valid (not > deadline)
        (AllowanceAccount.PaymentIntent memory intent, bytes memory sig) = _signIntent(
            agentKey1, agent1, payee1, AMT, 1, block.timestamp, bytes32(0), address(account)
        );
        account.payWithSig(intent, sig); // should succeed
    }

    // -----------------------------------------------------------------------
    // Reused nonce
    // -----------------------------------------------------------------------

    function test_payWithSig_reusedNonce() public {
        (AllowanceAccount.PaymentIntent memory intent, bytes memory sig) = _signIntent(
            agentKey1, agent1, payee1, AMT, 1, block.timestamp + 1 hours, bytes32(0), address(account)
        );
        account.payWithSig(intent, sig);

        // Second relay — same nonce
        vm.expectRevert(AllowanceAccount.NonceAlreadyUsed.selector);
        account.payWithSig(intent, sig);
    }

    // -----------------------------------------------------------------------
    // Cancelled nonce
    // -----------------------------------------------------------------------

    function test_payWithSig_cancelledNonce() public {
        vm.prank(agent1);
        account.cancelNonce(agent1, 42);

        (AllowanceAccount.PaymentIntent memory intent, bytes memory sig) = _signIntent(
            agentKey1, agent1, payee1, AMT, 42, block.timestamp + 1 hours, bytes32(0), address(account)
        );
        vm.expectRevert(AllowanceAccount.NonceAlreadyUsed.selector);
        account.payWithSig(intent, sig);
    }

    // -----------------------------------------------------------------------
    // Two nonces relayed in either order
    // -----------------------------------------------------------------------

    function test_payWithSig_twoNonces_reverseOrder() public {
        (AllowanceAccount.PaymentIntent memory intent1, bytes memory sig1) = _signIntent(
            agentKey1, agent1, payee1, AMT, 1, block.timestamp + 1 hours, bytes32(0), address(account)
        );
        (AllowanceAccount.PaymentIntent memory intent2, bytes memory sig2) = _signIntent(
            agentKey1, agent1, payee1, AMT, 2, block.timestamp + 1 hours, bytes32(0), address(account)
        );

        // Relay nonce=2 first, then nonce=1
        account.payWithSig(intent2, sig2);
        account.payWithSig(intent1, sig1);

        assertTrue(account.nonceUsed(agent1, 1));
        assertTrue(account.nonceUsed(agent1, 2));
        assertEq(account.paymentCount(), 2);
    }

    function test_payWithSig_twoNonces_normalOrder() public {
        (AllowanceAccount.PaymentIntent memory intent1, bytes memory sig1) = _signIntent(
            agentKey1, agent1, payee1, AMT, 10, block.timestamp + 1 hours, bytes32(0), address(account)
        );
        (AllowanceAccount.PaymentIntent memory intent2, bytes memory sig2) = _signIntent(
            agentKey1, agent1, payee1, AMT, 11, block.timestamp + 1 hours, bytes32(0), address(account)
        );

        account.payWithSig(intent1, sig1);
        account.payWithSig(intent2, sig2);
        assertEq(account.paymentCount(), 2);
    }

    // -----------------------------------------------------------------------
    // Two intents that individually fit but together exceed period limit
    // -----------------------------------------------------------------------

    function test_payWithSig_twoBothFitButTogetherExceedPeriodLimit() public {
        // Set agent2 with periodLimit=100 USDC, max per payment=100 USDC, totalLimit=200 USDC
        vm.prank(owner);
        account.setAgent(
            agent2, "a2", BIG_AMT, BIG_AMT * 1, PSEC, BIG_AMT * 4,
            uint64(block.timestamp + EXPIRES_IN), false
        );

        // Sign two intents for 60 USDC each (together = 120 > 100 period limit... wait, period=60 USDC)
        // Actually: periodLimit = BIG_AMT = 60_000_000. Each intent = 60_000_000 → first fills bucket.
        // Let's set a 100 USDC period limit instead
        uint128 periodLim = 100_000_000;
        uint128 eachAmt   = 60_000_000;
        vm.prank(owner);
        account.setAgent(
            agent2, "a2", eachAmt, periodLim, PSEC, 400_000_000,
            uint64(block.timestamp + EXPIRES_IN), false
        );

        (AllowanceAccount.PaymentIntent memory intentA, bytes memory sigA) = _signIntent(
            agentKey2, agent2, payee1, eachAmt, 1, block.timestamp + 1 hours, bytes32(0), address(account)
        );
        (AllowanceAccount.PaymentIntent memory intentB, bytes memory sigB) = _signIntent(
            agentKey2, agent2, payee1, eachAmt, 2, block.timestamp + 1 hours, bytes32(0), address(account)
        );

        // First succeeds (60 <= 100)
        account.payWithSig(intentA, sigA);

        // Second fails: bucket has 40 left, but 60 requested
        vm.expectRevert(AllowanceAccount.OverPeriodLimit.selector);
        account.payWithSig(intentB, sigB);
    }

    // -----------------------------------------------------------------------
    // NonceUsed event emitted
    // -----------------------------------------------------------------------

    function test_payWithSig_nonceUsedEvent() public {
        (AllowanceAccount.PaymentIntent memory intent, bytes memory sig) = _signIntent(
            agentKey1, agent1, payee1, AMT, 5, block.timestamp + 1 hours, bytes32(0), address(account)
        );
        vm.expectEmit(true, false, false, true, address(account));
        emit AllowanceAccount.NonceUsed(agent1, 5);
        account.payWithSig(intent, sig);
    }

    // -----------------------------------------------------------------------
    // hashPaymentIntent matches manual computation
    // -----------------------------------------------------------------------

    function test_hashPaymentIntent_consistent() public view {
        AllowanceAccount.PaymentIntent memory intent = AllowanceAccount.PaymentIntent({
            agent:    agent1,
            payee:    payee1,
            amount:   AMT,
            nonce:    1,
            deadline: block.timestamp + 1 hours,
            ref:      bytes32("hello")
        });

        bytes32 onchain = account.hashPaymentIntent(intent);

        // Recompute manually
        bytes32 domainSep = keccak256(abi.encode(
            keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"),
            keccak256("Allowance"),
            keccak256("1"),
            block.chainid,
            address(account)
        ));
        bytes32 structHash = keccak256(abi.encode(
            PAYMENT_INTENT_TYPEHASH,
            intent.agent, intent.payee, intent.amount, intent.nonce, intent.deadline, intent.ref
        ));
        bytes32 expected = keccak256(abi.encodePacked("\x19\x01", domainSep, structHash));

        assertEq(onchain, expected);
    }
}
