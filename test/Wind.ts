import { expect } from "chai"
import { deployments, ethers, getNamedAccounts } from "hardhat"
import { time } from "@nomicfoundation/hardhat-network-helpers"

describe("WindToken", () => {
	const setupFixture = deployments.createFixture(async () => {
		await deployments.fixture()
		const signers = await getNamedAccounts()
		const name = "Wind 💨"
		const symbol = "WIND"
		const owner = signers.deployer
		const contract = await ethers.deployContract("WindToken", [], await ethers.getSigner(signers.deployer))
		return {
			contract,
			contractAddress: await contract.getAddress(),
			deployer: signers.deployer,
			accounts: await ethers.getSigners(),
			contractConstructor: {
				name,
				symbol,
				owner,
			},
		}
	})

	it("Should Return Valid Contract Configurations Passed In Constructor", async () => {
		const { contractConstructor, contract } = await setupFixture()
		expect(await contract.name()).to.equal(contractConstructor.name)
		expect(await contract.symbol()).to.equal(contractConstructor.symbol)
		expect(await contract.owner()).to.equal(contractConstructor.owner)
	})

	it("Should have correct initial values", async () => {
		const { contract, deployer } = await setupFixture()

		// Check constants
		expect(await contract.MAX_SUPPLY()).to.equal(ethers.parseEther("10000000"))
		expect(await contract.LP_ALLOCATION()).to.equal(ethers.parseEther("1000000"))
		expect(await contract.FUTURE_GROWTH_ALLOCATION()).to.equal(ethers.parseEther("2000000"))
		expect(await contract.PHASE_1_ALLOCATION()).to.equal(ethers.parseEther("1000000"))
		expect(await contract.PHASE_2_ALLOCATION()).to.equal(ethers.parseEther("2000000"))
		expect(await contract.PHASE_3_ALLOCATION()).to.equal(ethers.parseEther("4000000"))

		// Check initial state variables
		expect(await contract.currentPhase()).to.equal(0)
		expect(await contract.phaseStartTime()).to.equal(0)
		expect(await contract.activePhase()).to.false
		expect(await contract.claimActivationTime()).to.equal(0)
		expect(await contract.proxyClaimActivationTime()).to.equal(0)

		// Check initial token distribution
		expect(await contract.balanceOf(deployer)).to.equal(ethers.parseEther("1000000"))
		expect(await contract.balanceOf(contract.getAddress())).to.equal(ethers.parseEther("9000000"))
	})

	describe("Phase Activation & Management", () => {
		it("Should correctly activate phase 1", async function () {
			const { contract } = await setupFixture()

			const tx = await contract.activateMinting()
			const receipt = await tx.wait()
			const blockTimestamp = (await ethers.provider.getBlock(receipt.blockNumber)).timestamp

			expect(await contract.currentPhase()).to.equal(1)
			expect(await contract.phaseStartTime()).to.equal(blockTimestamp)
			expect(await contract.activePhase()).to.true
			expect(await contract.currentPhaseRemainingTokens()).to.equal(ethers.parseEther("1000000"))
		})

		it("Should correctly activate phases sequentially", async function () {
			const { contract } = await setupFixture()

			// Phase 1
			await contract.activateMinting()
			expect(await contract.currentPhase()).to.equal(1)

			// End phase 1
			await contract.endPhaseManually()

			// Phase 2
			await contract.activateMinting()
			expect(await contract.currentPhase()).to.equal(2)
			expect(await contract.currentPhaseRemainingTokens()).to.equal(ethers.parseEther("2000000"))

			// End phase 2
			await contract.endPhaseManually()

			// Phase 3
			await contract.activateMinting()
			expect(await contract.currentPhase()).to.equal(3)
			expect(await contract.currentPhaseRemainingTokens()).to.equal(ethers.parseEther("4000000"))
		})

		it("Should not allow activating more than 3 phases", async function () {
			const { contract } = await setupFixture()

			// Activate and end all phases
			await contract.activateMinting() // Phase 1
			await contract.endPhaseManually()

			await contract.activateMinting() // Phase 2
			await contract.endPhaseManually()

			await contract.activateMinting() // Phase 3
			await contract.endPhaseManually()

			// Try to activate Phase 4 (should fail)
			await expect(contract.activateMinting()).to.be.revertedWith("All phases completed")
		})

		it("Should end phase manually", async function () {
			const { contract } = await setupFixture()

			await contract.activateMinting()
			const tx = await contract.endPhaseManually()
			const receipt = await tx.wait()
			const blockTimestamp = (await ethers.provider.getBlock(receipt.blockNumber)).timestamp

			// Check state changes
			expect(await contract.activePhase()).to.false
			expect(await contract.claimActivationTime()).to.equal(blockTimestamp + 30 * 60) // +30 minutes
			expect(await contract.proxyClaimActivationTime()).to.equal(blockTimestamp + 60 * 60) // +60 minutes
		})

		it("Should not allow ending phase if no active phase", async function () {
			const { contract } = await setupFixture()

			await expect(contract.endPhaseManually()).to.be.revertedWith("No active phase")
		})

		it("Should not allow ending phase that's already ended", async function () {
			const { contract } = await setupFixture()

			await contract.activateMinting()
			await contract.endPhaseManually()

			await expect(contract.endPhaseManually()).to.be.revertedWith("Phase already ended")
		})
	})

	describe("claimWind", () => {
		it("Should not allow claimWind when no phase is active", async function () {
			const { contract, accounts } = await setupFixture()

			await expect(contract.connect(accounts[1]).claimWind()).to.be.revertedWith("Claimdrop not active")
		})

		it("Should allow users to claim tokens within first 5 seconds with 1 token", async function () {
			const { contract, accounts } = await setupFixture()

			await contract.activateMinting()

			// First claim within 5 seconds
			await contract.connect(accounts[1]).claimWind()

			expect(await contract.pendingClaims(accounts[1].address)).to.equal(ethers.parseEther("1"))
			expect(await contract.claimCount(accounts[1].address)).to.equal(0)
			expect(await contract.currentPhaseRemainingTokens()).to.equal(ethers.parseEther("999999"))
		})

		it("Should allow users to claim tokens between 5-10 seconds with random amount between 1-10", async function () {
			const { contract, accounts } = await setupFixture()

			await contract.activateMinting()

			// Advance time by 6 seconds
			await time.increase(6)

			await contract.connect(accounts[1]).claimWind()

			const pendingClaim = await contract.pendingClaims(accounts[1].address)
			expect(pendingClaim).to.be.gte(ethers.parseEther("1"))
			expect(pendingClaim).to.be.lte(ethers.parseEther("10"))
			expect(await contract.claimCount(accounts[1].address)).to.equal(0)
		})

		it("Should calculate claim amount correctly after 10 seconds based on balance", async function () {
			const { contract, accounts } = await setupFixture()

			await contract.activateMinting()

			// Transfer some tokens to the test account
			await contract.transfer(accounts[1].address, ethers.parseEther("1000"))

			// Advance time by 11 seconds
			await time.increase(11)

			// First claim
			await contract.connect(accounts[1]).claimWind()

			// Claim amount should be random between 10 and 1000
			const pendingClaim = await contract.pendingClaims(accounts[1].address)
			expect(pendingClaim).to.be.gte(ethers.parseEther("10"))
			expect(pendingClaim).to.be.lte(ethers.parseEther("1000"))
			expect(await contract.claimCount(accounts[1].address)).to.equal(1)
			expect(await contract.currentPhaseRemainingTokens()).to.equal(ethers.parseEther("1000000") - pendingClaim)

			// claim amount should be fix 10
			await contract.connect(accounts[2]).claimWind()
			const pendingClaim2 = await contract.pendingClaims(accounts[2].address)
			expect(await contract.pendingClaims(accounts[2].address)).to.equal(ethers.parseEther("10"))
			expect(await contract.claimCount(accounts[2].address)).to.equal(1)
			expect(await contract.currentPhaseRemainingTokens()).to.equal(
				ethers.parseEther("1000000") - pendingClaim - pendingClaim2
			)
		})

		it("Should use reduction multiplier for frequent claimers", async function () {
			const { contract } = await setupFixture()

			// Test the multiplier calculation directly
			expect(await contract.getReductionMultiplier(0)).to.equal(1000) // 100%
			expect(await contract.getReductionMultiplier(1)).to.equal(500) // 50%
			expect(await contract.getReductionMultiplier(2)).to.equal(333) // 33.3%
			expect(await contract.getReductionMultiplier(3)).to.equal(250) // 25%
			expect(await contract.getReductionMultiplier(9)).to.equal(100) // 10%
			expect(await contract.getReductionMultiplier(99)).to.equal(100) // Min 10%
		})
	})

	describe("Token Claiming", () => {
		it("Should not allow claiming before activation time", async function () {
			const { contract, accounts } = await setupFixture()

			// Setup: activate phase and get some pending claims
			await contract.activateMinting()
			await contract.connect(accounts[1]).claimWind()

			// Try to claim before activation time
			await expect(contract.connect(accounts[1]).transferTokens()).to.be.revertedWith("Transfer not active yet")
		})

		it("Should not allow claiming without pending claims", async function () {
			const { contract, accounts } = await setupFixture()

			// Setup: activate and end phase to enable claiming
			await contract.activateMinting()
			await contract.endPhaseManually()
			await time.increase(30 * 60 + 1) // Past claim activation time

			// Try to claim with no pending claims
			await expect(contract.connect(accounts[2]).transferTokens()).to.be.revertedWith("No tokens to transfer")
		})

		it("Should allow claiming after activation time", async function () {
			const { contract, accounts } = await setupFixture()

			// Setup: activate phase, get pending claims, and end phase
			await contract.activateMinting()
			await contract.connect(accounts[1]).claimWind()
			const pendingAmount = await contract.pendingClaims(accounts[1].address)

			// Transfer tokens to the account to meet the balance requirement
			await contract.transfer(accounts[1].address, pendingAmount)

			await contract.endPhaseManually()
			await time.increase(30 * 60 + 1) // Past claim activation time

			// Claim tokens
			await expect(contract.connect(accounts[1]).transferTokens())
				.to.emit(contract, "TokensTransfered")
				.withArgs(accounts[1].address, pendingAmount)

			// Check state changes
			expect(await contract.pendingClaims(accounts[1].address)).to.equal(0)
			expect(await contract.balanceOf(accounts[1].address)).to.equal(pendingAmount * BigInt(2)) // Initial transfer + claimed
		})

		it("Should not allow transfer without sufficient balance", async function () {
			const { contract, accounts } = await setupFixture()

			// Setup: activate phase, get pending claims, and end phase
			await contract.activateMinting()
			await contract.connect(accounts[1]).claimWind()

			await contract.endPhaseManually()
			await time.increase(30 * 60 + 1) // Past claim activation time

			// Try to transfer without sufficient balance
			await expect(contract.connect(accounts[1]).transferTokens()).to.be.revertedWith(
				"Insufficient balance to transfer, own more $WIND"
			)
		})
	})

	describe("Proxy Transfer", () => {
		it("Should not allow proxy transfer before activation time", async function () {
			const { contract, accounts } = await setupFixture()

			// Setup: activate phase and get some pending claims
			await contract.activateMinting()
			await contract.connect(accounts[1]).claimWind()

			// Try to claim before activation time
			await expect(contract.connect(accounts[2]).transferTokensForWallet(accounts[1].address)).to.be.revertedWith(
				"Proxy transfer not active yet"
			)
		})

		it("Should allow proxy transfer after activation time", async function () {
			const { contract, accounts } = await setupFixture()

			// Setup: activate phase, get pending claims, and end phase
			await contract.activateMinting()
			await contract.connect(accounts[1]).claimWind()
			const pendingAmount = await contract.pendingClaims(accounts[1].address)

			// Transfer tokens to the proxy account to meet the balance requirement
			await contract.transfer(accounts[2].address, pendingAmount)

			await contract.endPhaseManually()
			await time.increase(60 * 60 + 1) // Past proxy claim activation time

			// Proxy claim tokens
			await contract.connect(accounts[2]).transferTokensForWallet(accounts[1].address)

			// Check state changes
			expect(await contract.pendingClaims(accounts[1].address)).to.equal(0)
			expect(await contract.balanceOf(accounts[1].address)).to.equal(pendingAmount)
			expect(await contract.lastProxyClaimTime(accounts[2].address)).to.be.gt(0)
		})

		it("Should not allow proxy claiming during cooldown period", async function () {
			const { contract, accounts } = await setupFixture()

			// Setup: activate phase, get pending claims for two addresses
			await contract.activateMinting()
			await contract.connect(accounts[1]).claimWind()
			await contract.connect(accounts[3]).claimWind()
			const pendingAmount1 = await contract.pendingClaims(accounts[1].address)
			const pendingAmount3 = await contract.pendingClaims(accounts[3].address)

			// Transfer tokens to the proxy account
			await contract.transfer(accounts[2].address, BigInt(pendingAmount1) + BigInt(pendingAmount3))
			// twice, as claming will mark the balance as used
			await contract.transfer(accounts[2].address, BigInt(pendingAmount1) + BigInt(pendingAmount3))

			
			await contract.endPhaseManually()
			await time.increase(60 * 60 + 1) // Past proxy claim activation time

			// First proxy claim
			await contract.connect(accounts[2]).transferTokensForWallet(accounts[1].address)

			// Try second proxy claim immediately (should fail due to cooldown)
			await expect(contract.connect(accounts[2]).transferTokensForWallet(accounts[3].address)).to.be.revertedWith(
				"Cooldown period not elapsed"
			)

			// Advance time past cooldown
			await time.increase(30 * 60 + 1) // Past 30 minute cooldown

			// Second proxy claim should now succeed
			await contract.connect(accounts[2]).transferTokensForWallet(accounts[3].address)
		})

		it("Should transfer cooldown period with token transfers", async function () {
			const { contract, accounts } = await setupFixture()

			// Setup: activate phase, get pending claims, end phase, do a proxy claim
			await contract.activateMinting()
			await contract.connect(accounts[1]).claimWind()
			const pendingAmount = await contract.pendingClaims(accounts[1].address)

			// Transfer tokens to the proxy account
			await contract.transfer(accounts[2].address, pendingAmount * BigInt(2))

			await contract.endPhaseManually()
			await time.increase(60 * 60 + 1) // Past proxy claim activation time

			// Do a proxy claim to set lastProxyClaimTime
			await contract.connect(accounts[2]).transferTokensForWallet(accounts[1].address)

			// Transfer tokens to another account
			await contract.connect(accounts[2]).transfer(accounts[3].address, pendingAmount)

			// Check that the lastProxyClaimTime was transferred
			expect(await contract.lastProxyClaimTime(accounts[3].address)).to.equal(
				await contract.lastProxyClaimTime(accounts[2].address)
			)
		})
	})

	describe("getReductionMultiplier", () => {
		it("Should return correct reduction values", async function () {
			const { contract } = await setupFixture()

			// Test the multiplier logic for various claim counts
			expect(await contract.getReductionMultiplier(0)).to.equal(1000) // First claim: 100%
			expect(await contract.getReductionMultiplier(1)).to.equal(500) // Second claim: 50%
			expect(await contract.getReductionMultiplier(2)).to.equal(333) // Third claim: ~33%
			expect(await contract.getReductionMultiplier(3)).to.equal(250) // Fourth claim: 25%
			expect(await contract.getReductionMultiplier(4)).to.equal(200) // Fifth claim: 20%
			expect(await contract.getReductionMultiplier(9)).to.equal(100) // Tenth claim: 10%

			// Test minimum reduction limit
			expect(await contract.getReductionMultiplier(99)).to.equal(100) // 100th claim: still 10% (minimum)
		})
	})

	describe("circulatingSupply", () => {
		it("Should return the correct circulating supply", async function () {
			const { contract } = await setupFixture()

			// Expected circulating supply at the beginning
			const expectedSupply = ethers.parseEther("1000000") // MAX_SUPPLY - initial contract balance
			expect(await contract.circulatingSupply()).to.equal(expectedSupply)

			// Complete three phases manually
			await contract.activateMinting() // Phase 1
			await contract.endPhaseManually()
			await contract.activateMinting() // Phase 2
			await contract.endPhaseManually()
			await contract.activateMinting() // Phase 3
			await contract.endPhaseManually()

			// Complete the claim drop
			await contract.completeClaimDrop()

			const newExpectedSupply = ethers.parseEther("3000000")
			expect(await contract.circulatingSupply()).to.equal(newExpectedSupply)
		})
	})

	describe("completeClaimDrop", () => {
		it("Should allow owner to complete claim drop after 3 phases", async function () {
			const { contract, deployer } = await setupFixture()

			// Complete three phases manually
			await contract.activateMinting() // Phase 1
			await contract.endPhaseManually()
			await contract.activateMinting() // Phase 2
			await contract.endPhaseManually()
			await contract.activateMinting() // Phase 3
			await contract.endPhaseManually()

			// Complete the claim drop
			await contract.completeClaimDrop()

			// Check state changes
			expect(await contract.claimDropCompleted()).to.equal(true)
			// Validate fund transfer to owner
			expect(await contract.balanceOf(deployer)).to.equal(ethers.parseEther("3000000")) // Initial allocation + FUTURE_GROWTH_ALLOCATION
		})

		it("Should not allow claim drop completion before 3 phases", async function () {
			const { contract } = await setupFixture()

			// Complete two phases manually
			await contract.activateMinting() // Phase 1
			await contract.endPhaseManually()
			await contract.activateMinting() // Phase 2
			await contract.endPhaseManually()

			// Try to complete the claim drop early
			await expect(contract.completeClaimDrop()).to.be.revertedWith("Only after 3 drops")
		})
	})

	describe("DEX Exclusion", () => {
		it("Should allow owner to exclude a DEX", async function () {
			const { contract, accounts } = await setupFixture()
			const dexAddress = accounts[5].address

			await contract.excludeDex(dexAddress)
			expect(await contract.excludedDexes(dexAddress)).to.be.true
		})

		it("Should allow owner to include a previously excluded DEX", async function () {
			const { contract, accounts } = await setupFixture()
			const dexAddress = accounts[5].address

			// First exclude the DEX
			await contract.excludeDex(dexAddress)
			expect(await contract.excludedDexes(dexAddress)).to.be.true

			// Then include it again
			await contract.includeDex(dexAddress)
			expect(await contract.excludedDexes(dexAddress)).to.be.false
		})

		it("Should revert when including a DEX that's not excluded", async function () {
			const { contract, accounts } = await setupFixture()
			const dexAddress = accounts[5].address

			await expect(contract.includeDex(dexAddress)).to.be.revertedWith("DEX not excluded")
		})

		it("Should revert when excluding zero address", async function () {
			const { contract } = await setupFixture()
			await expect(contract.excludeDex(ethers.ZeroAddress)).to.be.revertedWith("Cannot exclude zero address")
		})

		it("Should revert when excluding an already excluded DEX", async function () {
			const { contract, accounts } = await setupFixture()
			const dexAddress = accounts[5].address

			await contract.excludeDex(dexAddress)
			await expect(contract.excludeDex(dexAddress)).to.be.revertedWith("DEX already excluded")
		})
	})

	describe("Transfer Mechanics", () => {
		it("Should transfer transferAmountUsed when transferring tokens between non-excluded addresses", async function () {
			const { contract, accounts } = await setupFixture()

			// Setup: activate phase, get pending claims, and end phase
			await contract.activateMinting()
			await contract.connect(accounts[1]).claimWind()
			const pendingAmount = await contract.pendingClaims(accounts[1].address)

			// Transfer tokens to the account to meet the balance requirement
			await contract.transfer(accounts[1].address, pendingAmount * BigInt(2))

			await contract.endPhaseManually()
			await time.increase(30 * 60 + 1) // Past claim activation time

			// Claim tokens to set transferAmountUsed
			await contract.connect(accounts[1]).transferTokens()
			const transferUsed = await contract.transferAmountUsed(accounts[1].address)
			expect(transferUsed).to.equal(pendingAmount)

			// Transfer tokens to another account
			await contract.connect(accounts[1]).transfer(accounts[2].address, pendingAmount)

			// Check that transferAmountUsed was transferred
			expect(await contract.transferAmountUsed(accounts[2].address)).to.equal(transferUsed)
		})

		it("Should not transfer transferAmountUsed when transferring to/from excluded DEX", async function () {
			const { contract, accounts } = await setupFixture()
			const dexAddress = accounts[5].address

			// Exclude the DEX
			await contract.excludeDex(dexAddress)

			// Setup: activate phase, get pending claims, and end phase
			await contract.activateMinting()
			await contract.connect(accounts[1]).claimWind()
			const pendingAmount = await contract.pendingClaims(accounts[1].address)

			// Transfer tokens to the account to meet the balance requirement
			await contract.transfer(accounts[1].address, pendingAmount * BigInt(2))

			await contract.endPhaseManually()
			await time.increase(30 * 60 + 1) // Past claim activation time

			// Claim tokens to set transferAmountUsed
			await contract.connect(accounts[1]).transferTokens()
	
			// Transfer tokens to the DEX
			await contract.connect(accounts[1]).transfer(dexAddress, pendingAmount)

			// Transfer from DEX to another account
			await contract.connect(accounts[5]).transfer(accounts[2].address, pendingAmount)

			// Check that transferAmountUsed was NOT transferred
			expect(await contract.transferAmountUsed(accounts[2].address)).to.equal(0)
		})

		it("Should verify proper tracking of multiple transferAmountUsed transfers", async function () {
			const { contract, accounts } = await setupFixture()

			// Setup: activate phase, get pending claims for multiple accounts
			await contract.activateMinting()

			// User 1 claims and transfers
			await contract.connect(accounts[1]).claimWind()
			const pendingAmount1 = await contract.pendingClaims(accounts[1].address)
			await contract.transfer(accounts[1].address, pendingAmount1 * BigInt(2))

			// User 2 claims and transfers
			await contract.connect(accounts[2]).claimWind()
			const pendingAmount2 = await contract.pendingClaims(accounts[2].address)
			await contract.transfer(accounts[2].address, pendingAmount2 * BigInt(2))

			await contract.endPhaseManually()
			await time.increase(30 * 60 + 1) // Past claim activation time

			// Both users claim tokens to set transferAmountUsed
			await contract.connect(accounts[1]).transferTokens()
			await contract.connect(accounts[2]).transferTokens()

			// User 1 transfers to User 3
			await contract.connect(accounts[1]).transfer(accounts[3].address, pendingAmount1)

			// User 3 transfers to User 4
			await contract.connect(accounts[3]).transfer(accounts[4].address, pendingAmount1)

			// Check that transferAmountUsed was properly tracked through the chain
			expect(await contract.transferAmountUsed(accounts[1].address)).to.equal(pendingAmount1)
			expect(await contract.transferAmountUsed(accounts[3].address)).to.equal(pendingAmount1)
			expect(await contract.transferAmountUsed(accounts[4].address)).to.equal(pendingAmount1)
		})
	})

	describe("Enhanced transferTokensForWallet Tests", () => {
		it("Should verify transferTokensForWallet moves tokens directly to receiver", async function () {
			const { contract, accounts } = await setupFixture()

			// Setup: activate phase, get pending claims, and end phase
			await contract.activateMinting()
			await contract.connect(accounts[1]).claimWind()
			const pendingAmount = await contract.pendingClaims(accounts[1].address)

			// Give proxy account enough tokens
			await contract.transfer(accounts[2].address, pendingAmount * BigInt(2))

			await contract.endPhaseManually()
			await time.increase(60 * 60 + 1) // Past proxy claim activation time

			// Check balance before
			const balanceBefore = await contract.balanceOf(accounts[1].address)

			// Perform proxy claim
			await expect(contract.connect(accounts[2]).transferTokensForWallet(accounts[1].address))
				.to.emit(contract, "TokensTransferedByProxy")
				.withArgs(accounts[2].address, accounts[1].address, pendingAmount)

			// Verify token movement
			expect(await contract.pendingClaims(accounts[1].address)).to.equal(0)
			expect(await contract.balanceOf(accounts[1].address)).to.equal(balanceBefore + pendingAmount)
			expect(await contract.balanceOf(accounts[2].address)).to.equal(pendingAmount * BigInt(2)) // Unchanged for proxy
		})

		it("Should not allow proxy transfer if caller has insufficient balance after transferAmountUsed", async function () {
			const { contract, accounts } = await setupFixture()

			// Setup: activate phase, get claims for two accounts
			await contract.activateMinting()
			await contract.connect(accounts[1]).claimWind()
			await contract.connect(accounts[2]).claimWind()

			const pendingAmount1 = await contract.pendingClaims(accounts[1].address)

			// Give account 3 enough tokens to act as proxy
			await contract.transfer(accounts[3].address, pendingAmount1)

			await contract.endPhaseManually()
			await time.increase(60 * 60 + 1) // Past proxy activation time

			// Should succeed for the first claim
			await contract.connect(accounts[3]).transferTokensForWallet(accounts[1].address)

			// Should fail for the second claim due to insufficient balance after transferAmountUsed
			await time.increase(30 * 60 + 1) // Past cooldown
			await expect(contract.connect(accounts[3]).transferTokensForWallet(accounts[2].address))
				.to.be.revertedWith("Insufficient balance for transfer, own more $WIND")
		})

		it("Should not allow proxy transfer for a wallet with no pending claims", async function () {
			const { contract, accounts } = await setupFixture()

			// Setup: activate phase, get claims, end phase
			await contract.activateMinting()
			await contract.endPhaseManually()
			await time.increase(60 * 60 + 1) // Past proxy activation time

			// Try to proxy claim for wallet with no pending claims
			await expect(contract.connect(accounts[2]).transferTokensForWallet(accounts[1].address))
				.to.be.revertedWith("No tokens to transfer for this wallet")
		})

		it("Should empty pending claims after successful proxy transfer", async function () {
			const { contract, accounts } = await setupFixture()

			// Setup: activate phase, get pending claims, and end phase
			await contract.activateMinting()
			await contract.connect(accounts[1]).claimWind()
			const pendingAmount = await contract.pendingClaims(accounts[1].address)

			// Give proxy account enough tokens
			await contract.transfer(accounts[2].address, pendingAmount * BigInt(2))

			await contract.endPhaseManually()
			await time.increase(60 * 60 + 1) // Past proxy claim activation time

			// Perform proxy claim
			await contract.connect(accounts[2]).transferTokensForWallet(accounts[1].address)

			// Verify pending claims are emptied
			expect(await contract.pendingClaims(accounts[1].address)).to.equal(0)

			// Try to claim again (should fail)
			await time.increase(30 * 60 + 1) // Past cooldown
			await expect(contract.connect(accounts[2]).transferTokensForWallet(accounts[1].address))
				.to.be.revertedWith("No tokens to transfer for this wallet")
		})

		it("Should handle concurrent claims and proxy transfers correctly", async function () {
			const { contract, accounts } = await setupFixture()

			// Setup: activate phase, make claims, give tokens
			await contract.activateMinting()

			// User 1 and User 2 both claim
			await contract.connect(accounts[1]).claimWind()
			await contract.connect(accounts[2]).claimWind()

			const pendingAmount1 = await contract.pendingClaims(accounts[1].address)
			const pendingAmount2 = await contract.pendingClaims(accounts[2].address)

			// Give tokens to all accounts
			await contract.transfer(accounts[1].address, pendingAmount1 * BigInt(2))
			await contract.transfer(accounts[2].address, pendingAmount2 * BigInt(2))
			await contract.transfer(accounts[3].address, pendingAmount1 + pendingAmount2)

			await contract.endPhaseManually()
			await time.increase(60 * 60 + 1) // Past all activation times

			// User 1 claims their own tokens
			await contract.connect(accounts[1]).transferTokens()

			// User 3 proxy claims for User 2
			await contract.connect(accounts[3]).transferTokensForWallet(accounts[2].address)

			// Verify final balances
			expect(await contract.pendingClaims(accounts[1].address)).to.equal(0)
			expect(await contract.pendingClaims(accounts[2].address)).to.equal(0)
			expect(await contract.balanceOf(accounts[1].address)).to.equal(pendingAmount1 * BigInt(3))
			expect(await contract.balanceOf(accounts[2].address)).to.equal(pendingAmount2 * BigInt(2) + pendingAmount2)

			// Verify transfer amounts used
			expect(await contract.transferAmountUsed(accounts[1].address)).to.equal(pendingAmount1)
		})
	})
})
