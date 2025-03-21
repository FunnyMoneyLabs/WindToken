// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

/**
 * @title WindToken
 * @author bravenoob21
 * @dev Implements a multi-phase token distribution with random allocation amounts
 */
contract WindTokenReduced is ERC20, Ownable {
	uint256 public constant MAX_SUPPLY = 10_000_000 * 10 ** 18;
	uint256 public constant LP_ALLOCATION = 1_000_000 * 10 ** 18;
	uint256 public constant FUTURE_GROWTH_ALLOCATION = 2_000_000 * 10 ** 18;

	// Phase allocations
	uint256 public constant PHASE_1_ALLOCATION = 10 * 10 ** 18;
	uint256 public constant PHASE_2_ALLOCATION = 20 * 10 ** 18;
	uint256 public constant PHASE_3_ALLOCATION = 40 * 10 ** 18;

	// Constants for logarithmic reduction
	uint256 private constant REDUCTION_BASE = 1000; //100%
	uint256 private constant MIN_REDUCTION = 100; // 10%

	// Current phase tracking
	uint8 public currentPhase = 0;
	bool public activePhase;
	uint256 public phaseStartTime;
	uint256 public claimActivationTime;
	uint256 public proxyClaimActivationTime;
	uint256 public currentPhaseRemainingTokens;
	bool public claimDropCompleted;

	uint256 public firstTimeThreshold = 5;
	uint256 public secondTimeThreshold = 10;

	mapping(address => uint256) public claimCount;
	mapping(address => uint256) public pendingClaims;
	mapping(address => uint256) public lastProxyClaimTime;
	mapping(address => uint256) public transferAmountUsed;
	mapping(address => bool) public excludedDexes;

	// salt against bots.
	uint256 private salt;

	event WindClaimed(address indexed receiver, uint256 amount);
	event TokensTransfered(address indexed owner, uint256 amount);
	event TokensTransferedByProxy(address indexed claimer, address indexed receiver, uint256 amount);

	constructor() ERC20(unicode"Wind 💨", "WIND") Ownable(msg.sender) {
		// Mint all tokens at start
		_mint(address(this), MAX_SUPPLY);

		// Transfer lp allocation
		_transfer(address(this), msg.sender, LP_ALLOCATION);
	}

	/**
	 * @notice Allows users to claim WIND tokens during an active phase
	 * @dev The amount claimed depends on elapsed time since phase start and user's current balance
	 *      Emits a WindClaimed event on successful claim
	 */
	function claimWind() external {
		require(currentPhase > 0, "Claimdrop not active");
		require(activePhase, "Claimdrop not active");
		require(block.timestamp >= phaseStartTime, "Claimdrop not active");

		uint256 elapsedTime = block.timestamp - phaseStartTime;
		uint256 baseAllocation;

		if (elapsedTime <= firstTimeThreshold) {
			baseAllocation = 1 * 10 ** 18;
		} else if (elapsedTime <= secondTimeThreshold) {
			baseAllocation = _randomNumber(1, 10) * 10 ** 18;
		} else {
			uint256 currentBalance = balanceOf(msg.sender);
			uint256 maxAllocation = currentBalance == 0 ? 10 : currentBalance >= 1000 * 10 ** 18 ? 1000 : currentBalance / 10 ** 18;

			uint256 multiplier = getReductionMultiplier(claimCount[msg.sender]);
			maxAllocation = (maxAllocation * multiplier) / REDUCTION_BASE;
			maxAllocation = maxAllocation > 10 ? maxAllocation : 10;
			maxAllocation = maxAllocation * 10 ** 18;

			baseAllocation = _randomNumber(10 * 10 ** 18, maxAllocation);
			claimCount[msg.sender]++;
		}

		if (baseAllocation > currentPhaseRemainingTokens) {
			baseAllocation = currentPhaseRemainingTokens;
			_endPhase();
		}

		pendingClaims[msg.sender] += baseAllocation;
		currentPhaseRemainingTokens -= baseAllocation;

		emit WindClaimed(msg.sender, baseAllocation);
	}

	/**
	 * @notice Transfers previously claimed tokens to the user
	 * @dev Requires that token transfer is active and user has pending claims
	 *      User must also have sufficient balance for transfer
	 *      Emits a TokensTransfered event on successful transfer
	 */
	function transferTokens() external {
		require(claimActivationTime > 0 && block.timestamp >= claimActivationTime, "Transfer not active yet");
		require(pendingClaims[msg.sender] > 0, "No tokens to transfer");
		require(balanceOf(msg.sender) - transferAmountUsed[msg.sender] >= pendingClaims[msg.sender], "Insufficient balance to transfer, own more $WIND");

		uint256 amountToClaim = pendingClaims[msg.sender];
		pendingClaims[msg.sender] = 0;
		transferAmountUsed[msg.sender] += amountToClaim;
		_transfer(address(this), msg.sender, amountToClaim);

		emit TokensTransfered(msg.sender, amountToClaim);
	}

	/**
	 * @notice Transfers tokens to another wallet that has pending claims
	 * @dev Proxy transfer has a 30-minute cooldown period between uses
	 *      Caller must have sufficient balance to cover the transfer
	 * @param wallet The address of the wallet to transfer tokens to
	 */
	function transferTokensForWallet(address wallet) external {
		require(proxyClaimActivationTime > 0 && block.timestamp >= proxyClaimActivationTime, "Proxy transfer not active yet");
		require(pendingClaims[wallet] > 0, "No tokens to transfer for this wallet");
		require(balanceOf(msg.sender) - transferAmountUsed[msg.sender] >= pendingClaims[wallet], "Insufficient balance for transfer, own more $WIND");
		require(block.timestamp >= lastProxyClaimTime[msg.sender] + 30 minutes, "Cooldown period not elapsed");

		lastProxyClaimTime[msg.sender] = block.timestamp;

		uint256 amountToClaim = pendingClaims[wallet];
		pendingClaims[wallet] = 0;
		_transfer(address(this), wallet, amountToClaim);

		emit TokensTransferedByProxy(msg.sender, wallet, amountToClaim);
	}

	/**
	 * @notice Calculates a reduction multiplier based on the number of claims
	 * @dev Uses a hyperbolic reduction function with a minimum floor
	 * @param claims Number of previous claims made by an address
	 * @return Reduction multiplier between MIN_REDUCTION and REDUCTION_BASE
	 */
	function getReductionMultiplier(uint256 claims) public pure returns (uint256) {
		if (claims == 0) return REDUCTION_BASE;
		uint256 denominator = claims + 1;
		uint256 reduction = REDUCTION_BASE / denominator;
		return reduction > MIN_REDUCTION ? reduction : MIN_REDUCTION;
	}

	/**
	 * @notice Returns the current circulating supply of tokens
	 * @dev Calculated as the difference between MAX_SUPPLY and the contract's balance
	 * @return Current circulating supply in wei
	 */
	function circulatingSupply() public view returns (uint256) {
		return MAX_SUPPLY - balanceOf(address(this));
	}

	/**
	 * @notice Activates the next phase of token minting
	 * @dev Can only be called by the contract owner
	 *      Sets the phase allocation based on the current phase number
	 */
	function activateMinting() external onlyOwner {
		require(currentPhase < 3, "All phases completed");

		salt = uint256(keccak256(abi.encodePacked(block.timestamp, block.prevrandao, msg.sender)));

		currentPhase++;
		phaseStartTime = block.timestamp; // Start immediately
		activePhase = true;

		// Set the allocation for the current phase
		if (currentPhase == 1) {
			currentPhaseRemainingTokens = PHASE_1_ALLOCATION;
		} else if (currentPhase == 2) {
			currentPhaseRemainingTokens = PHASE_2_ALLOCATION;
		} else if (currentPhase == 3) {
			currentPhaseRemainingTokens = PHASE_3_ALLOCATION;
		}
	}

	/**
	 * @notice Manually ends the current phase
	 * @dev Can only be called by the contract owner
	 *      Requires an active phase to be running
	 */
	function endPhaseManually() external onlyOwner {
		require(currentPhase > 0, "No active phase");
		require(activePhase, "Phase already ended");

		_endPhase();
	}

	/**
	 * @notice Completes the claimdrop and transfers future growth allocation to owner
	 * @dev Can only be called by the contract owner and only after phase 3
	 */
	function completeClaimDrop() external onlyOwner {
		require(currentPhase == 3, "Only after 3 drops");
		claimDropCompleted = true;
		_transfer(address(this), owner(), FUTURE_GROWTH_ALLOCATION);
	}

	/**
	 * @notice Updates the time thresholds used in the claimWind function
	 * @dev Can only be called by the contract owner
	 * @param _firstTimeThreshold New value for the first time threshold in seconds
	 * @param _secondTimeThreshold New value for the second time threshold in seconds
	 */
	function updateTimeThresholds(uint256 _firstTimeThreshold, uint256 _secondTimeThreshold) external onlyOwner {
		firstTimeThreshold = _firstTimeThreshold;
		secondTimeThreshold = _secondTimeThreshold;
	}

	/**
	 * @notice Adds a DEX address to the exclusion list
	 * @dev Can only be called by the contract owner
	 * @param dexAddress The address of the DEX to exclude
	 */
	function excludeDex(address dexAddress) external onlyOwner {
		require(dexAddress != address(0), "Cannot exclude zero address");
		require(!excludedDexes[dexAddress], "DEX already excluded");
		excludedDexes[dexAddress] = true;
	}

	/**
	 * @notice Removes a DEX address from the exclusion list
	 * @dev Can only be called by the contract owner
	 * @param dexAddress The address of the DEX to include
	 */
	function includeDex(address dexAddress) external onlyOwner {
		require(excludedDexes[dexAddress], "DEX not excluded");
		excludedDexes[dexAddress] = false;
	}

	/**
	 * @dev Generates a pseudo-random number between min and max (inclusive)
	 * @param min The minimum value of the random number
	 * @param max The maximum value of the random number
	 * @return A pseudo-random number between min and max
	 */
	function _randomNumber(uint256 min, uint256 max) internal returns (uint256) {
		if (min >= max) return min;

		salt = uint256(keccak256(abi.encodePacked(block.timestamp, block.prevrandao, msg.sender, salt)));

		return min + (salt % (max - min + 1));
	}

	/**
	 * @dev Ends the current phase and sets up timing for claim transfers
	 */
	function _endPhase() internal {
		activePhase = false;
		claimActivationTime = block.timestamp + 30 minutes;
		proxyClaimActivationTime = block.timestamp + 60 minutes;
	}

	/**
	 * @dev Overrides the ERC20 _update function to implement transfer restrictions
	 * @param from The address tokens are transferred from
	 * @param to The address tokens are transferred to
	 * @param amount The amount of tokens being transferred
	 */
	function _update(address from, address to, uint256 amount) internal override {
		super._update(from, to, amount);

		// Skip if minting or burning
		if (!claimDropCompleted && from != address(0) && to != address(0) && amount > 0) {
			if (!excludedDexes[from] && !excludedDexes[to]) {
				// rate limit the stealing
				if (lastProxyClaimTime[from] > 0) {
					lastProxyClaimTime[to] = lastProxyClaimTime[from];
				}
				// can't use balance several times
				if (transferAmountUsed[from] > 0) {
					transferAmountUsed[to] += transferAmountUsed[from];
				}
			}
		}
	}
}
