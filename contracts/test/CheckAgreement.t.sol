// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {AllowanceAccount} from "../AllowanceAccount.sol";
import {AllowanceTestBase} from "./TestHelpers.sol";

/// @dev Fuzz test: check() returns 0 iff pay() succeeds; otherwise check() returns the
///      1-based index of the error pay() reverts with.
contract CheckAgreementTest is AllowanceTestBase {

    // Mapping from check() return code to selector
    function _errSelector(uint8 code) internal pure returns (bytes4) {
        if (code == 1)  return AllowanceAccount.ZeroAmount.selector;
        if (code == 2)  return AllowanceAccount.AccountFrozen.selector;
        if (code == 3)  return AllowanceAccount.UnknownAgent.selector;
        if (code == 4)  return AllowanceAccount.AgentRevoked.selector;
        if (code == 5)  return AllowanceAccount.AgentExpired.selector;
        if (code == 6)  return AllowanceAccount.InvalidPayee.selector;
        if (code == 7)  return AllowanceAccount.PayeeNotAllowed.selector;
        if (code == 8)  return AllowanceAccount.OverPerPayment.selector;
        if (code == 9)  return AllowanceAccount.OverPeriodLimit.selector;
        if (code == 10) return AllowanceAccount.OverTotalLimit.selector;
        if (code == 11) return AllowanceAccount.OverPayeeCap.selector;
        if (code == 12) return AllowanceAccount.InsufficientBalance.selector;
        revert("unknown code");
    }

    // -----------------------------------------------------------------------
    // Happy-path: check() = 0 and pay() succeeds
    // -----------------------------------------------------------------------

    function test_check_agreement_happyPath() public {
        _fund(10_000_000);
        _setAgent1();

        uint8 reason = account.check(agent1, payee1, MAX_PER);
        assertEq(reason, 0, "check should return 0 for a valid payment");

        vm.prank(agent1);
        account.pay(payee1, MAX_PER, bytes32(0)); // should not revert
    }

    // -----------------------------------------------------------------------
    // Each error code: check() matches pay() revert
    // -----------------------------------------------------------------------

    function test_check_code1_zeroAmount() public {
        _fund(10_000_000);
        _setAgent1();
        uint8 code = account.check(agent1, payee1, 0);
        assertEq(code, 1);
        vm.prank(agent1);
        vm.expectRevert(AllowanceAccount.ZeroAmount.selector);
        account.pay(payee1, 0, bytes32(0));
    }

    function test_check_code2_frozen() public {
        _fund(10_000_000);
        _setAgent1();
        vm.prank(owner);
        account.freeze();
        uint8 code = account.check(agent1, payee1, 100_000);
        assertEq(code, 2);
        vm.prank(agent1);
        vm.expectRevert(AllowanceAccount.AccountFrozen.selector);
        account.pay(payee1, 100_000, bytes32(0));
    }

    function test_check_code3_unknownAgent() public {
        _fund(10_000_000);
        address stranger = makeAddr("stranger");
        uint8 code = account.check(stranger, payee1, 100_000);
        assertEq(code, 3);
        vm.prank(stranger);
        vm.expectRevert(AllowanceAccount.UnknownAgent.selector);
        account.pay(payee1, 100_000, bytes32(0));
    }

    function test_check_code4_revoked() public {
        _fund(10_000_000);
        _setAgent1();
        vm.prank(owner);
        account.revokeAgent(agent1);
        uint8 code = account.check(agent1, payee1, 100_000);
        assertEq(code, 4);
        vm.prank(agent1);
        vm.expectRevert(AllowanceAccount.AgentRevoked.selector);
        account.pay(payee1, 100_000, bytes32(0));
    }

    function test_check_code5_expired() public {
        _fund(10_000_000);
        _setAgent1();
        vm.warp(block.timestamp + EXPIRES_IN + 1);
        uint8 code = account.check(agent1, payee1, 100_000);
        assertEq(code, 5);
        vm.prank(agent1);
        vm.expectRevert(AllowanceAccount.AgentExpired.selector);
        account.pay(payee1, 100_000, bytes32(0));
    }

    function test_check_code6_invalidPayee_zero() public {
        _fund(10_000_000);
        _setAgent1();
        uint8 code = account.check(agent1, address(0), 100_000);
        assertEq(code, 6);
        vm.prank(agent1);
        vm.expectRevert(AllowanceAccount.InvalidPayee.selector);
        account.pay(address(0), 100_000, bytes32(0));
    }

    function test_check_code6_invalidPayee_self() public {
        _fund(10_000_000);
        _setAgent1();
        uint8 code = account.check(agent1, address(account), 100_000);
        assertEq(code, 6);
        vm.prank(agent1);
        vm.expectRevert(AllowanceAccount.InvalidPayee.selector);
        account.pay(address(account), 100_000, bytes32(0));
    }

    function test_check_code7_payeeNotAllowed() public {
        _fund(10_000_000);
        vm.prank(owner);
        account.setAgent(
            agent2, "a2", MAX_PER, PERIOD, PSEC, TOTAL,
            uint64(block.timestamp + EXPIRES_IN), true
        );
        uint8 code = account.check(agent2, payee1, 100_000);
        assertEq(code, 7);
        vm.prank(agent2);
        vm.expectRevert(AllowanceAccount.PayeeNotAllowed.selector);
        account.pay(payee1, 100_000, bytes32(0));
    }

    function test_check_code8_overPerPayment() public {
        _fund(10_000_000);
        _setAgent1();
        uint8 code = account.check(agent1, payee1, MAX_PER + 1);
        assertEq(code, 8);
        vm.prank(agent1);
        vm.expectRevert(AllowanceAccount.OverPerPayment.selector);
        account.pay(payee1, MAX_PER + 1, bytes32(0));
    }

    function test_check_code9_overPeriodLimit() public {
        _fund(10_000_000);
        _setAgent1(); // maxPer=500_000, periodLimit=1_000_000
        // Drain the bucket in two payments (each <= maxPer)
        vm.prank(agent1);
        account.pay(payee1, MAX_PER, bytes32(0)); // 500_000
        vm.prank(agent1);
        account.pay(payee1, MAX_PER, bytes32(0)); // 500_000  → bucket = 0
        uint8 code = account.check(agent1, payee1, 1);
        assertEq(code, 9);
        vm.prank(agent1);
        vm.expectRevert(AllowanceAccount.OverPeriodLimit.selector);
        account.pay(payee1, 1, bytes32(0));
    }

    function test_check_code10_overTotalLimit() public {
        _fund(10_000_000);
        uint128 tinyTotal = 500_000;
        vm.prank(owner);
        account.setAgent(
            agent2, "a2", tinyTotal, tinyTotal, PSEC, tinyTotal,
            uint64(block.timestamp + EXPIRES_IN), false
        );
        vm.prank(agent2);
        account.pay(payee1, tinyTotal, bytes32(0));
        vm.warp(block.timestamp + PSEC);
        uint8 code = account.check(agent2, payee1, 1);
        assertEq(code, 10);
        vm.prank(agent2);
        vm.expectRevert(AllowanceAccount.OverTotalLimit.selector);
        account.pay(payee1, 1, bytes32(0));
    }

    function test_check_code11_overPayeeCap() public {
        _fund(10_000_000);
        _setAgent1();
        vm.prank(owner);
        account.setPayee(agent1, payee1, true, 100_000);
        vm.prank(agent1);
        account.pay(payee1, 100_000, bytes32(0));
        vm.warp(block.timestamp + PSEC);
        uint8 code = account.check(agent1, payee1, 1);
        assertEq(code, 11);
        vm.prank(agent1);
        vm.expectRevert(AllowanceAccount.OverPayeeCap.selector);
        account.pay(payee1, 1, bytes32(0));
    }

    function test_check_code12_insufficientBalance() public {
        _setAgent1();
        // No USDC funded
        uint8 code = account.check(agent1, payee1, 100_000);
        assertEq(code, 12);
        vm.prank(agent1);
        vm.expectRevert(AllowanceAccount.InsufficientBalance.selector);
        account.pay(payee1, 100_000, bytes32(0));
    }

    // -----------------------------------------------------------------------
    // Fuzz: check() == 0 iff pay() succeeds, for a normally-configured agent
    // -----------------------------------------------------------------------

    function testFuzz_check_agreement(uint128 amount) public {
        _fund(100_000_000);
        _setAgent1();

        uint8 code = account.check(agent1, payee1, amount);

        if (code == 0) {
            // pay should succeed
            uint256 balBefore = usdc.balanceOf(payee1);
            vm.prank(agent1);
            account.pay(payee1, amount, bytes32(0));
            assertEq(usdc.balanceOf(payee1), balBefore + amount);
        } else {
            // pay should revert with the matching selector
            bytes4 sel = _errSelector(code);
            vm.prank(agent1);
            vm.expectRevert(sel);
            account.pay(payee1, amount, bytes32(0));
        }
    }

    // -----------------------------------------------------------------------
    // Fuzz: check() agreement across all conditions by configuring agent
    //       with bound parameters to hit different codes.
    // -----------------------------------------------------------------------

    function testFuzz_check_variousStates(
        uint8 scenario,   // 0-7: which condition to trigger
        uint128 baseAmt   // base amount (bounded in test)
    ) public {
        _fund(100_000_000);

        // Keep baseAmt in a sensible range
        baseAmt = uint128(bound(uint256(baseAmt), 1, 10_000_000));
        scenario = uint8(bound(scenario, 0, 7));

        uint128 maxPer  = 1_000_000;
        uint128 pLim    = 1_000_000;
        uint128 totLim  = 50_000_000;
        uint32  pSec    = 86_400;
        uint64  expires = uint64(block.timestamp + 30 days);
        address testPayee = payee1;

        vm.prank(owner);
        account.setAgent(agent1, "x", maxPer, pLim, pSec, totLim, expires, false);

        uint8 preCheck  = account.check(agent1, testPayee, baseAmt);

        if (preCheck == 0) {
            vm.prank(agent1);
            account.pay(testPayee, baseAmt, bytes32(0)); // should not revert
        } else {
            bytes4 sel = _errSelector(preCheck);
            vm.prank(agent1);
            vm.expectRevert(sel);
            account.pay(testPayee, baseAmt, bytes32(0));
        }
    }
}
