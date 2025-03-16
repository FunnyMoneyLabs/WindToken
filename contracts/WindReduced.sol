// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

contract WindTokenReduced is ERC20, Ownable {
    uint256 public constant MAX_SUPPLY = 10_000_000 * 10**18;
    uint256 public constant LP_ALLOCATION = 1_000_000 * 10**18;
    uint256 public constant FUTURE_GROWTH_ALLOCATION = 2_000_000 * 10**18;
    
    // Phase allocations
    uint256 public constant PHASE_1_ALLOCATION = 10 * 10**18;
    uint256 public constant PHASE_2_ALLOCATION = 20 * 10**18;
    uint256 public constant PHASE_3_ALLOCATION = 40 * 10**18;

    // Constants for logarithmic reduction
    uint256 private constant REDUCTION_BASE = 1000; //100%
    uint256 private constant MIN_REDUCTION = 100;   // 10%

    // Current phase tracking
    uint8 public currentPhase = 0;
    bool public activePhase;
    uint256 public phaseStartTime;
    uint256 public claimActivationTime;
    uint256 public proxyClaimActivationTime;
    uint256 public currentPhaseRemainingTokens;
    bool public claimDropCompleted;

    mapping(address => uint256) public claimCount;
    mapping(address => uint256) public pendingClaims;
    mapping(address => uint256) public lastProxyClaimTime;

    // salt against bots.
    uint256 private salt;

    event TokensTransfered(address indexed owner, uint256 amount);
    event TokensTransferedByProxy(address indexed claimer, address indexed receiver, uint256 amount);
    event PhaseActivated(uint8 phase, uint256 allocation);
    event PhaseEnded(uint8 phase, uint256 timestamp);
    event ProxyAssigned(address indexed receiver, address indexed proxy);

    constructor() ERC20(unicode"Wind 💨", "WIND") Ownable(msg.sender) {
          // Mint all tokens at start
        _mint(address(this), MAX_SUPPLY);

        // Transfer deployer allocation
        _transfer(address(this), msg.sender, LP_ALLOCATION);
    }

    function claimWind() external {
        require(currentPhase > 0, "Claimdrop not active");
        require(activePhase, "Claimdrop not active");
        require(block.timestamp >= phaseStartTime, "Claimdrop not active");

        uint256 elapsedTime = block.timestamp - phaseStartTime;
        uint256 baseAllocation;

        if (elapsedTime <= 5) {
            baseAllocation = 1 * 10**18;
        } else if (elapsedTime <= 10) {
            baseAllocation = randomNumber(1, 10) * 10**18;
        } else {
            uint256 currentBalance = balanceOf(msg.sender);
            uint256 maxAllocation = currentBalance == 0 ? 10 : 
                                  currentBalance >= 1000 * 10**18 ? 1000 : 
                                  currentBalance / 10**18;

            uint256 multiplier = getReductionMultiplier(claimCount[msg.sender]);
            maxAllocation = (maxAllocation * multiplier) / REDUCTION_BASE;
            maxAllocation = maxAllocation > 10 ? maxAllocation : 10;
            maxAllocation = maxAllocation * 10**18;

            baseAllocation = randomNumber(10 * 10**18, maxAllocation);
            claimCount[msg.sender]++;
        }

        if(baseAllocation > currentPhaseRemainingTokens){
            baseAllocation = currentPhaseRemainingTokens;
            _endPhase();
        }
       
        pendingClaims[msg.sender] += baseAllocation;
        currentPhaseRemainingTokens -= baseAllocation;
    }

    function transferTokens() external {
        require(claimActivationTime > 0 && block.timestamp >= claimActivationTime, "Transfer not active yet");
        require(pendingClaims[msg.sender] > 0, "No tokens to transfer");
        require(balanceOf(msg.sender) >= pendingClaims[msg.sender], "Insufficient balance to transfer, buy more $WIND");

        uint256 amountToClaim = pendingClaims[msg.sender];
        pendingClaims[msg.sender] = 0;
        _transfer(address(this), msg.sender, amountToClaim);

        emit TokensTransfered(msg.sender, amountToClaim);
    }

    function transferTokensForWallet(address wallet) external {
        require(proxyClaimActivationTime > 0 && block.timestamp >= proxyClaimActivationTime, "Proxy transfer not active yet");
        require(pendingClaims[wallet] > 0, "No tokens to transfer for this wallet");
        require(balanceOf(msg.sender) >= pendingClaims[wallet], "Insufficient balance for transfer");
        require(block.timestamp >= lastProxyClaimTime[msg.sender] + 10 minutes, "Cooldown period not elapsed");

        lastProxyClaimTime[msg.sender] = block.timestamp;

        uint256 amountToClaim = pendingClaims[wallet];
        pendingClaims[wallet] = 0;
        _transfer(address(this), wallet, amountToClaim);

        emit TokensTransferedByProxy(msg.sender, wallet, amountToClaim);
    }

    function randomNumber(uint256 min, uint256 max) internal returns (uint256) {
        if (min >= max) return min;

        salt = uint256(keccak256(abi.encodePacked(
            block.timestamp,
            block.prevrandao,
            msg.sender,
            salt
        )));

        return min + (salt % (max - min + 1));
    }

    function getReductionMultiplier(uint256 claims) public pure returns (uint256) {
        if (claims == 0) return REDUCTION_BASE;
        uint256 denominator = claims + 1;
        uint256 reduction = REDUCTION_BASE / denominator;
        return reduction > MIN_REDUCTION ? reduction : MIN_REDUCTION;
    }

    function circulatingSupply() public view returns (uint256) {
        return MAX_SUPPLY - balanceOf(address(this));
    }

    function activateMinting() external onlyOwner {
        require(currentPhase < 3, "All phases completed");
     
        salt = uint256(keccak256(abi.encodePacked(
            block.timestamp, 
            block.prevrandao, 
            msg.sender
        )));

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

        emit PhaseActivated(currentPhase, currentPhaseRemainingTokens);
    }

    function endPhaseManually() external onlyOwner {
        require(currentPhase > 0, "No active phase");
        require(activePhase, "Phase already ended");

        _endPhase();
    }

    function completeClaimDrop() external onlyOwner {
        require(currentPhase == 3, "Only after 3 drops");
        claimDropCompleted = true;
        _transfer(address(this), owner(), FUTURE_GROWTH_ALLOCATION);
    }

    function _endPhase() internal {
        activePhase = false;
        claimActivationTime = block.timestamp + 30 minutes;
        proxyClaimActivationTime = block.timestamp + 60 minutes;

        emit PhaseEnded(currentPhase, block.timestamp);
    }

    // Prevent proxyClaim, transfer, proxyClaim without the cooldown.
    function _update(
        address from,
        address to,
        uint256 amount
    ) internal override {
        super._update(from, to, amount);

        // Skip if minting or burning
        if (!claimDropCompleted && from != address(0) && to != address(0) && amount > 0) {
            // Copy the lastProxyClaimTime from sender to receiver
            if (lastProxyClaimTime[from] > 0) {
                lastProxyClaimTime[to] = lastProxyClaimTime[from];
            }
            emit ProxyAssigned(from, to);
        }
    }
}