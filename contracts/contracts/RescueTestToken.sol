// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {ERC20Capped} from "@openzeppelin/contracts/token/ERC20/extensions/ERC20Capped.sol";
import {ERC20Burnable} from "@openzeppelin/contracts/token/ERC20/extensions/ERC20Burnable.sol";
import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";

/// The shared main token of the Little Rescue games, TESTNET ONLY (Base Sepolia). It has no value.
/// Rules from the token plan: fixed total supply (cap), a daily mint cap for the whole system, and every mint
/// carries a claim ref that can be used once, so a retried server request never pays twice.
/// Anyone can burn their own tokens (the plan's "sinks").
contract RescueTestToken is ERC20Capped, ERC20Burnable, AccessControl {
    bytes32 public constant MINTER_ROLE = keccak256("MINTER_ROLE");

    uint256 public immutable dailyCap;
    mapping(uint256 day => uint256) public mintedOnDay;
    mapping(bytes32 ref => bool) public usedRef;

    error TestnetOnly(uint256 chainId);
    error DailyCapExceeded(uint256 requested, uint256 remaining);
    error RefUsed(bytes32 ref);

    event Claimed(address indexed to, uint256 amount, bytes32 indexed ref);

    constructor(address admin, uint256 cap_, uint256 dailyCap_)
        ERC20("Little Rescue Test Token", "tLRT")
        ERC20Capped(cap_)
    {
        // 84532 = Base Sepolia, 31337 = the local test chain. Never deployable on a real-money chain.
        if (block.chainid != 84532 && block.chainid != 31337) revert TestnetOnly(block.chainid);
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        _grantRole(MINTER_ROLE, admin);
        dailyCap = dailyCap_;
    }

    /// Days since 1970-01-01 UTC.
    function today() public view returns (uint256) {
        return block.timestamp / 1 days;
    }

    function remainingToday() public view returns (uint256) {
        uint256 minted = mintedOnDay[today()];
        return minted >= dailyCap ? 0 : dailyCap - minted;
    }

    function mint(address to, uint256 amount, bytes32 ref) external onlyRole(MINTER_ROLE) {
        if (usedRef[ref]) revert RefUsed(ref);
        uint256 left = remainingToday();
        if (amount > left) revert DailyCapExceeded(amount, left);
        usedRef[ref] = true;
        mintedOnDay[today()] += amount;
        _mint(to, amount);
        emit Claimed(to, amount, ref);
    }

    function _update(address from, address to, uint256 value) internal override(ERC20, ERC20Capped) {
        super._update(from, to, value);
    }
}
