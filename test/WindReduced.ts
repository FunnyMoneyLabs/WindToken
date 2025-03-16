import { expect } from "chai"
import { deployments, ethers, getNamedAccounts } from "hardhat"
import { time } from "@nomicfoundation/hardhat-network-helpers"
import { parseEther } from "ethers"

describe("WindTokenReduced", () => {
	const setupFixture = deployments.createFixture(async () => {
		await deployments.fixture()
		const signers = await getNamedAccounts()
		const name = "Wind 💨"
		const symbol = "WIND"
		const owner = signers.deployer
		const contract = await ethers.deployContract("WindTokenReduced", [], await ethers.getSigner(signers.deployer))
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

	describe("claimWind", () => {
		it("Should end the phase automatically if all tokens are claimed phase 1", async function () {
			const { contract, accounts } = await setupFixture()

			await contract.activateMinting()
			await contract.connect(accounts[1]).claimWind()
			expect(await contract.currentPhaseRemainingTokens()).to.equal(ethers.parseEther("9"))

			await time.increase(11)
			const tx = await contract.connect(accounts[2]).claimWind()
			const receipt = await tx.wait()
			const blockTimestamp = (await ethers.provider.getBlock(receipt.blockNumber)).timestamp

			await expect(tx).to.emit(contract, "PhaseEnded").withArgs(1, blockTimestamp)
			expect(await contract.currentPhaseRemainingTokens()).to.equal(ethers.parseEther("0"))
			expect(await contract.pendingClaims(accounts[1].address)).to.equal(ethers.parseEther("1"))
			expect(await contract.pendingClaims(accounts[2].address)).to.equal(ethers.parseEther("9"))
			expect(await contract.activePhase()).to.false

			expect(await contract.claimActivationTime()).to.be.greaterThan(0)
			expect(await contract.proxyClaimActivationTime()).to.be.greaterThan(0)
		})

		it("Should end the phase automatically if all tokens are claimed phase 2", async function () {
			const { contract, accounts } = await setupFixture()

			await contract.activateMinting()
			await contract.endPhaseManually()
			await contract.activateMinting()

			await contract.connect(accounts[1]).claimWind()
			expect(await contract.currentPhaseRemainingTokens()).to.equal(ethers.parseEther("19"))

			await time.increase(11)
			await contract.connect(accounts[1]).claimWind()
			const tx = await contract.connect(accounts[2]).claimWind()
			const receipt = await tx.wait()
			const blockTimestamp = (await ethers.provider.getBlock(receipt.blockNumber)).timestamp

			await expect(tx).to.emit(contract, "PhaseEnded").withArgs(2, blockTimestamp)
			expect(await contract.currentPhaseRemainingTokens()).to.equal(ethers.parseEther("0"))
			expect(await contract.pendingClaims(accounts[1].address)).to.equal(ethers.parseEther("11"))
			expect(await contract.pendingClaims(accounts[2].address)).to.equal(ethers.parseEther("9"))
			expect(await contract.activePhase()).to.false

			expect(await contract.claimActivationTime()).to.be.greaterThan(0)
			expect(await contract.proxyClaimActivationTime()).to.be.greaterThan(0)
		})

		it("Should end the phase automatically if all tokens are claimed phase 3", async function () {
			const { contract, accounts } = await setupFixture()

			await contract.activateMinting()
			await contract.endPhaseManually()
			await contract.activateMinting()
			await contract.endPhaseManually()
			await contract.activateMinting()

			await contract.connect(accounts[1]).claimWind()
			expect(await contract.currentPhaseRemainingTokens()).to.equal(ethers.parseEther("39"))

			await time.increase(11)
			await contract.connect(accounts[1]).claimWind()
			await contract.connect(accounts[1]).claimWind()
			await contract.connect(accounts[1]).claimWind()
			const tx = await contract.connect(accounts[2]).claimWind()
			const receipt = await tx.wait()
			const blockTimestamp = (await ethers.provider.getBlock(receipt.blockNumber)).timestamp

			await expect(tx).to.emit(contract, "PhaseEnded").withArgs(3, blockTimestamp)
			expect(await contract.currentPhaseRemainingTokens()).to.equal(ethers.parseEther("0"))
			expect(await contract.pendingClaims(accounts[1].address)).to.equal(ethers.parseEther("31"))
			expect(await contract.pendingClaims(accounts[2].address)).to.equal(ethers.parseEther("9"))
			expect(await contract.activePhase()).to.false

			expect(await contract.claimActivationTime()).to.be.greaterThan(0)
			expect(await contract.proxyClaimActivationTime()).to.be.greaterThan(0)
		})
	})
})
