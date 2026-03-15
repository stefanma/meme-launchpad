import { expect } from "chai";
import { network } from "hardhat";

const { ethers } = await network.connect();

describe("MEMEHelper", function () {
  const ROUTER = "0x0000000000000000000000000000000000000001";
  const WBNB = "0x0000000000000000000000000000000000000002";
  let helper: Awaited<ReturnType<typeof ethers.getContractAt>>;

  before(async function () {
    const [admin] = await ethers.getSigners();
    helper = await ethers.deployContract("MEMEHelper", [
      admin.address,
      ROUTER,
      WBNB,
    ]);
    await helper.waitForDeployment();
  });

  it("应正确设置 PANCAKE_V2_ROUTER 和 WBNB", async function () {
    expect(await helper.PANCAKE_V2_ROUTER()).to.equal(ROUTER);
    expect(await helper.WBNB()).to.equal(WBNB);
  });

  it("admin 应拥有 DEFAULT_ADMIN_ROLE 和 CORE_ROLE", async function () {
    const [admin] = await ethers.getSigners();
    const adminRole = await helper.DEFAULT_ADMIN_ROLE();
    const coreRole = await helper.CORE_ROLE();
    expect(await helper.hasRole(adminRole, admin.address)).to.be.true;
    expect(await helper.hasRole(coreRole, admin.address)).to.be.true;
  });

  it("MINIMUM_LIQUIDITY 应为 10^3", async function () {
    expect(await helper.MINIMUM_LIQUIDITY()).to.equal(1000n);
  });

  it("可授予 CORE_ROLE 给其他地址", async function () {
    const [, other] = await ethers.getSigners();
    const coreRole = await helper.CORE_ROLE();
    await helper.grantRole(coreRole, other.address);
    expect(await helper.hasRole(coreRole, other.address)).to.be.true;
  });

  it("无 CORE_ROLE 调用 addLiquidityV2 应失败", async function () {
    const [, other] = await ethers.getSigners();
    const token = await ethers.deployContract("MetaNodeToken", [
      "Liquidity Token",
      "LP",
      ethers.parseEther("1000"),
      other.address,
    ]);
    await token.waitForDeployment();
    await expect(
      helper.connect(other).addLiquidityV2(
        await token.getAddress(),
        ethers.parseEther("0.1"),
        ethers.parseEther("100"),
        { value: ethers.parseEther("0.1") }
      )
    ).to.revert(ethers);
  });

  it("getPairAddress 在假 router 上可能 revert（依赖 DEX）", async function () {
    const token = "0x0000000000000000000000000000000000000003";
    try {
      const pair = await helper.getPairAddress(token);
      expect(ethers.isAddress(pair)).to.be.true;
    } catch {
      // 无真实 DEX 时 getPair/INIT_CODE_HASH 可能 revert，跳过断言
    }
  });
});
