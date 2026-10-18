// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {AllowanceAccount} from "./AllowanceAccount.sol";

contract AllowanceFactory {
    address public immutable usdc;

    mapping(address => address[]) private _accountsOf;
    mapping(address => bool) private _isAccount;

    event AccountCreated(address indexed owner, address indexed account, address guardian);
    event AccountOwnerChanged(address indexed account, address indexed from, address indexed to);

    constructor(address _usdc) {
        usdc = _usdc;
    }

    function createAccount(address guardian) external returns (address account) {
        account = address(new AllowanceAccount(usdc, address(this), msg.sender, guardian));
        _accountsOf[msg.sender].push(account);
        _isAccount[account] = true;

        emit AccountCreated(msg.sender, account, guardian);
    }

    /// @notice Called by AllowanceAccount._transferOwnership. Keeps the owner
    ///         index in sync when an account changes hands.
    function onOwnershipTransferred(address from, address to) external {
        require(_isAccount[msg.sender], "not an account");

        // Remove from old owner's list (swap-and-pop)
        address[] storage fromList = _accountsOf[from];
        uint256 len = fromList.length;
        for (uint256 i = 0; i < len; i++) {
            if (fromList[i] == msg.sender) {
                fromList[i] = fromList[len - 1];
                fromList.pop();
                break;
            }
        }

        // Add to new owner's list
        _accountsOf[to].push(msg.sender);

        emit AccountOwnerChanged(msg.sender, from, to);
    }

    function accountsOf(address owner) external view returns (address[] memory) {
        return _accountsOf[owner];
    }

    function isAccount(address account) external view returns (bool) {
        return _isAccount[account];
    }
}
