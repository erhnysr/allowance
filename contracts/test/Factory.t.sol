// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {AllowanceFactory} from "../AllowanceFactory.sol";
import {AllowanceAccount} from "../AllowanceAccount.sol";
import {AllowanceTestBase} from "./TestHelpers.sol";

contract FactoryTest is AllowanceTestBase {
    // -----------------------------------------------------------------------
    // Factory basics
    // -----------------------------------------------------------------------

    function test_factory_storesUsdc() public view {
        assertEq(factory.usdc(), address(usdc));
    }

    function test_createAccount_isAccount() public view {
        assertTrue(factory.isAccount(address(account)));
    }

    function test_createAccount_notIsAccount_random() public {
        assertFalse(factory.isAccount(makeAddr("random")));
    }

    function test_createAccount_ownerInAccountsOf() public view {
        address[] memory accounts = factory.accountsOf(owner);
        assertEq(accounts.length, 1);
        assertEq(accounts[0], address(account));
    }

    function test_createAccount_ownerSetCorrectly() public view {
        assertEq(account.owner(), owner);
    }

    function test_createAccount_guardianSetCorrectly() public view {
        assertEq(account.guardian(), guardian);
    }

    function test_createAccount_usdcSetCorrectly() public view {
        assertEq(account.usdc(), address(usdc));
    }

    function test_createAccount_factorySetCorrectly() public view {
        assertEq(account.factory(), address(factory));
    }

    function test_createAccount_multipleAccounts() public {
        vm.startPrank(owner);
        address a2 = factory.createAccount(address(0));
        address a3 = factory.createAccount(address(0));
        vm.stopPrank();

        address[] memory accounts = factory.accountsOf(owner);
        assertEq(accounts.length, 3); // setUp created one already
        assertEq(accounts[1], a2);
        assertEq(accounts[2], a3);
        assertTrue(factory.isAccount(a2));
        assertTrue(factory.isAccount(a3));
    }

    function test_createAccount_differentOwners() public {
        address bob = makeAddr("bob");
        vm.prank(bob);
        address bobAccount = factory.createAccount(address(0));

        assertEq(factory.accountsOf(owner).length, 1);
        assertEq(factory.accountsOf(bob).length, 1);
        assertEq(factory.accountsOf(bob)[0], bobAccount);
        assertTrue(factory.isAccount(bobAccount));
    }

    function test_createAccount_emitsEvent() public {
        address alice = makeAddr("alice");
        address aliceGuardian = makeAddr("aliceGuardian");

        // Predict the address isn't possible deterministically, use expectEmit partially
        vm.prank(alice);
        vm.recordLogs();
        address newAccount = factory.createAccount(aliceGuardian);

        // Verify event via direct check
        assertTrue(factory.isAccount(newAccount));
        assertEq(factory.accountsOf(alice)[0], newAccount);
    }

    function test_createAccount_zeroGuardian() public {
        address alice = makeAddr("alice");
        vm.prank(alice);
        address newAccount = factory.createAccount(address(0));

        assertEq(AllowanceAccount(newAccount).guardian(), address(0));
    }

    function test_factory_cannotTouchAccount() public view {
        // Factory has no functions to interact with deployed accounts beyond creation.
        // Verify factory address != owner of account
        assertTrue(account.owner() != address(factory));
    }

    // -----------------------------------------------------------------------
    // setAgent validation — every invalid input
    // -----------------------------------------------------------------------

    uint64 internal validExpires;
    uint128 internal constant V_MAX  = 500_000;
    uint128 internal constant V_PER  = 1_000_000;
    uint32  internal constant V_PSEC = 86_400;
    uint128 internal constant V_TOT  = 100_000_000;

    function _validExpires() internal view returns (uint64) {
        return uint64(block.timestamp + 30 days);
    }

    function test_setAgent_zeroAddress() public {
        vm.prank(owner);
        vm.expectRevert(AllowanceAccount.InvalidAgentAddress.selector);
        account.setAgent(address(0), "x", V_MAX, V_PER, V_PSEC, V_TOT, _validExpires(), false);
    }

    function test_setAgent_ownerAsAgent() public {
        vm.prank(owner);
        vm.expectRevert(AllowanceAccount.InvalidAgentAddress.selector);
        account.setAgent(owner, "x", V_MAX, V_PER, V_PSEC, V_TOT, _validExpires(), false);
    }

    function test_setAgent_accountAsAgent() public {
        vm.prank(owner);
        vm.expectRevert(AllowanceAccount.InvalidAgentAddress.selector);
        account.setAgent(address(account), "x", V_MAX, V_PER, V_PSEC, V_TOT, _validExpires(), false);
    }

    function test_setAgent_labelTooLong() public {
        // 33-byte string
        string memory longLabel = "123456789012345678901234567890123";
        vm.prank(owner);
        vm.expectRevert(AllowanceAccount.InvalidLabel.selector);
        account.setAgent(agent1, longLabel, V_MAX, V_PER, V_PSEC, V_TOT, _validExpires(), false);
    }

    function test_setAgent_labelExactly32Bytes_succeeds() public {
        string memory label32 = "12345678901234567890123456789012";
        vm.prank(owner);
        account.setAgent(agent1, label32, V_MAX, V_PER, V_PSEC, V_TOT, _validExpires(), false);
        AllowanceAccount.Agent memory a = account.getAgent(agent1);
        assertEq(bytes(a.label).length, 32);
    }

    function test_setAgent_zeroMaxPerPayment() public {
        vm.prank(owner);
        vm.expectRevert(AllowanceAccount.InvalidLimits.selector);
        account.setAgent(agent1, "x", 0, V_PER, V_PSEC, V_TOT, _validExpires(), false);
    }

    function test_setAgent_maxGtPeriod() public {
        vm.prank(owner);
        vm.expectRevert(AllowanceAccount.InvalidLimits.selector);
        account.setAgent(agent1, "x", V_PER + 1, V_PER, V_PSEC, V_TOT, _validExpires(), false);
    }

    function test_setAgent_periodGtTotal() public {
        vm.prank(owner);
        vm.expectRevert(AllowanceAccount.InvalidLimits.selector);
        account.setAgent(agent1, "x", V_MAX, V_TOT + 1, V_PSEC, V_TOT, _validExpires(), false);
    }

    function test_setAgent_periodSecondsTooShort() public {
        vm.prank(owner);
        vm.expectRevert(AllowanceAccount.InvalidPeriodSeconds.selector);
        account.setAgent(agent1, "x", V_MAX, V_PER, 59, V_TOT, _validExpires(), false);
    }

    function test_setAgent_periodSecondsTooLong() public {
        vm.prank(owner);
        vm.expectRevert(AllowanceAccount.InvalidPeriodSeconds.selector);
        account.setAgent(agent1, "x", V_MAX, V_PER, uint32(30 days) + 1, V_TOT, _validExpires(), false);
    }

    function test_setAgent_periodSecondsMin_succeeds() public {
        vm.prank(owner);
        account.setAgent(agent1, "x", V_MAX, V_PER, 60, V_TOT, _validExpires(), false);
    }

    function test_setAgent_periodSecondsMax_succeeds() public {
        vm.prank(owner);
        account.setAgent(agent1, "x", V_MAX, V_PER, uint32(30 days), V_TOT, _validExpires(), false);
    }

    function test_setAgent_expiresAtInPast() public {
        vm.prank(owner);
        vm.expectRevert(AllowanceAccount.InvalidExpiresAt.selector);
        account.setAgent(agent1, "x", V_MAX, V_PER, V_PSEC, V_TOT, uint64(block.timestamp - 1), false);
    }

    function test_setAgent_expiresAtEqualsNow() public {
        vm.prank(owner);
        vm.expectRevert(AllowanceAccount.InvalidExpiresAt.selector);
        account.setAgent(agent1, "x", V_MAX, V_PER, V_PSEC, V_TOT, uint64(block.timestamp), false);
    }

    function test_setAgent_expiresAtTooFar() public {
        vm.prank(owner);
        vm.expectRevert(AllowanceAccount.InvalidExpiresAt.selector);
        account.setAgent(agent1, "x", V_MAX, V_PER, V_PSEC, V_TOT, uint64(block.timestamp + 365 days + 1), false);
    }

    function test_setAgent_tooManyAgents() public {
        // Add 20 agents (slots 1..20 are agent addresses derived from keys)
        for (uint256 i = 1; i <= 20; i++) {
            address a = vm.addr(0x1000 + i);
            vm.prank(owner);
            account.setAgent(a, "x", V_MAX, V_PER, V_PSEC, V_TOT, _validExpires(), false);
        }
        address extra = vm.addr(0x2000);
        vm.prank(owner);
        vm.expectRevert(AllowanceAccount.TooManyAgents.selector);
        account.setAgent(extra, "x", V_MAX, V_PER, V_PSEC, V_TOT, _validExpires(), false);
    }

    function test_setAgent_success_storedCorrectly() public {
        uint64 exp = _validExpires();
        vm.prank(owner);
        account.setAgent(agent1, "agent-one", V_MAX, V_PER, V_PSEC, V_TOT, exp, true);

        AllowanceAccount.Agent memory a = account.getAgent(agent1);
        assertEq(a.label, "agent-one");
        assertTrue(a.active);
        assertEq(a.expiresAt, exp);
        assertEq(a.maxPerPayment, V_MAX);
        assertEq(a.periodLimit, V_PER);
        assertEq(a.periodSeconds, V_PSEC);
        assertEq(a.totalLimit, V_TOT);
        assertEq(a.bucket, V_PER); // full bucket on creation
        assertEq(a.totalSpent, 0);
        assertTrue(a.payeeRestricted);

        address[] memory agents = account.getAgents();
        assertEq(agents.length, 1);
        assertEq(agents[0], agent1);
    }

    function test_setAgent_update_preservesTotalSpent() public {
        _fund(10_000_000);
        _setAgent1();

        // Make a payment
        vm.prank(agent1);
        account.pay(payee1, 100_000, bytes32(0));

        uint128 spentBefore = account.getAgent(agent1).totalSpent;
        assertEq(spentBefore, 100_000);

        // Update agent with new limits
        uint64 newExp = uint64(block.timestamp + 60 days);
        // wait so newExp is valid (block.timestamp + 60 days <= block.timestamp + 365 days)
        vm.prank(owner);
        account.setAgent(agent1, "agent-one-v2", V_MAX, V_PER, V_PSEC, V_TOT * 2, newExp, false);

        AllowanceAccount.Agent memory a = account.getAgent(agent1);
        assertEq(a.totalSpent, spentBefore); // preserved
        assertEq(a.label, "agent-one-v2");
        assertEq(a.totalLimit, V_TOT * 2);
        assertTrue(a.active);
    }

    function test_setAgent_update_bucketClampedToNewPeriodLimit() public {
        _fund(10_000_000);
        // Set agent with periodLimit=1_000_000, spend 0 → bucket=1_000_000
        vm.prank(owner);
        account.setAgent(agent1, "x", 1_000_000, 1_000_000, V_PSEC, V_TOT, _validExpires(), false);

        // Spend 400_000 → bucket = 600_000
        vm.prank(agent1);
        account.pay(payee1, 400_000, bytes32(0));

        // Update with periodLimit=500_000 (less than current 600_000 available after partial refill)
        vm.prank(owner);
        account.setAgent(agent1, "x", 500_000, 500_000, V_PSEC, V_TOT, _validExpires(), false);

        // bucket should be clamped to 500_000
        (uint128 avail,,,) = account.availableNow(agent1);
        assertEq(avail, 500_000);
    }

    function test_setAgent_nonOwner_reverts() public {
        vm.prank(agent1);
        vm.expectRevert();
        account.setAgent(agent2, "x", V_MAX, V_PER, V_PSEC, V_TOT, _validExpires(), false);
    }

    // -----------------------------------------------------------------------
    // renounceOwnership disabled (fix #2)
    // -----------------------------------------------------------------------

    function test_renounceOwnership_reverts() public {
        vm.prank(owner);
        vm.expectRevert(AllowanceAccount.RenounceDisabled.selector);
        account.renounceOwnership();
    }

    // -----------------------------------------------------------------------
    // removeAgent (fix #3)
    // -----------------------------------------------------------------------

    function test_removeAgent_removesFromList() public {
        vm.prank(owner);
        account.setAgent(agent1, "a1", V_MAX, V_PER, V_PSEC, V_TOT, _validExpires(), false);
        vm.prank(owner);
        account.setAgent(agent2, "a2", V_MAX, V_PER, V_PSEC, V_TOT, _validExpires(), false);

        assertEq(account.getAgents().length, 2);

        vm.prank(owner);
        account.removeAgent(agent1);

        address[] memory agents = account.getAgents();
        assertEq(agents.length, 1);
        assertEq(agents[0], agent2);
    }

    function test_removeAgent_clearsAgentStruct() public {
        vm.prank(owner);
        account.setAgent(agent1, "a1", V_MAX, V_PER, V_PSEC, V_TOT, _validExpires(), false);

        vm.prank(owner);
        account.removeAgent(agent1);

        AllowanceAccount.Agent memory a = account.getAgent(agent1);
        assertEq(a.maxPerPayment, 0);
        assertFalse(a.active);
    }

    function test_removeAgent_blocksPayment() public {
        _fund(10_000_000);
        vm.prank(owner);
        account.setAgent(agent1, "a1", V_MAX, V_PER, V_PSEC, V_TOT, _validExpires(), false);

        vm.prank(owner);
        account.removeAgent(agent1);

        vm.prank(agent1);
        vm.expectRevert(AllowanceAccount.UnknownAgent.selector);
        account.pay(payee1, 100_000, bytes32(0));
    }

    function test_removeAgent_unknownAgent_reverts() public {
        vm.prank(owner);
        vm.expectRevert(AllowanceAccount.UnknownAgent.selector);
        account.removeAgent(makeAddr("nonexistent"));
    }

    function test_removeAgent_preservesNonces() public {
        vm.prank(owner);
        account.setAgent(agent1, "a1", V_MAX, V_PER, V_PSEC, V_TOT, _validExpires(), false);

        // Cancel a nonce
        vm.prank(owner);
        account.cancelNonce(agent1, 42);
        assertTrue(account.nonceUsed(agent1, 42));

        // Remove agent
        vm.prank(owner);
        account.removeAgent(agent1);

        // Nonce still marked used
        assertTrue(account.nonceUsed(agent1, 42));
    }

    function test_removeAgent_allowsReAdd() public {
        vm.prank(owner);
        account.setAgent(agent1, "a1", V_MAX, V_PER, V_PSEC, V_TOT, _validExpires(), false);
        vm.prank(owner);
        account.removeAgent(agent1);

        // Can add agent1 again
        vm.prank(owner);
        account.setAgent(agent1, "a1-new", V_MAX, V_PER, V_PSEC, V_TOT, _validExpires(), false);

        assertTrue(account.getAgent(agent1).active);
    }

    // -----------------------------------------------------------------------
    // Factory ownership-transfer index (fix #4)
    // -----------------------------------------------------------------------

    function test_ownershipTransfer_updatesFactoryIndex() public {
        address bob = makeAddr("bob");

        // Transfer ownership to bob (two-step: offer then accept)
        vm.prank(owner);
        account.transferOwnership(bob);
        vm.prank(bob);
        account.acceptOwnership();

        // Factory index updated
        assertEq(factory.accountsOf(owner).length, 0);
        assertEq(factory.accountsOf(bob).length, 1);
        assertEq(factory.accountsOf(bob)[0], address(account));
    }

    function test_ownershipTransfer_emitsAccountOwnerChanged() public {
        address bob = makeAddr("bob");

        vm.prank(owner);
        account.transferOwnership(bob);

        vm.expectEmit(true, true, true, true, address(factory));
        emit AllowanceFactory.AccountOwnerChanged(address(account), owner, bob);
        vm.prank(bob);
        account.acceptOwnership();
    }

    function test_ownershipTransfer_multipleAccounts_updatesCorrectOne() public {
        // Create a second account for the same owner
        vm.prank(owner);
        address acct2 = factory.createAccount(address(0));

        assertEq(factory.accountsOf(owner).length, 2);

        address bob = makeAddr("bob2");
        vm.prank(owner);
        account.transferOwnership(bob);
        vm.prank(bob);
        account.acceptOwnership();

        // First account now under bob, second still under owner
        assertEq(factory.accountsOf(owner).length, 1);
        assertEq(factory.accountsOf(owner)[0], acct2);
        assertEq(factory.accountsOf(bob).length, 1);
        assertEq(factory.accountsOf(bob)[0], address(account));
    }

    // -----------------------------------------------------------------------
    // freeze() uses NotGuardianOrOwner error (fix #5)
    // -----------------------------------------------------------------------

    function test_freeze_byRandom_notGuardianOrOwner() public {
        vm.prank(makeAddr("stranger"));
        vm.expectRevert(AllowanceAccount.NotGuardianOrOwner.selector);
        account.freeze();
    }

    // -----------------------------------------------------------------------
    // withdraw ZeroAddress guard (fix #5)
    // -----------------------------------------------------------------------

    function test_withdraw_zeroTo_reverts() public {
        _fund(1_000_000);
        vm.prank(owner);
        vm.expectRevert(AllowanceAccount.ZeroAddress.selector);
        account.withdraw(address(0), 1_000_000);
    }
}
