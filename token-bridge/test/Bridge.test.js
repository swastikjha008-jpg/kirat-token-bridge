const { expect } = require("chai");
const { ethers } = require("hardhat");
const { loadFixture } = require("@nomicfoundation/hardhat-toolbox/network-helpers");
const { signTransfer } = require("../scripts/lib/signing");

const HOME_CHAIN_ID = 1n; // logical id of the home chain (Ethereum)
const REMOTE_CHAIN_ID = 8453n; // logical id of the destination chain (Base)
const THRESHOLD = 3;
const ONE = ethers.parseEther("1");
const HUNDRED = ethers.parseEther("100");

async function deployFixture() {
  const [owner, user, alice, outsider, v1, v2, v3, v4, v5] = await ethers.getSigners();
  const validators = [v1, v2, v3, v4, v5];
  const validatorAddrs = await Promise.all(validators.map((v) => v.getAddress()));

  const Kirat = await ethers.getContractFactory("Kirat");
  const kirat = await Kirat.deploy(ethers.parseEther("1000000"), user.address);

  const Source = await ethers.getContractFactory("BridgeSource");
  const source = await Source.deploy(await kirat.getAddress(), REMOTE_CHAIN_ID, validatorAddrs, THRESHOLD, owner.address);

  const Dest = await ethers.getContractFactory("BridgeDestination");
  const dest = await Dest.deploy(HOME_CHAIN_ID, validatorAddrs, THRESHOLD, owner.address);

  const wkirat = await ethers.getContractAt("WrappedKirat", await dest.wrappedToken());

  await kirat.connect(user).approve(await source.getAddress(), ethers.MaxUint256);

  return { owner, user, alice, outsider, validators, validatorAddrs, kirat, source, dest, wkirat };
}

/** lock on source + mint on destination; returns the mint nonce */
async function lockAndMint(f, signer, recipient, amount) {
  await f.source.connect(signer).lock(amount, recipient);
  const id = (await f.source.nonce()) - 1n;
  const sigs = await signTransfer(f.validators.slice(0, THRESHOLD), f.dest, recipient, amount, id);
  await f.dest.mint(recipient, amount, id, sigs);
  return id;
}

describe("Bridge", () => {
  describe("deployment", () => {
    it("configures source", async () => {
      const f = await loadFixture(deployFixture);
      expect(await f.source.token()).to.equal(await f.kirat.getAddress());
      expect(await f.source.remoteChainId()).to.equal(REMOTE_CHAIN_ID);
      expect(await f.source.threshold()).to.equal(THRESHOLD);
      expect(await f.source.validatorCount()).to.equal(5);
      expect(await f.source.owner()).to.equal(f.owner.address);
    });

    it("configures destination and wrapped token", async () => {
      const f = await loadFixture(deployFixture);
      expect(await f.dest.remoteChainId()).to.equal(HOME_CHAIN_ID);
      expect(await f.wkirat.bridge()).to.equal(await f.dest.getAddress());
      expect(await f.wkirat.symbol()).to.equal("WKIRAT");
      expect(await f.wkirat.totalSupply()).to.equal(0n);
    });

    it("rejects bad constructor params", async () => {
      const f = await loadFixture(deployFixture);
      const Source = await ethers.getContractFactory("BridgeSource");
      const k = await f.kirat.getAddress();
      await expect(Source.deploy(k, 1, f.validatorAddrs, 0, f.owner.address)).to.be.revertedWithCustomError(f.source, "InvalidThreshold");
      await expect(Source.deploy(k, 1, f.validatorAddrs, 6, f.owner.address)).to.be.revertedWithCustomError(f.source, "InvalidThreshold");
      await expect(Source.deploy(k, 1, [f.validatorAddrs[0], f.validatorAddrs[0]], 1, f.owner.address)).to.be.revertedWithCustomError(f.source, "AlreadyValidator");
      await expect(Source.deploy(k, 1, [ethers.ZeroAddress], 1, f.owner.address)).to.be.revertedWithCustomError(f.source, "ZeroAddress");
      await expect(Source.deploy(ethers.ZeroAddress, 1, f.validatorAddrs, 3, f.owner.address)).to.be.revertedWithCustomError(f.source, "ZeroAddress");
    });
  });

  describe("lock (home chain)", () => {
    it("locks tokens and emits Locked", async () => {
      const f = await loadFixture(deployFixture);
      await expect(f.source.connect(f.user).lock(HUNDRED, f.alice.address))
        .to.emit(f.source, "Locked")
        .withArgs(0, f.user.address, f.alice.address, HUNDRED, REMOTE_CHAIN_ID);
      expect(await f.kirat.balanceOf(await f.source.getAddress())).to.equal(HUNDRED);
      expect(await f.source.totalLocked()).to.equal(HUNDRED);
      expect(await f.source.nonce()).to.equal(1n);
    });

    it("increments the nonce per lock", async () => {
      const f = await loadFixture(deployFixture);
      await f.source.connect(f.user).lock(ONE, f.alice.address);
      await expect(f.source.connect(f.user).lock(ONE, f.alice.address)).to.emit(f.source, "Locked").withArgs(1, f.user.address, f.alice.address, ONE, REMOTE_CHAIN_ID);
    });

    it("reverts on zero amount / zero recipient / missing allowance", async () => {
      const f = await loadFixture(deployFixture);
      await expect(f.source.connect(f.user).lock(0, f.alice.address)).to.be.revertedWithCustomError(f.source, "ZeroAmount");
      await expect(f.source.connect(f.user).lock(ONE, ethers.ZeroAddress)).to.be.revertedWithCustomError(f.source, "ZeroAddress");
      await expect(f.source.connect(f.alice).lock(ONE, f.alice.address)).to.be.reverted; // no balance / allowance
    });

    it("reverts while paused", async () => {
      const f = await loadFixture(deployFixture);
      await f.source.pause();
      await expect(f.source.connect(f.user).lock(ONE, f.alice.address)).to.be.revertedWithCustomError(f.source, "EnforcedPause");
      await f.source.unpause();
      await expect(f.source.connect(f.user).lock(ONE, f.alice.address)).to.emit(f.source, "Locked");
    });

    it("rejects fee-on-transfer tokens", async () => {
      const f = await loadFixture(deployFixture);
      const Fee = await ethers.getContractFactory("FeeOnTransferToken");
      const fee = await Fee.deploy();
      const Source = await ethers.getContractFactory("BridgeSource");
      const s = await Source.deploy(await fee.getAddress(), REMOTE_CHAIN_ID, f.validatorAddrs, THRESHOLD, f.owner.address);
      await fee.approve(await s.getAddress(), ONE);
      await expect(s.lock(ONE, f.alice.address)).to.be.revertedWithCustomError(s, "TransferAmountMismatch");
    });
  });

  describe("mint (destination chain)", () => {
    it("mints WKirat with threshold signatures", async () => {
      const f = await loadFixture(deployFixture);
      await f.source.connect(f.user).lock(HUNDRED, f.alice.address);
      const sigs = await signTransfer(f.validators.slice(0, 3), f.dest, f.alice.address, HUNDRED, 0);
      await expect(f.dest.mint(f.alice.address, HUNDRED, 0, sigs)).to.emit(f.dest, "Minted").withArgs(0, f.alice.address, HUNDRED);
      expect(await f.wkirat.balanceOf(f.alice.address)).to.equal(HUNDRED);
      expect(await f.wkirat.totalSupply()).to.equal(HUNDRED);
      expect(await f.dest.processed(0)).to.equal(true);
    });

    it("accepts more than threshold signatures (any 3 or 5 of 5)", async () => {
      const f = await loadFixture(deployFixture);
      const sigs = await signTransfer(f.validators, f.dest, f.alice.address, ONE, 0);
      await f.dest.mint(f.alice.address, ONE, 0, sigs);
      expect(await f.wkirat.balanceOf(f.alice.address)).to.equal(ONE);
      const sigs2 = await signTransfer([f.validators[4], f.validators[1], f.validators[2]], f.dest, f.alice.address, ONE, 1);
      await f.dest.mint(f.alice.address, ONE, 1, sigs2);
      expect(await f.wkirat.balanceOf(f.alice.address)).to.equal(2n * ONE);
    });

    it("can be relayed by anyone", async () => {
      const f = await loadFixture(deployFixture);
      const sigs = await signTransfer(f.validators.slice(0, 3), f.dest, f.alice.address, ONE, 0);
      await f.dest.connect(f.outsider).mint(f.alice.address, ONE, 0, sigs);
      expect(await f.wkirat.balanceOf(f.alice.address)).to.equal(ONE);
    });

    it("rejects replay of the same nonce", async () => {
      const f = await loadFixture(deployFixture);
      const sigs = await signTransfer(f.validators.slice(0, 3), f.dest, f.alice.address, ONE, 0);
      await f.dest.mint(f.alice.address, ONE, 0, sigs);
      await expect(f.dest.mint(f.alice.address, ONE, 0, sigs)).to.be.revertedWithCustomError(f.dest, "AlreadyProcessed");
    });

    it("rejects too few signatures", async () => {
      const f = await loadFixture(deployFixture);
      const sigs = await signTransfer(f.validators.slice(0, 2), f.dest, f.alice.address, ONE, 0);
      await expect(f.dest.mint(f.alice.address, ONE, 0, sigs)).to.be.revertedWithCustomError(f.dest, "NotEnoughSignatures");
      await expect(f.dest.mint(f.alice.address, ONE, 0, [])).to.be.revertedWithCustomError(f.dest, "NotEnoughSignatures");
    });

    it("rejects duplicate signatures from one validator", async () => {
      const f = await loadFixture(deployFixture);
      const one = await signTransfer([f.validators[0]], f.dest, f.alice.address, ONE, 0);
      await expect(f.dest.mint(f.alice.address, ONE, 0, [one[0], one[0], one[0]])).to.be.revertedWithCustomError(f.dest, "InvalidSignatureOrder");
    });

    it("rejects unsorted signatures", async () => {
      const f = await loadFixture(deployFixture);
      const sigs = await signTransfer(f.validators.slice(0, 3), f.dest, f.alice.address, ONE, 0);
      await expect(f.dest.mint(f.alice.address, ONE, 0, [...sigs].reverse())).to.be.revertedWithCustomError(f.dest, "InvalidSignatureOrder");
    });

    it("rejects signatures from non-validators", async () => {
      const f = await loadFixture(deployFixture);
      const sigs = await signTransfer([f.validators[0], f.validators[1], f.outsider], f.dest, f.alice.address, ONE, 0);
      await expect(f.dest.mint(f.alice.address, ONE, 0, sigs)).to.be.revertedWithCustomError(f.dest, "InvalidSigner");
    });

    it("rejects tampered amount / recipient / nonce", async () => {
      const f = await loadFixture(deployFixture);
      const sigs = await signTransfer(f.validators.slice(0, 3), f.dest, f.alice.address, ONE, 0);
      await expect(f.dest.mint(f.alice.address, 2n * ONE, 0, sigs)).to.be.revertedWithCustomError(f.dest, "InvalidSigner");
      await expect(f.dest.mint(f.outsider.address, ONE, 0, sigs)).to.be.revertedWithCustomError(f.dest, "InvalidSigner");
      await expect(f.dest.mint(f.alice.address, ONE, 1, sigs)).to.be.revertedWithCustomError(f.dest, "InvalidSigner");
    });

    it("rejects a signature meant for the other bridge (cross-contract replay)", async () => {
      const f = await loadFixture(deployFixture);
      // signed for the source bridge, submitted to the destination bridge
      const sigs = await signTransfer(f.validators.slice(0, 3), f.source, f.alice.address, ONE, 0);
      await expect(f.dest.mint(f.alice.address, ONE, 0, sigs)).to.be.revertedWithCustomError(f.dest, "InvalidSigner");
    });

    it("rejects zero amount / zero recipient", async () => {
      const f = await loadFixture(deployFixture);
      const sigs = await signTransfer(f.validators.slice(0, 3), f.dest, f.alice.address, ONE, 0);
      await expect(f.dest.mint(f.alice.address, 0, 0, sigs)).to.be.revertedWithCustomError(f.dest, "ZeroAmount");
      await expect(f.dest.mint(ethers.ZeroAddress, ONE, 0, sigs)).to.be.revertedWithCustomError(f.dest, "ZeroAddress");
    });

    it("reverts while paused", async () => {
      const f = await loadFixture(deployFixture);
      const sigs = await signTransfer(f.validators.slice(0, 3), f.dest, f.alice.address, ONE, 0);
      await f.dest.pause();
      await expect(f.dest.mint(f.alice.address, ONE, 0, sigs)).to.be.revertedWithCustomError(f.dest, "EnforcedPause");
    });
  });

  describe("burn (destination chain)", () => {
    it("burns WKirat and emits Burned", async () => {
      const f = await loadFixture(deployFixture);
      await lockAndMint(f, f.user, f.alice.address, HUNDRED);
      await expect(f.dest.connect(f.alice).burn(HUNDRED, f.user.address))
        .to.emit(f.dest, "Burned")
        .withArgs(0, f.alice.address, f.user.address, HUNDRED, HOME_CHAIN_ID);
      expect(await f.wkirat.balanceOf(f.alice.address)).to.equal(0n);
      expect(await f.wkirat.totalSupply()).to.equal(0n);
      expect(await f.dest.nonce()).to.equal(1n);
    });

    it("reverts on insufficient balance / zero amount / zero recipient / paused", async () => {
      const f = await loadFixture(deployFixture);
      await expect(f.dest.connect(f.alice).burn(ONE, f.alice.address)).to.be.reverted;
      await expect(f.dest.connect(f.alice).burn(0, f.alice.address)).to.be.revertedWithCustomError(f.dest, "ZeroAmount");
      await expect(f.dest.connect(f.alice).burn(ONE, ethers.ZeroAddress)).to.be.revertedWithCustomError(f.dest, "ZeroAddress");
      await f.dest.pause();
      await expect(f.dest.connect(f.alice).burn(ONE, f.alice.address)).to.be.revertedWithCustomError(f.dest, "EnforcedPause");
    });
  });

  describe("release (home chain)", () => {
    it("releases Kirat after burn with threshold signatures", async () => {
      const f = await loadFixture(deployFixture);
      await lockAndMint(f, f.user, f.alice.address, HUNDRED);
      await f.dest.connect(f.alice).burn(HUNDRED, f.alice.address);

      const before = await f.kirat.balanceOf(f.alice.address);
      const sigs = await signTransfer(f.validators.slice(1, 4), f.source, f.alice.address, HUNDRED, 0);
      await expect(f.source.release(f.alice.address, HUNDRED, 0, sigs)).to.emit(f.source, "Released").withArgs(0, f.alice.address, HUNDRED);

      expect((await f.kirat.balanceOf(f.alice.address)) - before).to.equal(HUNDRED);
      expect(await f.source.totalLocked()).to.equal(0n);
      expect(await f.source.processed(0)).to.equal(true);
    });

    it("rejects replay, bad sigs, tampering", async () => {
      const f = await loadFixture(deployFixture);
      await lockAndMint(f, f.user, f.alice.address, HUNDRED);
      await f.dest.connect(f.alice).burn(HUNDRED, f.alice.address);
      const sigs = await signTransfer(f.validators.slice(0, 3), f.source, f.alice.address, HUNDRED, 0);

      await expect(f.source.release(f.alice.address, HUNDRED, 0, sigs.slice(0, 2))).to.be.revertedWithCustomError(f.source, "NotEnoughSignatures");
      await expect(f.source.release(f.outsider.address, HUNDRED, 0, sigs)).to.be.revertedWithCustomError(f.source, "InvalidSigner");
      await expect(f.source.release(f.alice.address, HUNDRED - 1n, 0, sigs)).to.be.revertedWithCustomError(f.source, "InvalidSigner");

      await f.source.release(f.alice.address, HUNDRED, 0, sigs);
      await expect(f.source.release(f.alice.address, HUNDRED, 0, sigs)).to.be.revertedWithCustomError(f.source, "AlreadyProcessed");
    });

    it("cannot release more than is locked, even with valid signatures", async () => {
      const f = await loadFixture(deployFixture);
      await f.source.connect(f.user).lock(ONE, f.alice.address);
      const sigs = await signTransfer(f.validators.slice(0, 3), f.source, f.alice.address, 2n * ONE, 7);
      await expect(f.source.release(f.alice.address, 2n * ONE, 7, sigs)).to.be.revertedWithCustomError(f.source, "InsufficientLocked");
    });

    it("rejects a signature meant for the destination bridge", async () => {
      const f = await loadFixture(deployFixture);
      await f.source.connect(f.user).lock(ONE, f.alice.address);
      const sigs = await signTransfer(f.validators.slice(0, 3), f.dest, f.alice.address, ONE, 0);
      await expect(f.source.release(f.alice.address, ONE, 0, sigs)).to.be.revertedWithCustomError(f.source, "InvalidSigner");
    });

    it("reverts while paused", async () => {
      const f = await loadFixture(deployFixture);
      await f.source.connect(f.user).lock(ONE, f.alice.address);
      const sigs = await signTransfer(f.validators.slice(0, 3), f.source, f.alice.address, ONE, 0);
      await f.source.pause();
      await expect(f.source.release(f.alice.address, ONE, 0, sigs)).to.be.revertedWithCustomError(f.source, "EnforcedPause");
    });
  });

  describe("full round trip & invariants", () => {
    it("keeps locked == wrapped supply across many transfers", async () => {
      const f = await loadFixture(deployFixture);
      await lockAndMint(f, f.user, f.alice.address, 300n * ONE);
      await lockAndMint(f, f.user, f.outsider.address, 50n * ONE);
      expect(await f.source.totalLocked()).to.equal(await f.wkirat.totalSupply());

      await f.dest.connect(f.alice).burn(120n * ONE, f.user.address);
      const sigs = await signTransfer(f.validators.slice(0, 3), f.source, f.user.address, 120n * ONE, 0);
      await f.source.release(f.user.address, 120n * ONE, 0, sigs);

      expect(await f.source.totalLocked()).to.equal(230n * ONE);
      expect(await f.wkirat.totalSupply()).to.equal(230n * ONE);
      expect(await f.kirat.balanceOf(await f.source.getAddress())).to.equal(230n * ONE);
    });
  });

  describe("validator admin", () => {
    it("only owner can administer", async () => {
      const f = await loadFixture(deployFixture);
      for (const c of [f.source, f.dest]) {
        await expect(c.connect(f.outsider).addValidator(f.outsider.address)).to.be.revertedWithCustomError(c, "OwnableUnauthorizedAccount");
        await expect(c.connect(f.outsider).removeValidator(f.validatorAddrs[0])).to.be.revertedWithCustomError(c, "OwnableUnauthorizedAccount");
        await expect(c.connect(f.outsider).setThreshold(1)).to.be.revertedWithCustomError(c, "OwnableUnauthorizedAccount");
        await expect(c.connect(f.outsider).pause()).to.be.revertedWithCustomError(c, "OwnableUnauthorizedAccount");
      }
    });

    it("adds / removes validators and updates threshold", async () => {
      const f = await loadFixture(deployFixture);
      await expect(f.dest.addValidator(f.outsider.address)).to.emit(f.dest, "ValidatorAdded").withArgs(f.outsider.address);
      expect(await f.dest.validatorCount()).to.equal(6n);
      await expect(f.dest.setThreshold(4)).to.emit(f.dest, "ThresholdChanged").withArgs(4);
      await expect(f.dest.removeValidator(f.outsider.address)).to.emit(f.dest, "ValidatorRemoved").withArgs(f.outsider.address);
      expect(await f.dest.isValidator(f.outsider.address)).to.equal(false);
    });

    it("guards invalid admin changes", async () => {
      const f = await loadFixture(deployFixture);
      await expect(f.dest.addValidator(f.validatorAddrs[0])).to.be.revertedWithCustomError(f.dest, "AlreadyValidator");
      await expect(f.dest.addValidator(ethers.ZeroAddress)).to.be.revertedWithCustomError(f.dest, "ZeroAddress");
      await expect(f.dest.removeValidator(f.outsider.address)).to.be.revertedWithCustomError(f.dest, "NotValidator");
      await expect(f.dest.setThreshold(0)).to.be.revertedWithCustomError(f.dest, "InvalidThreshold");
      await expect(f.dest.setThreshold(6)).to.be.revertedWithCustomError(f.dest, "InvalidThreshold");
      await f.dest.setThreshold(5);
      await expect(f.dest.removeValidator(f.validatorAddrs[0])).to.be.revertedWithCustomError(f.dest, "InvalidThreshold");
    });

    it("a removed validator's signature no longer counts", async () => {
      const f = await loadFixture(deployFixture);
      await f.dest.removeValidator(f.validatorAddrs[0]);
      const sigs = await signTransfer(f.validators.slice(0, 3), f.dest, f.alice.address, ONE, 0);
      await expect(f.dest.mint(f.alice.address, ONE, 0, sigs)).to.be.revertedWithCustomError(f.dest, "InvalidSigner");
    });
  });

  describe("WrappedKirat access control", () => {
    it("only the bridge can mint or burn", async () => {
      const f = await loadFixture(deployFixture);
      await expect(f.wkirat.connect(f.outsider).mint(f.outsider.address, ONE)).to.be.revertedWithCustomError(f.wkirat, "NotBridge");
      await expect(f.wkirat.connect(f.outsider).burnFrom(f.alice.address, ONE)).to.be.revertedWithCustomError(f.wkirat, "NotBridge");
    });
  });
});
