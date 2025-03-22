// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

interface IWind{
    // Events
    event WindClaimed(address indexed receiver, uint256 amount);
    event TokensTransfered(address indexed owner, uint256 amount);
    event TokensTransferedByProxy(address indexed claimer, address indexed receiver, uint256 amount);

    // Constants
    function MAX_SUPPLY() external view returns (uint256);
    function LP_ALLOCATION() external view returns (uint256);
    function FUTURE_GROWTH_ALLOCATION() external view returns (uint256);
    function PHASE_1_ALLOCATION() external view returns (uint256);
    function PHASE_2_ALLOCATION() external view returns (uint256);
    function PHASE_3_ALLOCATION() external view returns (uint256);

    // State variables
    function currentPhase() external view returns (uint8);
    function activePhase() external view returns (bool);
    function phaseStartTime() external view returns (uint256);
    function claimActivationTime() external view returns (uint256);
    function proxyClaimActivationTime() external view returns (uint256);
    function currentPhaseRemainingTokens() external view returns (uint256);
    function claimDropCompleted() external view returns (bool);
    function firstTimeThreshold() external view returns (uint256);
    function secondTimeThreshold() external view returns (uint256);

    // Mappings
    function claimCount(address user) external view returns (uint256);
    function pendingClaims(address user) external view returns (uint256);
    function lastProxyClaimTime(address user) external view returns (uint256);
    function transferAmountUsed(address user) external view returns (uint256);
    function excludedDexes(address dex) external view returns (bool);

    // Main functions
    function claimWind() external;
    function transferTokens() external;
    function transferTokensForWallet(address wallet) external;
    function getReductionMultiplier(uint256 claims) external pure returns (uint256);
    function circulatingSupply() external view returns (uint256);
}