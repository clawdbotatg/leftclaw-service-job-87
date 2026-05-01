// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import { ERC20 } from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import { ClawdRain } from "../contracts/ClawdRain.sol";

contract MockERC20 is ERC20 {
    constructor() ERC20("Mock CLAWD", "mCLAWD") { }

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }

    function burn(address from, uint256 amount) external {
        _burn(from, amount);
    }
}

contract ClawdRainTest is Test {
    MockERC20 internal clawd;
    ClawdRain internal rain;

    address internal alice = address(0xA11CE);
    address internal bob = address(0xB0B);
    address internal carol = address(0xCA401);
    address internal rainmaker = address(0xDADA);

    uint256 internal constant MIN_BALANCE = 1_000_000 * 1e18;
    uint256 internal constant MIN_TIP = 10_000 * 1e18;

    event SteppedIntoTheRain(address indexed user, uint256 timestamp);
    event LeftTheRain(address indexed user);
    event DroppedBelowThreshold(address indexed user);
    event ItsRainingClawd(
        address indexed rainmaker,
        uint256 amount,
        string message,
        address indexed winner,
        uint256 winnerDuration,
        uint256 timestamp
    );

    function setUp() public {
        clawd = new MockERC20();
        rain = new ClawdRain(address(clawd));
    }

    // --- register ---

    function testRegisterRequiresMinBalance() public {
        clawd.mint(alice, MIN_BALANCE - 1);
        vm.prank(alice);
        vm.expectRevert(ClawdRain.InsufficientBalance.selector);
        rain.register();
    }

    function testRegisterSucceeds() public {
        clawd.mint(alice, MIN_BALANCE);

        vm.expectEmit(true, false, false, true);
        emit SteppedIntoTheRain(alice, block.timestamp);

        vm.prank(alice);
        rain.register();

        assertEq(rain.getRegisteredCount(), 1);
        (uint256 ts, bool eligible, bool registered) = rain.getUserInfo(alice);
        assertEq(ts, block.timestamp);
        assertTrue(eligible);
        assertTrue(registered);
    }

    function testRegisterTwiceReverts() public {
        clawd.mint(alice, MIN_BALANCE);
        vm.prank(alice);
        rain.register();

        vm.prank(alice);
        vm.expectRevert(ClawdRain.AlreadyRegistered.selector);
        rain.register();
    }

    // --- unregister / swap-and-pop ---

    function testUnregisterSwapAndPop() public {
        clawd.mint(alice, MIN_BALANCE);
        clawd.mint(bob, MIN_BALANCE);
        clawd.mint(carol, MIN_BALANCE);

        vm.prank(alice);
        rain.register();
        vm.prank(bob);
        rain.register();
        vm.prank(carol);
        rain.register();

        // Sanity: [A, B, C]
        assertEq(rain.registeredUsers(0), alice);
        assertEq(rain.registeredUsers(1), bob);
        assertEq(rain.registeredUsers(2), carol);

        vm.prank(bob);
        rain.unregister();

        // After swap-and-pop: [A, C]
        assertEq(rain.getRegisteredCount(), 2);
        assertEq(rain.registeredUsers(0), alice);
        assertEq(rain.registeredUsers(1), carol);

        // Carol's arrayIndex should now be 1.
        (, uint64 carolIdx, bool carolReg) = rain.userInfo(carol);
        assertEq(carolIdx, 1);
        assertTrue(carolReg);

        // Bob is fully cleared.
        (uint64 bobTs, uint64 bobIdx, bool bobReg) = rain.userInfo(bob);
        assertEq(bobTs, 0);
        assertEq(bobIdx, 0);
        assertFalse(bobReg);
    }

    function testUnregisterNotRegisteredReverts() public {
        vm.prank(alice);
        vm.expectRevert(ClawdRain.NotRegistered.selector);
        rain.unregister();
    }

    // --- tip ---

    function testTipRequiresMinTip() public {
        vm.prank(rainmaker);
        vm.expectRevert(ClawdRain.TipTooSmall.selector);
        rain.tip(MIN_TIP - 1, "hi");
    }

    function testTipMessageTooLong() public {
        // 281 chars
        string memory long;
        bytes memory buf = new bytes(281);
        for (uint256 i = 0; i < 281; i++) {
            buf[i] = "x";
        }
        long = string(buf);

        vm.prank(rainmaker);
        vm.expectRevert(ClawdRain.MessageTooLong.selector);
        rain.tip(MIN_TIP, long);
    }

    function testTipNoEligibleUsers() public {
        vm.prank(rainmaker);
        vm.expectRevert(ClawdRain.NoEligibleUsers.selector);
        rain.tip(MIN_TIP, "anyone home?");
    }

    function testTipHappyPath() public {
        clawd.mint(alice, MIN_BALANCE);
        vm.prank(alice);
        rain.register();

        clawd.mint(rainmaker, MIN_TIP);
        vm.prank(rainmaker);
        clawd.approve(address(rain), MIN_TIP);

        // alice was just registered, so duration becomes 1 (clamped).
        vm.expectEmit(true, true, false, true);
        emit ItsRainingClawd(rainmaker, MIN_TIP, "drip", alice, 1, block.timestamp);

        vm.prank(rainmaker);
        rain.tip(MIN_TIP, "drip");

        assertEq(clawd.balanceOf(alice), MIN_BALANCE + MIN_TIP);
        assertEq(clawd.balanceOf(rainmaker), 0);
    }

    function testTipCleansIneligible() public {
        clawd.mint(alice, MIN_BALANCE);
        clawd.mint(bob, MIN_BALANCE);

        vm.prank(alice);
        rain.register();
        vm.prank(bob);
        rain.register();

        // Drain bob below threshold.
        clawd.burn(bob, 1);
        assertLt(clawd.balanceOf(bob), MIN_BALANCE);

        clawd.mint(rainmaker, MIN_TIP);
        vm.prank(rainmaker);
        clawd.approve(address(rain), MIN_TIP);

        vm.expectEmit(true, false, false, true);
        emit DroppedBelowThreshold(bob);

        vm.prank(rainmaker);
        rain.tip(MIN_TIP, "alice wins by default");

        // Bob is gone, alice gets the tip.
        assertEq(rain.getRegisteredCount(), 1);
        assertEq(rain.registeredUsers(0), alice);
        (,, bool bobReg) = rain.userInfo(bob);
        assertFalse(bobReg);
        assertEq(clawd.balanceOf(alice), MIN_BALANCE + MIN_TIP);
    }

    function testWeightedRandomness() public {
        // Two registered users with different — but comparable — durations so both
        // realistically win across the loop.
        clawd.mint(alice, MIN_BALANCE);
        vm.prank(alice);
        rain.register();

        // Warp a modest amount so alice's duration is ~3x bob's once bob registers.
        vm.warp(block.timestamp + 200);

        clawd.mint(bob, MIN_BALANCE);
        vm.prank(bob);
        rain.register();

        // Run many tips in a loop and confirm each wins at least once.
        uint256 aliceWins;
        uint256 bobWins;
        uint256 runs = 100;

        for (uint256 i = 0; i < runs; i++) {
            // Vary block conditions so prevrandao + timestamp + sender produce
            // different randomness across iterations.
            vm.warp(block.timestamp + 1);
            vm.prevrandao(bytes32(uint256(i + 1)));

            address tipper = address(uint160(0xCAFE0000 + i));
            clawd.mint(tipper, MIN_TIP);
            vm.prank(tipper);
            clawd.approve(address(rain), MIN_TIP);

            uint256 aliceBefore = clawd.balanceOf(alice);
            uint256 bobBefore = clawd.balanceOf(bob);

            vm.prank(tipper);
            rain.tip(MIN_TIP, "");

            if (clawd.balanceOf(alice) > aliceBefore) {
                aliceWins++;
            } else if (clawd.balanceOf(bob) > bobBefore) {
                bobWins++;
            }
        }

        // Alice should win more (longer duration), but bob should still win occasionally.
        assertGt(aliceWins, 0, "alice never won");
        assertGt(bobWins, 0, "bob never won");
        assertEq(aliceWins + bobWins, runs);
    }
}
