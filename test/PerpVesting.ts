import { time, loadFixture } from "@nomicfoundation/hardhat-network-helpers";
import { anyValue } from "@nomicfoundation/hardhat-chai-matchers/withArgs";
import { expect } from "chai";
import { ethers } from "hardhat";

describe("PerpVesting", function() {
  const WEEK_IN_SECS = 7 * 24 * 60 * 60;
  // We define a fixture to reuse the same setup in every test.
  // We use loadFixture to run this setup once, snapshot that state,
  // and reset Hardhat Network to that snapshot in every test.
  async function deployWithToken() {

    const periodLength = WEEK_IN_SECS;
    const lockedPeriods = 2;
    const periodAmount = ethers.utils.parseEther("1");

    // Contracts are deployed using the first signer/account by default
    const [owner, otherAccount] = await ethers.getSigners();

    const TestToken = await ethers.getContractFactory("TestToken");
    const testToken = await TestToken.deploy();

    const PerpVesting = await ethers.getContractFactory("PerpVesting");
    const perpVesting = await PerpVesting.deploy(
      testToken.address,
      otherAccount.address,
      periodLength,
      lockedPeriods,
      periodAmount
    );

    await testToken.approve(
      perpVesting.address, ethers.utils.parseEther("1000"));

    return {
      testToken, perpVesting, periodLength, lockedPeriods, periodAmount,
      owner, otherAccount
    };
  }

  describe("Deployment", function() {
    it("Should create TestToken", async function() {
      const { testToken, perpVesting, owner } = await loadFixture(deployWithToken);

      expect(await testToken.balanceOf(owner.address))
        .to.equal(ethers.utils.parseEther("1000"));
      expect(await testToken.allowance(owner.address, perpVesting.address))
        .to.equal(ethers.utils.parseEther("1000"));
    });
    it("Should create PerpVesting", async function() {
      const { testToken, perpVesting, owner, otherAccount } = await loadFixture(deployWithToken);

      expect(await perpVesting.sender())
        .to.equal(owner.address);
      expect(await perpVesting.receiver())
        .to.equal(otherAccount.address);
    });

    it("Should set start date when accepting", async function() {
      const { perpVesting, otherAccount } = await loadFixture(deployWithToken);

      expect(await perpVesting.connect(otherAccount).acceptTerms())
        .to.emit("PerpVesting", "TermsAccepted")
        .withArgs(otherAccount.address);

      const latestBlock = await ethers.provider.getBlockNumber();
      const block = await ethers.provider.getBlock(latestBlock);
      expect(await perpVesting.startedAt())
        .to.equal(block.timestamp);
    });

    it("Should accept terms only once", async function() {
      const { perpVesting, otherAccount } = await loadFixture(deployWithToken);

      expect(await perpVesting.connect(otherAccount).acceptTerms())
        .to.emit("PerpVesting", "TermsAccepted")
        .withArgs(otherAccount.address);

      await expect(perpVesting.connect(otherAccount).acceptTerms())
        .to.be.revertedWith("Contract already accepted");
    });

    it("Should accept terms only receiver", async function() {
      const { perpVesting } = await loadFixture(deployWithToken);

      await expect(perpVesting.acceptTerms())
        .to.be.revertedWith("Not the receiver");
    })
  });

  describe("Withdrawal", function() {
    it("Should deposit some amount", async function() {
      const { testToken, perpVesting, owner } = await loadFixture(deployWithToken);
      const amount = ethers.utils.parseEther("1");

      expect(await perpVesting.deposit(amount))
        .to.emit("PerpVesting", "Deposited")
        .withArgs(owner.address, amount);

      expect(await perpVesting.depositedAmount())
        .to.equal(amount);
      expect(await perpVesting.depositedAllTime())
        .to.equal(amount);
      expect(await testToken.balanceOf(perpVesting.address))
        .to.equal(amount);
    });

    it("Should allow full withdraw when contract is not yet accepted", async function() {
      const { testToken, perpVesting, owner } = await loadFixture(deployWithToken);
      const amount = ethers.utils.parseEther("1");
      const balanceBefore = await testToken.balanceOf(owner.address);

      await perpVesting.deposit(amount);

      // some amount is missing from the inital balance
      expect(await testToken.balanceOf(owner.address))
        .to.not.equal(balanceBefore);

      expect(await perpVesting.withdraw(amount))
        .to.emit("PerpVesting", "Withdrawn")
        .withArgs(owner.address, amount);

      // all of the funds were returned
      expect(await perpVesting.depositedAmount())
        .to.equal(0);
      expect(await testToken.balanceOf(owner.address))
        .to.equal(balanceBefore);

    });

    it("Should allow only sender account", async function() {
      const { testToken, perpVesting, owner, otherAccount } = await loadFixture(deployWithToken);
      const amount = ethers.utils.parseEther("1");

      await perpVesting.deposit(amount);

      await expect(perpVesting.connect(otherAccount).withdraw(amount))
        .to.be.revertedWith("Not the sender");
    });

    it("Should not allow withdraw when all funds are locked", async function() {
      const { perpVesting, otherAccount } = await loadFixture(deployWithToken);
      const amount = ethers.utils.parseEther("1");

      await perpVesting.deposit(amount);
      await perpVesting.connect(otherAccount).acceptTerms();

      await expect(perpVesting.withdraw(amount))
        .to.be.revertedWith("Insufficient unlocked funds available");
    });

    it("Should not allow withdraw all funds when partially locked", async function() {
      const { perpVesting, otherAccount } = await loadFixture(deployWithToken);
      const amount = ethers.utils.parseEther("10");

      await perpVesting.deposit(amount);
      await perpVesting.connect(otherAccount).acceptTerms();

      await expect(perpVesting.withdraw(amount))
        .to.be.revertedWith("Insufficient unlocked funds available");
    });

    it("Should allow partial withdraw after start", async function() {
      const { testToken, perpVesting, owner, otherAccount, lockedPeriods, periodAmount }
        = await loadFixture(deployWithToken);
      const amount = ethers.utils.parseEther("10");
      const lockedAmount = periodAmount.mul(lockedPeriods);
      const withdrawAmount = amount.sub(lockedAmount);

      const balanceBefore = await testToken.balanceOf(owner.address);

      await perpVesting.deposit(amount);
      await perpVesting.connect(otherAccount).acceptTerms();

      expect(await perpVesting.withdraw(withdrawAmount))
        .to.emit("PerpVesting", "Withdrawn")
        .withArgs(owner.address, withdrawAmount);

      // all of the funds were returned
      expect(await perpVesting.depositedAmount())
        .to.equal(lockedAmount);
      expect(await testToken.balanceOf(owner.address))
        .to.equal(balanceBefore.sub(lockedAmount));
    });

    it("Should allow partial withdraw after some time", async function() {
      const { testToken, perpVesting, owner, otherAccount,
        lockedPeriods, periodAmount, periodLength }
        = await loadFixture(deployWithToken);
      const amount = ethers.utils.parseEther("10");
      const lockedAmount = periodAmount.mul(lockedPeriods + 1);
      const withdrawAmount = amount.sub(lockedAmount);

      const balanceBefore = await testToken.balanceOf(owner.address);

      await perpVesting.deposit(amount);
      await perpVesting.connect(otherAccount).acceptTerms();

      // forward 1 period
      await time.increase(periodLength);

      expect(await perpVesting.withdraw(withdrawAmount))
        .to.emit("PerpVesting", "Withdrawn")
        .withArgs(owner.address, withdrawAmount);

      // all of the funds were returned
      expect(await perpVesting.depositedAmount())
        .to.equal(lockedAmount);
      expect(await testToken.balanceOf(owner.address))
        .to.equal(balanceBefore.sub(lockedAmount));
    });

    it("Should allow partial withdraw after claim", async function() {
      const { testToken, perpVesting, owner, otherAccount,
        lockedPeriods, periodAmount, periodLength }
        = await loadFixture(deployWithToken);
      const amount = ethers.utils.parseEther("10");
      const lockedAmount = periodAmount.mul(lockedPeriods + 1);
      const withdrawAmount = amount.sub(lockedAmount);

      const balanceBefore = await testToken.balanceOf(owner.address);

      await perpVesting.deposit(amount);
      await perpVesting.connect(otherAccount).acceptTerms();

      // forward 1 period
      await time.increase(periodLength);
      await perpVesting.connect(otherAccount).claim();

      expect(await perpVesting.withdraw(withdrawAmount))
        .to.emit("PerpVesting", "Withdrawn")
        .withArgs(owner.address, withdrawAmount);

      // all of the funds were returned
      expect(await perpVesting.depositedAmount())
        .to.equal(lockedAmount.sub(periodAmount));
      expect(await testToken.balanceOf(owner.address))
        .to.equal(balanceBefore.sub(lockedAmount));
    });

    it("Should not allow withdraw of locked funds after some time", async function() {
      const { perpVesting, otherAccount,
        periodAmount, periodLength }
        = await loadFixture(deployWithToken);
      const amount = ethers.utils.parseEther("10");
      const withdrawAmount = amount.sub(periodAmount);

      await perpVesting.deposit(amount);
      await perpVesting.connect(otherAccount).acceptTerms();

      await time.increase(periodLength);

      await expect(perpVesting.withdraw(withdrawAmount))
        .to.be.revertedWith("Insufficient unlocked funds available");
    });

    it("Should not allow withdraw of locked funds after claim", async function() {
      const { perpVesting, otherAccount,
        periodAmount, periodLength }
        = await loadFixture(deployWithToken);
      const amount = ethers.utils.parseEther("10");
      const withdrawAmount = amount.sub(periodAmount);

      await perpVesting.deposit(amount);
      await perpVesting.connect(otherAccount).acceptTerms();

      await time.increase(periodLength);
      await perpVesting.connect(otherAccount).claim();

      await expect(perpVesting.withdraw(withdrawAmount))
        .to.be.revertedWith("Insufficient unlocked funds available");
    });
  });

  describe("Claim", function() {
    it("Should be claimable by the receiver", async function() {
      const { perpVesting }
        = await loadFixture(deployWithToken);

      await expect(perpVesting.claim())
        .to.be.revertedWith("Not the receiver");

    });

    it("Should be not claimable before accepting terms", async function() {
      const { perpVesting, otherAccount }
        = await loadFixture(deployWithToken);

      await expect(perpVesting.connect(otherAccount).claim())
        .to.be.revertedWith("Contract not accepted yet");
    });

    it("Should be able to claim unless there is something claimable, no funds", async function() {
      const { perpVesting, otherAccount }
        = await loadFixture(deployWithToken);

      await perpVesting.connect(otherAccount).acceptTerms();

      await expect(perpVesting.connect(otherAccount).claim())
        .to.be.revertedWith("Nothing to claim");
    });

    it("Should be able to claim unless there is something claimable, all funds locked", async function() {
      const { testToken, perpVesting, otherAccount }
        = await loadFixture(deployWithToken);

      const amount = ethers.utils.parseEther("1"); // all funds are locked

      await perpVesting.deposit(amount);
      await perpVesting.connect(otherAccount).acceptTerms();

      await expect(perpVesting.connect(otherAccount).claim())
        .to.be.revertedWith("Nothing to claim");
      expect(await testToken.balanceOf(perpVesting.address))
        .to.be.equal(amount);
    });

    it("Should be able to claim unless there is something claimable", async function() {
      const { testToken, perpVesting, otherAccount }
        = await loadFixture(deployWithToken);

      const amount = ethers.utils.parseEther("10"); // there are unlocked funds

      await perpVesting.deposit(amount);
      await perpVesting.connect(otherAccount).acceptTerms();

      await expect(perpVesting.connect(otherAccount).claim())
        .to.be.revertedWith("Nothing to claim");
      expect(await testToken.balanceOf(perpVesting.address))
        .to.be.equal(amount);
    });

    it("Should claim first period", async function() {
      const { testToken, perpVesting, otherAccount, periodLength, periodAmount }
        = await loadFixture(deployWithToken);

      const amount = ethers.utils.parseEther("10");

      await perpVesting.deposit(amount);
      await perpVesting.connect(otherAccount).acceptTerms();

      const lastClaimAt = await perpVesting.lastClaimAt();
      await time.increase(periodLength + 1);

      const claimable = await perpVesting.claimable();
      expect(claimable).to.be.equal(periodAmount);

      expect(await perpVesting.connect(otherAccount).claim())
        .and.to.emit("PerpVesting", "Claim")
        .withArgs(otherAccount.address, periodAmount);
      expect(await testToken.balanceOf(otherAccount.address))
        .to.be.equal(periodAmount);
      expect(await testToken.balanceOf(perpVesting.address))
        .to.be.equal(amount.sub(periodAmount));

      expect(await perpVesting.lastClaimAt())
        .to.be.greaterThan(lastClaimAt);
    });

    it("Should claim first period and deny immediate second claim", async function() {
      const { testToken, perpVesting, otherAccount, periodLength, periodAmount }
        = await loadFixture(deployWithToken);

      const amount = ethers.utils.parseEther("10");

      await perpVesting.deposit(amount);
      await perpVesting.connect(otherAccount).acceptTerms();

      const lastClaimAt = await perpVesting.lastClaimAt();
      await time.increase(periodLength + 1);

      const claimable = await perpVesting.claimable();
      expect(claimable).to.be.equal(periodAmount);

      const fundsInContract = amount.sub(periodAmount)

      expect(await perpVesting.connect(otherAccount).claim())
        .and.to.emit("PerpVesting", "Claim")
        .withArgs(otherAccount.address, periodAmount);
      expect(await testToken.balanceOf(otherAccount.address))
        .to.be.equal(periodAmount);
      expect(await testToken.balanceOf(perpVesting.address))
        .to.be.equal(fundsInContract);

      expect(await perpVesting.lastClaimAt())
        .to.be.greaterThan(lastClaimAt);

        // second claim attempt
      await expect(perpVesting.connect(otherAccount).claim())
        .to.be.revertedWith("Nothing to claim");
      expect(await testToken.balanceOf(perpVesting.address))
        .to.be.equal(fundsInContract);
    });

    it("Should claim 2 consecutive periods", async function() {
      const { testToken, perpVesting, otherAccount, periodLength, periodAmount }
        = await loadFixture(deployWithToken);

      const amount = ethers.utils.parseEther("10");

      await perpVesting.deposit(amount);
      await perpVesting.connect(otherAccount).acceptTerms();

      const lastClaimAt = await perpVesting.lastClaimAt();
      await time.increase(periodLength + 1);

      const claimable = await perpVesting.claimable();
      expect(claimable).to.be.equal(periodAmount);

      const fundsInContract = amount.sub(periodAmount)

      expect(await perpVesting.connect(otherAccount).claim())
        .and.to.emit("PerpVesting", "Claim")
        .withArgs(otherAccount.address, periodAmount);
      expect(await testToken.balanceOf(otherAccount.address))
        .to.be.equal(periodAmount);
      expect(await testToken.balanceOf(perpVesting.address))
        .to.be.equal(fundsInContract);

      expect(await perpVesting.lastClaimAt())
        .to.be.greaterThan(lastClaimAt);

        // second claim
      const lastClaimAt_2 = await perpVesting.lastClaimAt();
      await time.increase(periodLength + 1);

      expect(await perpVesting.connect(otherAccount).claim())
        .and.to.emit("PerpVesting", "Claim")
        .withArgs(otherAccount.address, periodAmount);

      expect(await testToken.balanceOf(otherAccount.address))
        .to.be.equal(periodAmount.mul(2));
      expect(await testToken.balanceOf(perpVesting.address))
        .to.be.equal(fundsInContract.sub(periodAmount));

      expect(await perpVesting.lastClaimAt())
        .to.be.greaterThan(lastClaimAt_2);

      expect(await perpVesting.claimedAllTime())
        .to.be.equal(periodAmount.mul(2));
      expect(await perpVesting.depositedAmount())
        .to.be.equal(amount.sub(periodAmount.mul(2)));
    });

    it("Should claim multiple periods at once", async function() {
      const { testToken, perpVesting, otherAccount, periodLength, periodAmount }
        = await loadFixture(deployWithToken);

      const amount = ethers.utils.parseEther("10");
      const multiplier = 3;

      await perpVesting.deposit(amount);
      await perpVesting.connect(otherAccount).acceptTerms();

      const lastClaimAt = await perpVesting.lastClaimAt();
      await time.increase(periodLength * multiplier + 1);

      const toBeClaimed = periodAmount.mul(multiplier);

      const claimable = await perpVesting.claimable();
      expect(claimable).to.be.equal(toBeClaimed);

      const fundsInContract = amount.sub(toBeClaimed)

      expect(await perpVesting.connect(otherAccount).claim())
        .and.to.emit("PerpVesting", "Claim")
        .withArgs(otherAccount.address, toBeClaimed);
      expect(await testToken.balanceOf(otherAccount.address))
        .to.be.equal(toBeClaimed);
      expect(await testToken.balanceOf(perpVesting.address))
        .to.be.equal(fundsInContract);

      expect(await perpVesting.lastClaimAt())
        .to.be.greaterThan(lastClaimAt);
    });
  });

});
