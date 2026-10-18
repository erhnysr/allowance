// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {AllowanceAccount} from "../AllowanceAccount.sol";
import {AllowanceTestBase, MockERC20} from "./TestHelpers.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

// ---------------------------------------------------------------------------
// Malicious ERC-1271 agent that tries to re-enter payWithSig inside
// isValidSignature().
//
// SignatureChecker calls isValidSignature via staticcall. Any state write
// inside it aborts the staticcall, so the signature is reported invalid
// and the outer payWithSig reverts with InvalidSignature. No funds move.
// ---------------------------------------------------------------------------
contract MaliciousERC1271Agent {
    AllowanceAccount public account;
    AllowanceAccount.PaymentIntent public reentrantIntent;
    bytes public reentrantSig;
    bool public innerReverted;

    bytes4 constant ERC1271_MAGIC = 0x1626ba7e;

    constructor(AllowanceAccount _account) {
        account = _account;
    }

    function setReentrantCall(
        AllowanceAccount.PaymentIntent calldata intent,
        bytes calldata sig
    ) external {
        reentrantIntent = intent;
        reentrantSig    = sig;
    }

    /// isValidSignature is called via staticcall by SignatureChecker.
    /// Any state-modifying operation inside here reverts within the staticcall.
    function isValidSignature(bytes32, bytes memory) external returns (bytes4) {
        try account.payWithSig(reentrantIntent, reentrantSig) {
            // cannot succeed (state-write in staticcall OR reentrancy)
        } catch {
            innerReverted = true;
        }
        return ERC1271_MAGIC;
    }
}

// ---------------------------------------------------------------------------
// Malicious ERC-20 whose transfer() re-enters pay() from the account.
//
// Fix #7: the token (this contract) IS registered as the agent so that when
// transfer() calls account.pay(), the call proceeds past UnknownAgent and
// hits the ReentrancyGuard.  We assert:
//   - innerReverted == true (ReentrancyGuardReentrantCall)
//   - totalPaid == exactly one payment (no double-spend)
// ---------------------------------------------------------------------------
contract ReentrantERC20 {
    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;
    uint8 public decimals = 6;

    // Set after deployment (avoid chicken-and-egg: account needs token address,
    // token needs account address).
    AllowanceAccount public account;
    address public victim;
    bool private _attacking;

    bool public innerReverted;
    bytes4 public innerRevertSelector;

    event Transfer(address indexed from, address indexed to, uint256 value);
    event Approval(address indexed owner, address indexed spender, uint256 value);

    constructor(address _victim) {
        victim = _victim;
    }

    function setAccount(AllowanceAccount _account) external {
        account = _account;
    }

    function mint(address to, uint256 amount) external {
        balanceOf[to] += amount;
        emit Transfer(address(0), to, amount);
    }

    function approve(address spender, uint256 amount) external returns (bool) {
        allowance[msg.sender][spender] = amount;
        emit Approval(msg.sender, spender, amount);
        return true;
    }

    function transferFrom(address from, address to, uint256 amount) external returns (bool) {
        require(balanceOf[from] >= amount, "insuf");
        require(allowance[from][msg.sender] >= amount, "allowance");
        allowance[from][msg.sender] -= amount;
        balanceOf[from] -= amount;
        balanceOf[to] += amount;
        emit Transfer(from, to, amount);
        return true;
    }

    /// Payout hook: called when the account transfers tokens to a payee.
    /// Attempt re-entry into pay() — the token itself is the agent.
    function transfer(address to, uint256 amount) external returns (bool) {
        require(balanceOf[msg.sender] >= amount, "insuf");
        balanceOf[msg.sender] -= amount;
        balanceOf[to] += amount;
        emit Transfer(msg.sender, to, amount);

        if (!_attacking && msg.sender == address(account)) {
            _attacking = true;
            // This call: sender = address(this) = the agent = the token.
            // ReentrancyGuard fires because we are inside pay() already.
            try account.pay(victim, uint128(amount), bytes32(0)) {
                // must not succeed
            } catch (bytes memory reason) {
                innerReverted = true;
                if (reason.length >= 4) {
                    bytes4 sel;
                    assembly { sel := mload(add(reason, 32)) }
                    innerRevertSelector = sel;
                }
            }
            _attacking = false;
        }
        return true;
    }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
contract ReentrancyTest is AllowanceTestBase {

    // -----------------------------------------------------------------------
    // Fix #6: ERC-1271 re-entry attempt.
    // SignatureChecker calls isValidSignature via staticcall. Any state write
    // inside it aborts the staticcall, so the signature is reported invalid
    // and the outer payWithSig reverts with InvalidSignature. No funds move.
    // -----------------------------------------------------------------------
    function test_reentrancy_erc1271_blocked() public {
        _fund(50_000_000);

        MaliciousERC1271Agent malAgent = new MaliciousERC1271Agent(account);

        vm.prank(owner);
        account.setAgent(
            address(malAgent), "mal", MAX_PER, PERIOD, PSEC, TOTAL,
            uint64(block.timestamp + EXPIRES_IN), false
        );

        AllowanceAccount.PaymentIntent memory outerIntent = AllowanceAccount.PaymentIntent({
            agent:    address(malAgent),
            payee:    payee1,
            amount:   MAX_PER,
            nonce:    1,
            deadline: block.timestamp + 1 hours,
            ref:      bytes32(0)
        });
        AllowanceAccount.PaymentIntent memory innerIntent = AllowanceAccount.PaymentIntent({
            agent:    address(malAgent),
            payee:    payee1,
            amount:   MAX_PER,
            nonce:    2,
            deadline: block.timestamp + 1 hours,
            ref:      bytes32(0)
        });
        malAgent.setReentrantCall(innerIntent, new bytes(65));

        uint256 balBefore = usdc.balanceOf(address(account));

        // The outer call must revert with InvalidSignature.
        // SignatureChecker.isValidSignatureNow calls isValidSignature via
        // staticcall; that staticcall contains a state-modifying call
        // (payWithSig) which causes the staticcall itself to revert, so
        // isValidSignatureNow returns false → InvalidSignature.
        vm.expectRevert(AllowanceAccount.InvalidSignature.selector);
        account.payWithSig(outerIntent, new bytes(65));

        // No funds moved
        assertEq(usdc.balanceOf(address(account)), balBefore, "funds moved despite revert");
    }

    // -----------------------------------------------------------------------
    // Fix #7: Reentrant ERC-20 (token = agent).
    //         The inner pay() call hits ReentrancyGuard and reverts.
    //         Outer pay() completes; totalPaid == exactly one payment.
    // -----------------------------------------------------------------------
    function test_reentrancy_payee_blocked() public {
        // 1. Deploy the malicious token (victim = payee1)
        ReentrantERC20 badUsdc = new ReentrantERC20(payee1);

        // 2. Deploy a fresh AllowanceAccount that uses badUsdc
        AllowanceAccount badAccount = new AllowanceAccount(
            address(badUsdc), address(factory), owner, address(0)
        );

        // 3. Wire the token back to the account
        badUsdc.setAccount(badAccount);

        // 4. Mint + fund
        badUsdc.mint(owner, 10_000_000);
        vm.prank(owner);
        badUsdc.approve(address(badAccount), type(uint256).max);
        vm.prank(owner);
        badAccount.fund(10_000_000);

        // 5. Register the token itself as the agent (address(badUsdc) == agent)
        //    so the inner pay(victim, amount, 0) call inside transfer() is sent
        //    by address(badUsdc) which is a known agent, reaching ReentrancyGuard.
        vm.prank(owner);
        badAccount.setAgent(
            address(badUsdc), "rogue", MAX_PER, PERIOD, PSEC, TOTAL,
            uint64(block.timestamp + EXPIRES_IN), false
        );

        // 6. The outer pay() is called AS the malicious token (it is the agent).
        //    During the safeTransfer payout, transfer() re-enters pay().
        vm.prank(address(badUsdc));
        badAccount.pay(payee1, 100_000, bytes32(0));

        // 7. Inner re-entry must have hit ReentrancyGuard with the exact selector
        assertTrue(badUsdc.innerReverted(), "inner re-entry should have reverted");
        assertEq(
            badUsdc.innerRevertSelector(),
            bytes4(keccak256("ReentrancyGuardReentrantCall()")),
            "inner revert selector must be ReentrancyGuardReentrantCall"
        );

        // 8. Only one payment completed
        assertEq(badAccount.totalPaid(), 100_000, "totalPaid should be exactly one payment");
    }
}
