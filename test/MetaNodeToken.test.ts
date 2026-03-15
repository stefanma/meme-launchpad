import { expect } from "chai";
import { network } from "hardhat";

const { ethers } = await network.connect();

describe("MetaNodeToken", function () {
  let token: Awaited<ReturnType<typeof ethers.getContractAt>>;
  let core: string;
  let user: { address: string };

  before(async function () {
    const [signer] = await ethers.getSigners();
    core = signer.address;
    user = signer;
    token = await ethers.deployContract("MetaNodeToken", [
      "Test Meme",
      "MEME",
      ethers.parseEther("1000000"),
      core,
    ]);
    await token.waitForDeployment();
  });

  it("应正确初始化名称、符号、供应量并铸造给 core", async function () {
    expect(await token.name()).to.equal("Test Meme");
    expect(await token.symbol()).to.equal("MEME");
    expect(await token.totalSupply()).to.equal(ethers.parseEther("1000000"));
    expect(await token.balanceOf(core)).to.equal(ethers.parseEther("1000000"));
    expect(await token.metaNodeCore()).to.equal(core);
  });

  it("初始 transferMode 应为 MODE_TRANSFER_RESTRICTED", async function () {
    const RESTRICTED = 1n;
    expect(await token.transferMode()).to.equal(RESTRICTED);
  });

  it("RESTRICTED 模式下普通转账应失败", async function () {
    const [, to] = await ethers.getSigners();
    await expect(
      token.transfer(to.address, ethers.parseEther("1"))
    ).to.be.revertedWithCustomError(token, "TransferRestricted");
  });

  it("仅 metaNodeCore 可调用 setTransferMode", async function () {
    const NORMAL = 0n;
    await expect(token.setTransferMode(NORMAL))
      .to.emit(token, "TransferModeChanged");
    expect(await token.transferMode()).to.equal(NORMAL);
  });

  it("非 metaNodeCore 调用 setTransferMode 应失败", async function () {
    const [, other] = await ethers.getSigners();
    await expect(
      token.connect(other).setTransferMode(1n)
    ).to.be.revertedWithCustomError(token, "onlyMetaNodeCall");
  });

  it("NORMAL 模式下可正常 transfer", async function () {
    const [, to] = await ethers.getSigners();
    const amount = ethers.parseEther("100");
    await token.transfer(to.address, amount);
    expect(await token.balanceOf(to.address)).to.equal(amount);
  });

  it("仅 metaNodeCore 可调用 setVestingContract 和 setPair", async function () {
    const vesting = "0x0000000000000000000000000000000000000001";
    const pair = "0x0000000000000000000000000000000000000002";
    await expect(token.setVestingContract(vesting))
      .to.emit(token, "VestingContractChanged")
      .withArgs(vesting);
    await expect(token.setPair(pair))
      .to.emit(token, "PairChanged")
      .withArgs(pair);
    expect(await token.vestingContract()).to.equal(vesting);
    expect(await token.pair()).to.equal(pair);
  });

  it("零地址 setVestingContract / setPair 应失败", async function () {
    await expect(
      token.setVestingContract(ethers.ZeroAddress)
    ).to.be.revertedWithCustomError(token, "ZeroAddress");
    await expect(
      token.setPair(ethers.ZeroAddress)
    ).to.be.revertedWithCustomError(token, "ZeroAddress");
  });

  it("burn 应减少供应量与余额", async function () {
    const amount = ethers.parseEther("10");
    const supplyBefore = await token.totalSupply();
    const balanceBefore = await token.balanceOf(core);
    await token.burn(amount);
    expect(await token.totalSupply()).to.equal(supplyBefore - amount);
    expect(await token.balanceOf(core)).to.equal(balanceBefore - amount);
  });
});
