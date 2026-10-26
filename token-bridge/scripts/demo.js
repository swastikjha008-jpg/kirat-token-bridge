// End-to-end demo on the in-process Hardhat network (no RPC needed):
//   lock -> mint -> burn -> release
//
//   npx hardhat run scripts/demo.js
const { ethers } = require("hardhat");
const { signTransfer } = require("./lib/signing");

const HOME = 1n;
const REMOTE = 8453n;

/** Find and decode the first event called `name` in a receipt. */
function findEvent(contract, receipt, name) {
  for (const log of receipt.logs) {
    let parsed = null;
    try {
      parsed = contract.interface.parseLog(log);
    } catch {
      // log from another contract (e.g. the ERC-20), skip
    }
    if (parsed && parsed.name === name) return parsed;
  }
  throw new Error(`Event ${name} not found`);
}

async function main() {
  const [deployer, user, v1, v2, v3] = await ethers.getSigners();
  const validators = [v1, v2, v3];
  const addrs = await Promise.all(validators.map((v) => v.getAddress()));

  const kirat = await (await ethers.getContractFactory("Kirat")).deploy(ethers.parseEther("1000"), user.address);
  const source = await (await ethers.getContractFactory("BridgeSource")).deploy(await kirat.getAddress(), REMOTE, addrs, 2, deployer.address);
  const dest = await (await ethers.getContractFactory("BridgeDestination")).deploy(HOME, addrs, 2, deployer.address);
  const wkirat = await ethers.getContractAt("WrappedKirat", await dest.wrappedToken());

  const show = async (label) => {
    const f = (x) => ethers.formatEther(x);
    console.log(
      `${label.padEnd(26)} user Kirat=${f(await kirat.balanceOf(user.address))}  locked=${f(await source.totalLocked())}  user WKirat=${f(await wkirat.balanceOf(user.address))}`
    );
  };

  const amount = ethers.parseEther("100");
  await show("start");

  // 1) lock on home chain
  await (await kirat.connect(user).approve(await source.getAddress(), amount)).wait();
  const lockRc = await (await source.connect(user).lock(amount, user.address)).wait();
  const locked = findEvent(source, lockRc, "Locked");
  await show("after lock");

  // 2) validators sign, anyone relays -> mint on destination
  let sigs = await signTransfer([v1, v3], dest, locked.args.recipient, locked.args.amount, locked.args.nonce);
  await (await dest.mint(locked.args.recipient, locked.args.amount, locked.args.nonce, sigs)).wait();
  await show("after mint");

  // 3) burn on destination
  const burnRc = await (await dest.connect(user).burn(amount, user.address)).wait();
  const burned = findEvent(dest, burnRc, "Burned");
  await show("after burn");

  // 4) validators sign, anyone relays -> release on home chain
  sigs = await signTransfer([v2, v3], source, burned.args.recipient, burned.args.amount, burned.args.nonce);
  await (await source.release(burned.args.recipient, burned.args.amount, burned.args.nonce, sigs)).wait();
  await show("after release");
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
