// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {AllowanceFactory} from "../AllowanceFactory.sol";
import {AllowanceAccount} from "../AllowanceAccount.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

// ---------------------------------------------------------------------------
// Minimal ERC-20 mock
// ---------------------------------------------------------------------------
contract MockERC20 {
    string public name = "Mock USDC";
    string public symbol = "USDC";
    uint8  public decimals = 6;

    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;

    event Transfer(address indexed from, address indexed to, uint256 value);
    event Approval(address indexed owner, address indexed spender, uint256 value);

    function mint(address to, uint256 amount) external {
        balanceOf[to] += amount;
        emit Transfer(address(0), to, amount);
    }

    function transfer(address to, uint256 amount) external returns (bool) {
        require(balanceOf[msg.sender] >= amount, "ERC20: insufficient balance");
        balanceOf[msg.sender] -= amount;
        balanceOf[to] += amount;
        emit Transfer(msg.sender, to, amount);
        return true;
    }

    function transferFrom(address from, address to, uint256 amount) external returns (bool) {
        require(balanceOf[from] >= amount, "ERC20: insufficient balance");
        require(allowance[from][msg.sender] >= amount, "ERC20: insufficient allowance");
        allowance[from][msg.sender] -= amount;
        balanceOf[from] -= amount;
        balanceOf[to] += amount;
        emit Transfer(from, to, amount);
        return true;
    }

    function approve(address spender, uint256 amount) external returns (bool) {
        allowance[msg.sender][spender] = amount;
        emit Approval(msg.sender, spender, amount);
        return true;
    }
}

// ---------------------------------------------------------------------------
// Base test fixture
// ---------------------------------------------------------------------------
abstract contract AllowanceTestBase is Test {
    MockERC20          internal usdc;
    AllowanceFactory   internal factory;
    AllowanceAccount   internal account;

    address internal owner   = makeAddr("owner");
    address internal guardian = makeAddr("guardian");
    address internal payee1  = makeAddr("payee1");
    address internal payee2  = makeAddr("payee2");
    address internal payee3  = makeAddr("payee3");
    address internal relayer = makeAddr("relayer");

    // Three agent keypairs
    uint256 internal agentKey1 = 0xA1;
    uint256 internal agentKey2 = 0xA2;
    uint256 internal agentKey3 = 0xA3;
    address internal agent1;
    address internal agent2;
    address internal agent3;

    // Default policy constants (6-decimal USDC)
    uint128 internal constant MAX_PER  = 500_000;      // 0.5 USDC
    uint128 internal constant PERIOD   = 1_000_000;    // 1 USDC / period
    uint32  internal constant PSEC     = 86_400;       // 1 day
    uint128 internal constant TOTAL    = 100_000_000;  // 100 USDC
    uint64  internal constant EXPIRES_IN = 30 days;

    bytes32 internal constant PAYMENT_INTENT_TYPEHASH =
        keccak256("PaymentIntent(address agent,address payee,uint256 amount,uint256 nonce,uint256 deadline,bytes32 ref)");

    function setUp() public virtual {
        agent1 = vm.addr(agentKey1);
        agent2 = vm.addr(agentKey2);
        agent3 = vm.addr(agentKey3);

        usdc = new MockERC20();
        factory = new AllowanceFactory(address(usdc));

        vm.prank(owner);
        account = AllowanceAccount(factory.createAccount(guardian));

        // Give owner plenty of USDC and approve
        usdc.mint(owner, 10_000_000_000);
        vm.prank(owner);
        usdc.approve(address(account), type(uint256).max);
    }

    // -----------------------------------------------------------------------
    // Helpers
    // -----------------------------------------------------------------------

    /// Fund the account with `amount` USDC (called as owner).
    function _fund(uint128 amount) internal {
        vm.prank(owner);
        account.fund(amount);
    }

    /// Set agent1 with default policy.
    function _setAgent1() internal {
        vm.prank(owner);
        account.setAgent(
            agent1,
            "agent-one",
            MAX_PER,
            PERIOD,
            PSEC,
            TOTAL,
            uint64(block.timestamp + EXPIRES_IN),
            false
        );
    }

    /// Set an agent with custom parameters.
    function _setAgentFull(
        address agent,
        string memory label,
        uint128 maxPer,
        uint128 periodLim,
        uint32  periodSec,
        uint128 totalLim,
        uint64  expiresAt,
        bool    payeeRestricted
    ) internal {
        vm.prank(owner);
        account.setAgent(agent, label, maxPer, periodLim, periodSec, totalLim, expiresAt, payeeRestricted);
    }

    /// Build and sign a PaymentIntent, return encoded sig bytes.
    function _signIntent(
        uint256 privKey,
        address _agent,
        address _payee,
        uint256 _amount,
        uint256 _nonce,
        uint256 _deadline,
        bytes32 _ref,
        address _account
    ) internal view returns (AllowanceAccount.PaymentIntent memory intent, bytes memory sig) {
        intent = AllowanceAccount.PaymentIntent({
            agent:    _agent,
            payee:    _payee,
            amount:   _amount,
            nonce:    _nonce,
            deadline: _deadline,
            ref:      _ref
        });

        bytes32 domainSep = keccak256(abi.encode(
            keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"),
            keccak256("Allowance"),
            keccak256("1"),
            block.chainid,
            _account
        ));
        bytes32 structHash = keccak256(abi.encode(
            PAYMENT_INTENT_TYPEHASH,
            _agent, _payee, _amount, _nonce, _deadline, _ref
        ));
        bytes32 digest = keccak256(abi.encodePacked("\x19\x01", domainSep, structHash));
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(privKey, digest);
        sig = abi.encodePacked(r, s, v);
    }
}
