import { expect } from "chai";
import { network } from "hardhat";
import { deployProxy } from "./helpers/deploy.js";

const { ethers } = await network.connect();

describe("MEMEVesting", function () {
  let vestingImpl: Awaited<ReturnType<typeof ethers.getContractAt>>;
  let vestingProxy: Awaited<ReturnType<typeof ethers.getContractAt>>;
  let token: Awaited<ReturnType<typeof ethers.getContractAt>>;
  let core: string;
  let admin: { address: string };

  before(async function () {
    const [signer] = await ethers.getSigners();
    admin = signer;
    core = signer.address;

    vestingImpl = await ethers.deployContract("MEMEVesting");
    await vestingImpl.waitForDeployment();
    const initData = vestingImpl.interface.encodeFunctionData("initialize", [
      signer.address,
      core,
    ]);
    const proxyAddress = await deployProxy(
      ethers,
      await vestingImpl.getAddress(),
      initData,
      signer as any
    );
    vestingProxy = await ethers.getContractAt("MEMEVesting", proxyAddress);

    token = await ethers.deployContract("MetaNodeToken", [
      "Vesting Token",
      "VST",
      ethers.parseEther("1000000"),
      signer.address,
    ]);
    await token.waitForDeployment();
  });

  it("应正确初始化并授予 OPERATOR_ROLE 给 core", async function () {
    const operatorRole = await vestingProxy.OPERATOR_ROLE();
    expect(await vestingProxy.hasRole(operatorRole, core)).to.be.true;
  });

  it("仅 OPERATOR_ROLE 可调用 createVestingSchedules", async function () {
    const amount = ethers.parseEther("1000");
    await token.setTransferMode(0n);
    await token.approve(await vestingProxy.getAddress(), amount);

    const allocations = [
      {
        amount,
        launchTime: 0n,
        duration: 86400n * 30n,
        mode: 2n, // LINEAR
      },
    ];

    await expect(
      vestingProxy.createVestingSchedules(
        await token.getAddress(),
        admin.address,
        allocations
      )
    ).to.emit(vestingProxy, "VestingScheduleCreated");

    expect(await vestingProxy.totalTokenLocked(await token.getAddress())).to.equal(amount);
  });

  it("无 OPERATOR_ROLE 调用 createVestingSchedules 应失败", async function () {
    const [, other] = await ethers.getSigners();
    await expect(
      vestingProxy.connect(other).createVestingSchedules(
        await token.getAddress(),
        other.address,
        [{ amount: 1n, launchTime: 0n, duration: 1n, mode: 2n }]
      )
    ).to.be.revertedWithCustomError(vestingProxy, "AccessControlUnauthorizedAccount");
  });

  it("零地址或空 allocations 应 revert", async function () {
    await expect(
      vestingProxy.createVestingSchedules(
        ethers.ZeroAddress,
        admin.address,
        [{ amount: 1n, launchTime: 0n, duration: 1n, mode: 2n }]
      )
    ).to.be.revertedWithCustomError(vestingProxy, "InvalidAddressParameters");

    await expect(
      vestingProxy.createVestingSchedules(
        await token.getAddress(),
        admin.address,
        []
      )
    ).to.be.revertedWithCustomError(vestingProxy, "InvalidLengthParameters");
  });
});
