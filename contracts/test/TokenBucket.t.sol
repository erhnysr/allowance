// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {AllowanceAccount} from "../AllowanceAccount.sol";
import {AllowanceTestBase} from "./TestHelpers.sol";

contract TokenBucketTest is AllowanceTestBase {

    // 1 USDC = 1_000_000 units, period = 1 day
    uint128 constant BUCKET_LIMIT = 1_000_000;
    uint32  constant DAY = 86_400;

    function setUp() public override {
        super.setUp();
        _fund(200_000_000); // 200 USDC
        // agent1: maxPerPayment=1_000_000, periodLimit=1_000_000, 1 day, totalLimit=1_000_000_000
        vm.prank(owner);
        account.setAgent(
            agent1, "a1", BUCKET_LIMIT, BUCKET_LIMIT, DAY, 1_000_000_000,
            uint64(block.timestamp + 365 days), false
        );
    }

    // -----------------------------------------------------------------------
    // Full bucket at start
    // -----------------------------------------------------------------------

    function test_bucket_fullAtStart() public view {
        (uint128 avail,,,) = account.availableNow(agent1);
        assertEq(avail, BUCKET_LIMIT);
    }

    // -----------------------------------------------------------------------
    // Partial refill after half a period
    // -----------------------------------------------------------------------

    function test_bucket_partialRefillAfterHalfPeriod() public {
        // Spend the whole bucket
        vm.prank(agent1);
        account.pay(payee1, BUCKET_LIMIT, bytes32(0));
        (uint128 availAfterSpend,,,) = account.availableNow(agent1);
        assertEq(availAfterSpend, 0);

        // Advance half a day
        vm.warp(block.timestamp + DAY / 2);

        // Should have earned back half
        (uint128 avail,,,) = account.availableNow(agent1);
        // Expect approximately BUCKET_LIMIT/2.  mulDiv(43200, 1_000_000, 86400) = 500_000
        assertEq(avail, BUCKET_LIMIT / 2);
    }

    // -----------------------------------------------------------------------
    // Never above periodLimit even after many periods
    // -----------------------------------------------------------------------

    function test_bucket_neverAbovePeriodLimit() public {
        // Spend some, then warp 5 full periods
        vm.prank(agent1);
        account.pay(payee1, 500_000, bytes32(0));

        vm.warp(block.timestamp + DAY * 5);

        (uint128 avail,,,) = account.availableNow(agent1);
        assertEq(avail, BUCKET_LIMIT); // capped at periodLimit
    }

    // -----------------------------------------------------------------------
    // Spend all, wait 1 second, only fractional refill
    // -----------------------------------------------------------------------

    function test_bucket_spendAll_wait1sec_fractionalRefill() public {
        vm.prank(agent1);
        account.pay(payee1, BUCKET_LIMIT, bytes32(0));

        vm.warp(block.timestamp + 1);

        // Should have earned exactly: mulDiv(1, 1_000_000, 86_400) = 11 (floor)
        uint256 expected = (1 * uint256(BUCKET_LIMIT)) / DAY;

        (uint128 avail,,,) = account.availableNow(agent1);
        assertEq(avail, uint128(expected));
    }

    // -----------------------------------------------------------------------
    // Bucket clamped on update (new periodLimit < current available)
    // -----------------------------------------------------------------------

    function test_bucket_clampedOnUpdate() public {
        // bucket = 1_000_000 (full), spend 400_000 → bucket = 600_000
        vm.prank(agent1);
        account.pay(payee1, 400_000, bytes32(0));
        (uint128 availBefore,,,) = account.availableNow(agent1);
        assertEq(availBefore, 600_000);

        // Update agent with periodLimit = 500_000 (less than current 600_000)
        vm.prank(owner);
        account.setAgent(
            agent1, "a1", 500_000, 500_000, DAY, 1_000_000_000,
            uint64(block.timestamp + 365 days), false
        );

        // bucket should be clamped to 500_000 (new periodLimit)
        (uint128 avail,,,) = account.availableNow(agent1);
        assertEq(avail, 500_000);
    }

    function test_bucket_updateToHigherLimit_bucketIsCurrentAvailable() public {
        // bucket = 1_000_000 (full), spend 600_000 → available = 400_000
        vm.prank(agent1);
        account.pay(payee1, 600_000, bytes32(0));

        // Update agent with periodLimit = 2_000_000 (larger)
        vm.prank(owner);
        account.setAgent(
            agent1, "a1", 1_000_000, 2_000_000, DAY, 1_000_000_000,
            uint64(block.timestamp + 365 days), false
        );

        // bucket should be min(400_000, 2_000_000) = 400_000
        (uint128 avail,,,) = account.availableNow(agent1);
        assertEq(avail, 400_000);
    }

    // -----------------------------------------------------------------------
    // No double-spend: bucket decrements per payment
    // -----------------------------------------------------------------------

    function test_bucket_doubleSpendBlocked() public {
        // Spend 600_000
        vm.prank(agent1);
        account.pay(payee1, 600_000, bytes32(0));

        // Try to spend 500_000 again — only 400_000 left in bucket
        vm.prank(agent1);
        vm.expectRevert(AllowanceAccount.OverPeriodLimit.selector);
        account.pay(payee1, 500_000, bytes32(0));
    }

    function test_bucket_exactSpendThenZero() public {
        vm.prank(agent1);
        account.pay(payee1, 1_000_000, bytes32(0));

        (uint128 avail,,,) = account.availableNow(agent1);
        assertEq(avail, 0);

        vm.prank(agent1);
        vm.expectRevert(AllowanceAccount.OverPeriodLimit.selector);
        account.pay(payee1, 1, bytes32(0));
    }

    // -----------------------------------------------------------------------
    // Multiple payments within a period — bucket tracks correctly
    // -----------------------------------------------------------------------

    function test_bucket_multiplePaymentsInPeriod() public {
        vm.prank(agent1);
        account.pay(payee1, 300_000, bytes32(0));
        vm.prank(agent1);
        account.pay(payee1, 300_000, bytes32(0));
        vm.prank(agent1);
        account.pay(payee1, 300_000, bytes32(0));

        (uint128 avail,,,) = account.availableNow(agent1);
        assertEq(avail, 100_000); // 1_000_000 - 900_000

        vm.prank(agent1);
        vm.expectRevert(AllowanceAccount.OverPeriodLimit.selector);
        account.pay(payee1, 100_001, bytes32(0));

        vm.prank(agent1);
        account.pay(payee1, 100_000, bytes32(0)); // exact amount succeeds
    }

    // -----------------------------------------------------------------------
    // totalLimit across many payments
    // -----------------------------------------------------------------------

    function test_totalLimit_acrossPayments() public {
        // Set agent with totalLimit = 3_000_000 (3 USDC)
        vm.prank(owner);
        account.setAgent(
            agent2, "a2", 1_000_000, 1_000_000, DAY, 3_000_000,
            uint64(block.timestamp + 365 days), false
        );

        for (uint256 i = 0; i < 3; i++) {
            vm.prank(agent2);
            account.pay(payee1, 1_000_000, bytes32(0));
            vm.warp(block.timestamp + DAY); // refill for next period
        }

        assertEq(account.getAgent(agent2).totalSpent, 3_000_000);

        // One more should fail
        vm.prank(agent2);
        vm.expectRevert(AllowanceAccount.OverTotalLimit.selector);
        account.pay(payee1, 1, bytes32(0));
    }

    function test_totalLimit_multipleAgents_independent() public {
        // Each agent has its own totalLimit
        vm.prank(owner);
        account.setAgent(
            agent2, "a2", 500_000, 500_000, DAY, 1_000_000,
            uint64(block.timestamp + 365 days), false
        );

        vm.prank(owner);
        account.setAgent(
            agent3, "a3", 500_000, 500_000, DAY, 2_000_000,
            uint64(block.timestamp + 365 days), false
        );

        // agent2 hits its limit
        vm.prank(agent2);
        account.pay(payee1, 500_000, bytes32(0));
        vm.warp(block.timestamp + DAY);
        vm.prank(agent2);
        account.pay(payee1, 500_000, bytes32(0));

        // Warp another day so bucket refills — totalLimit is exhausted so it still fails
        vm.warp(block.timestamp + DAY);
        vm.prank(agent2);
        vm.expectRevert(AllowanceAccount.OverTotalLimit.selector);
        account.pay(payee1, 1, bytes32(0));

        // agent3 can still pay
        vm.prank(agent3);
        account.pay(payee1, 500_000, bytes32(0));
    }

    // -----------------------------------------------------------------------
    // Per-payee cap holds across many payments
    // -----------------------------------------------------------------------

    function test_payeeCap_holdsAcrossPayments() public {
        // Set payee1 cap = 700_000 for agent1
        vm.prank(owner);
        account.setPayee(agent1, payee1, true, 700_000);

        vm.prank(agent1);
        account.pay(payee1, 300_000, bytes32(0));
        vm.warp(block.timestamp + DAY); // refill bucket
        vm.prank(agent1);
        account.pay(payee1, 300_000, bytes32(0));
        vm.warp(block.timestamp + DAY);
        vm.prank(agent1);
        account.pay(payee1, 100_000, bytes32(0)); // total = 700_000

        // Next 1 unit fails
        vm.warp(block.timestamp + DAY);
        vm.prank(agent1);
        vm.expectRevert(AllowanceAccount.OverPayeeCap.selector);
        account.pay(payee1, 1, bytes32(0));
    }

    function test_payeeCap_doesNotAffectDifferentPayee() public {
        vm.prank(owner);
        account.setPayee(agent1, payee1, true, 100_000);

        // Hit payee1 cap
        vm.prank(agent1);
        account.pay(payee1, 100_000, bytes32(0));
        vm.warp(block.timestamp + DAY);
        vm.prank(agent1);
        vm.expectRevert(AllowanceAccount.OverPayeeCap.selector);
        account.pay(payee1, 1, bytes32(0));

        // payee2 (unrestricted, no cap) still works
        vm.prank(agent1);
        account.pay(payee2, 100_000, bytes32(0));
    }

    function test_payeeCap_zero_meansNoCap() public {
        // cap = 0 means no cap (unlimited for that payee)
        vm.prank(owner);
        account.setPayee(agent1, payee1, true, 0);

        // Spend full bucket multiple times across periods
        for (uint256 i = 0; i < 5; i++) {
            vm.prank(agent1);
            account.pay(payee1, 1_000_000, bytes32(0));
            vm.warp(block.timestamp + DAY);
        }
        // totalSpent = 5_000_000 but no payee cap hit
        assertEq(account.getPayee(agent1, payee1).spent, 5_000_000);
    }

    // -----------------------------------------------------------------------
    // availableNow returns correct totalRemaining
    // -----------------------------------------------------------------------

    function test_availableNow_totalRemaining() public {
        vm.prank(owner);
        account.setAgent(
            agent2, "a2", 1_000_000, 1_000_000, DAY, 3_000_000,
            uint64(block.timestamp + 365 days), false
        );

        vm.prank(agent2);
        account.pay(payee1, 1_000_000, bytes32(0));

        (, uint128 totalRemaining,,) = account.availableNow(agent2);
        assertEq(totalRemaining, 2_000_000);
    }

    // -----------------------------------------------------------------------
    // Fix #9 / issue 9: document that within a single period the agent can
    // spend up to ~2x periodLimit — burst (initial full bucket) plus one
    // full period of gradual refill, but NEVER more than periodLimit at once.
    //
    // Scenario:
    //   periodLimit = 1_000_000,  periodSeconds = 1 day
    //   1) Agent spends the full bucket at t=0:              1_000_000
    //   2) Warp one full period (24 h):  bucket refills to   1_000_000
    //   3) Agent spends again:                                1_000_000
    //   Total in ~1 period window: 2_000_000 ≈ 2x periodLimit.
    //
    // This is expected token-bucket behaviour: the first burst is "free"
    // because the bucket started full.  totalLimit is the hard ceiling that
    // prevents unbounded accumulation across many periods.
    // -----------------------------------------------------------------------
    function test_bucket_within1Period_upTo2xBurst() public {
        uint128 PL  = 1_000_000;
        uint32  PS  = DAY;
        uint128 TOT = 10_000_000;   // totalLimit well above 2x so it doesn't interfere

        vm.prank(owner);
        account.setAgent(
            agent2, "burst", PL, PL, PS, TOT,
            uint64(block.timestamp + 365 days), false
        );

        // Step 1: spend the full initial bucket (burst)
        vm.prank(agent2);
        account.pay(payee1, PL, bytes32(0));
        assertEq(account.getAgent(agent2).totalSpent, PL);

        // Bucket is empty — any further spend reverts immediately
        vm.prank(agent2);
        vm.expectRevert(AllowanceAccount.OverPeriodLimit.selector);
        account.pay(payee1, 1, bytes32(0));

        // Step 2: warp exactly one full period — bucket refills to PL
        vm.warp(block.timestamp + PS);
        (uint128 avail,,,) = account.availableNow(agent2);
        assertEq(avail, PL, "bucket should be full after one period");

        // Step 3: spend the full refilled bucket
        vm.prank(agent2);
        account.pay(payee1, PL, bytes32(0));

        // Total spent in ≈1 period: 2 * periodLimit
        assertEq(account.getAgent(agent2).totalSpent, PL * 2);

        // But available immediately drops back to 0
        (uint128 availAfter,,,) = account.availableNow(agent2);
        assertEq(availAfter, 0, "bucket should be empty after second burst");

        // And available NEVER exceeds periodLimit, even with extra warp
        vm.warp(block.timestamp + 2 * PS);
        (uint128 availCapped,,,) = account.availableNow(agent2);
        assertEq(availCapped, PL, "available capped at periodLimit");
    }
}
