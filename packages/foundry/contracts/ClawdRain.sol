// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

// CLAWD Rain — a community tipping tool built by a CLAWD community member
// using LeftClaw Services beta.
//
// To the CLAWD core team: if you like this idea and want to build a
// production-grade version, consider this a proof of concept — take it
// and run with it. Would love to see it done right.
//
// One thing this version doesn't do: integrate with the larv.ai staking
// contract (0xC9E377FB98a1aA6Ecf4B553cE1b57940121213bf). Eligibility here
// is based on wallet balance, not stake — meaning larv.ai stakers aren't
// covered unless they also hold 1M in their wallet. A production version
// could read totalStaked() and getActiveStakes() from the larv.ai contract
// to include stakers and use their real stake duration for weighting.
// That's the version this community deserves.
//
// Use at your own risk.

import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { SafeERC20 } from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

/// @title CLAWD Rain — duration-weighted random tipping for CLAWD holders
contract ClawdRain {
    using SafeERC20 for IERC20;

    struct UserInfo {
        uint64 timestamp; // when the user registered
        uint64 arrayIndex; // index in registeredUsers
        bool registered; // explicit flag — disambiguates the zero-timestamp case
    }

    IERC20 public immutable clawdToken;

    uint256 public constant MIN_BALANCE = 1_000_000 * 1e18;
    uint256 public constant MIN_TIP = 10_000 * 1e18;
    uint256 public constant MAX_MESSAGE_LENGTH = 280;

    address[] public registeredUsers;
    mapping(address => UserInfo) public userInfo;

    event ItsRainingClawd(
        address indexed rainmaker,
        uint256 amount,
        string message,
        address indexed winner,
        uint256 winnerDuration,
        uint256 timestamp
    );
    event SteppedIntoTheRain(address indexed user, uint256 timestamp);
    event LeftTheRain(address indexed user);
    event DroppedBelowThreshold(address indexed user);

    error AlreadyRegistered();
    error NotRegistered();
    error InsufficientBalance();
    error TipTooSmall();
    error MessageTooLong();
    error NoEligibleUsers();
    error SelfTipNotAllowed();

    constructor(address _clawdToken) {
        clawdToken = IERC20(_clawdToken);
    }

    /// @notice Step into the rain. Caller must hold at least MIN_BALANCE of CLAWD.
    function register() external {
        if (userInfo[msg.sender].registered) revert AlreadyRegistered();
        if (clawdToken.balanceOf(msg.sender) < MIN_BALANCE) revert InsufficientBalance();

        userInfo[msg.sender] = UserInfo({
            timestamp: uint64(block.timestamp),
            arrayIndex: uint64(registeredUsers.length),
            registered: true
        });
        registeredUsers.push(msg.sender);

        emit SteppedIntoTheRain(msg.sender, block.timestamp);
    }

    /// @notice Leave the rain. Swap-and-pop removal; the swapped user gets their arrayIndex updated.
    function unregister() external {
        if (!userInfo[msg.sender].registered) revert NotRegistered();
        _removeUser(msg.sender);
        emit LeftTheRain(msg.sender);
    }

    /// @notice Tips CLAWD into the contract. One eligible registered user is randomly
    ///         selected (weighted by registration duration) to receive the entire amount.
    /// @dev Randomness: derived from block.prevrandao + blockhash + tx context. This is
    ///      NOT VRF-grade. A motivated rainmaker can grind outcomes by simulating tip()
    ///      offchain and only broadcasting when a preferred winner is selected. Tipping
    ///      yourself is blocked, but a tipper colluding with a recipient could still
    ///      bias outcomes. For higher-stakes use, integrate Chainlink VRF (out of scope
    ///      for this prototype). See README "Security Notes" for full discussion.
    /// @dev Cleanup pass removes users who have fallen below MIN_BALANCE before drawing.
    /// @param amount     CLAWD amount to send (must be >= MIN_TIP). Caller must approve this contract.
    /// @param message    Free-form message attached to the event (<= MAX_MESSAGE_LENGTH bytes).
    function tip(uint256 amount, string calldata message) external {
        if (amount < MIN_TIP) revert TipTooSmall();
        if (bytes(message).length > MAX_MESSAGE_LENGTH) revert MessageTooLong();
        if (registeredUsers.length == 0) revert NoEligibleUsers();

        // Cleanup pass — iterate from the end so swap-and-pop is safe.
        uint256 i = registeredUsers.length;
        while (i > 0) {
            unchecked {
                --i;
            }
            address user = registeredUsers[i];
            if (clawdToken.balanceOf(user) < MIN_BALANCE) {
                _removeUser(user);
                emit DroppedBelowThreshold(user);
            }
        }

        uint256 len = registeredUsers.length;
        if (len == 0) revert NoEligibleUsers();

        // Sum durations into totalWeight.
        uint256 nowTs = block.timestamp;
        uint256 totalWeight;
        for (uint256 j = 0; j < len; j++) {
            // duration = now - registration timestamp; minimum 1 so a freshly-joined user still has a chance.
            uint256 d = nowTs - uint256(userInfo[registeredUsers[j]].timestamp);
            if (d == 0) d = 1;
            totalWeight += d;
        }

        // Mix prevrandao with blockhash(prev L2 block), tx context, and gasleft so the
        // grinding window shrinks to ~1 L2 block (blockhash changes every L2 block).
        // Still NOT VRF-grade — see NatSpec above and README Security Notes.
        uint256 rand = uint256(
            keccak256(
                abi.encode(
                    block.prevrandao,
                    blockhash(block.number - 1),
                    block.timestamp,
                    block.number,
                    registeredUsers.length,
                    msg.sender,
                    gasleft()
                )
            )
        ) % totalWeight;

        // Walk the cumulative weights to find the winner.
        address winner;
        uint256 winnerDuration;
        uint256 cumulative;
        for (uint256 k = 0; k < len; k++) {
            address user = registeredUsers[k];
            uint256 d = nowTs - uint256(userInfo[user].timestamp);
            if (d == 0) d = 1;
            cumulative += d;
            if (rand < cumulative) {
                winner = user;
                winnerDuration = d;
                break;
            }
        }

        // Block self-tipping — a registered rainmaker cannot win their own tip. This
        // removes the most obvious self-deal vector and pollution of the event feed.
        if (winner == msg.sender) revert SelfTipNotAllowed();

        // Pull tokens from rainmaker straight to winner.
        clawdToken.safeTransferFrom(msg.sender, winner, amount);

        emit ItsRainingClawd(msg.sender, amount, message, winner, winnerDuration, block.timestamp);
    }

    /// @notice Returns the full list of registered users.
    function getRegisteredUsers() external view returns (address[] memory) {
        return registeredUsers;
    }

    /// @notice Returns timestamp, current eligibility (live balance check), and registered flag for `user`.
    function getUserInfo(address user) external view returns (uint256 timestamp, bool eligible, bool registered) {
        UserInfo memory info = userInfo[user];
        return (uint256(info.timestamp), clawdToken.balanceOf(user) >= MIN_BALANCE, info.registered);
    }

    /// @notice Returns the number of registered users.
    function getRegisteredCount() external view returns (uint256) {
        return registeredUsers.length;
    }

    // --- internal ---

    function _removeUser(address user) internal {
        uint256 idx = uint256(userInfo[user].arrayIndex);
        uint256 lastIdx = registeredUsers.length - 1;

        if (idx != lastIdx) {
            address swapped = registeredUsers[lastIdx];
            registeredUsers[idx] = swapped;
            userInfo[swapped].arrayIndex = uint64(idx);
        }
        registeredUsers.pop();

        delete userInfo[user];
    }
}
