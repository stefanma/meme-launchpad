import { expect } from "chai";
import { network } from "hardhat";
import { deployProxy, getEthers } from "./helpers/deploy.js";

const { ethers } = await network.connect();

describe("MEMEFactory", function () {
  let factory: Awaited<ReturnType<typeof ethers.getContractAt>>;
  let coreProxy: string;
  let admin: { address: string } & { getAddress?: () => Promise<string> };

  before(async function () {
    const [signer] = await ethers.getSigners();
    admin = signer;
    factory = await ethers.deployContract("MEMEFactory", [signer.address]);
    await factory.waitForDeployment();

    // 部署 Core 实现 + 代理，用于 setMetaNode 后 deployToken
    const helperStub = "0x0000000000000000000000000000000000000001";
    const coreImpl = await ethers.deployContract("MetaNodeCore");
    await coreImpl.waitForDeployment();
    const initData = coreImpl.interface.encodeFunctionData("initialize", [
      await factory.getAddress(),
      helperStub,
      signer.address,
      signer.address,
      signer.address,
      signer.address,
      signer.address,
    ]);
    coreProxy = await deployProxy(
      ethers,
      await coreImpl.getAddress(),
      initData,
      signer as any
    );
  });

  it("应正确设置 admin 并拥有 DEFAULT_ADMIN_ROLE", async function () {
    const [signer] = await ethers.getSigners();
    const role = await factory.DEFAULT_ADMIN_ROLE();
    expect(await factory.hasRole(role, signer.address)).to.be.true;
  });

  it("初始 metaNode 应为零地址", async function () {
    expect(await factory.metaNode()).to.equal(ethers.ZeroAddress);
  });

  it("仅 DEFAULT_ADMIN_ROLE 可调用 setMetaNode", async function () {
    await factory.setMetaNode(coreProxy);
    expect(await factory.metaNode()).to.equal(coreProxy);
  });

  it("非 admin 调用 setMetaNode 应失败", async function () {
    const [, other] = await ethers.getSigners();
    await expect(
      factory.connect(other).setMetaNode(other.address)
    ).to.be.revertedWithCustomError(factory, "AccessControlUnauthorizedAccount");
  });

  it("仅 DEPLOYER_ROLE 可调用 deployToken，代币铸造给 metaNode", async function () {
    const [signer] = await ethers.getSigners();
    await factory.grantRole(await factory.DEPLOYER_ROLE(), signer.address);

    const name = "Test Token";
    const symbol = "TST";
    const totalSupply = ethers.parseEther("1000000");
    const timestamp = Math.floor(Date.now() / 1000);
    const nonce = 1n;

    const tokenAddress = await factory.deployToken.staticCall(
      name,
      symbol,
      totalSupply,
      timestamp,
      nonce
    );

    await expect(
      factory.deployToken(name, symbol, totalSupply, timestamp, nonce)
    )
      .to.emit(factory, "TokenDeployed")
      .withArgs(tokenAddress, name, symbol, totalSupply, signer.address);

    const token = await ethers.getContractAt("MetaNodeToken", tokenAddress);
    expect(await token.name()).to.equal(name);
    expect(await token.symbol()).to.equal(symbol);
    expect(await token.totalSupply()).to.equal(totalSupply);
    expect(await token.balanceOf(coreProxy)).to.equal(totalSupply);
  });

  it("predictTokenAddress 应与实际 deployToken 地址一致", async function () {
    const [signer] = await ethers.getSigners();
    const name = "Predict Token";
    const symbol = "PRD";
    const totalSupply = ethers.parseEther("2000000");
    const timestamp = Math.floor(Date.now() / 1000);
    const nonce = 2n;

    const predicted = await factory.predictTokenAddress(
      name,
      symbol,
      totalSupply,
      coreProxy,
      timestamp,
      nonce
    );
    const deployed = await factory.deployToken.staticCall(
      name,
      symbol,
      totalSupply,
      timestamp,
      nonce
    );
    expect(predicted).to.equal(deployed);
    await factory.deployToken(name, symbol, totalSupply, timestamp, nonce);
  });

  it("无 DEPLOYER_ROLE 调用 deployToken 应失败", async function () {
    const [, other] = await ethers.getSigners();
    await expect(
      factory.connect(other).deployToken(
        "Bad",
        "BAD",
        ethers.parseEther("1"),
        Math.floor(Date.now() / 1000),
        99n
      )
    ).to.be.revertedWithCustomError(factory, "AccessControlUnauthorizedAccount");
  });
});
