// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "./DeployHelpers.s.sol";
import { ClawdRain } from "../contracts/ClawdRain.sol";

/**
 * @notice Deploy script for ClawdRain
 * @dev CLAWD ERC20 is hardcoded to the live mainnet/Base address. This contract is Base-only.
 *
 * Example:
 *   yarn deploy --file DeployClawdRain.s.sol --network base
 */
contract DeployClawdRain is ScaffoldETHDeploy {
    // CLAWD ERC20 on Base
    address constant CLAWD_TOKEN = 0x9f86dB9fc6f7c9408e8Fda3Ff8ce4e78ac7a6b07;

    function run() external ScaffoldEthDeployerRunner {
        ClawdRain clawdRain = new ClawdRain(CLAWD_TOKEN);
        deployments.push(Deployment({ name: "ClawdRain", addr: address(clawdRain) }));
    }
}
