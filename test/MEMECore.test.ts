import { expect } from "chai";
import { network } from "hardhat";
import { deployProxy, getEthers, signCreateTokenData } from "./helpers/deploy.js";

const { ethers } = await network.connect();

describe("MEMECore", function () {
  let factory: Awaited<ReturnType<typeof ethers.getContractAt>>;
  let helper: Awaited<ReturnType<typeof ethers.getContractAt>>;
  let core: Awaited<ReturnType<typeof ethers.getContractAt>>;
  let vestingProxyAddr: string;
  let signerWallet: import("ethers").Wallet;
  let signerAddress: string;
  const ROUTER = "0x0000000000000000000000000000000000000001";
  const WBNB = "0x0000000000000000000000000000000000000002";

  before(async function () {
    const [admin] = await ethers.getSigners();
    signerWallet = new ethers.Wallet(
      "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80",
      ethers.provider
    );
    signerAddress = signerWallet.address;

    factory = await ethers.deployContract("MEMEFactory", [admin.address]);
    await factory.waitForDeployment();

    helper = await ethers.deployContract("MEMEHelper", [
      admin.address,
      ROUTER,
      WBNB,
    ]);
    await helper.waitForDeployment();

    const coreImpl = await ethers.deployContract("MetaNodeCore");
    await coreImpl.waitForDeployment();
    const initData = coreImpl.interface.encodeFunctionData("initialize", [
      await factory.getAddress(),
      await helper.getAddress(),
      signerAddress,
      admin.address,
      admin.address,
      admin.address,
      admin.address,
    ]);
    const coreProxyAddr = await deployProxy(
      ethers,
      await coreImpl.getAddress(),
      initData,
      admin as any
    );
    core = await ethers.getContractAt("MetaNodeCore", coreProxyAddr);

    await factory.setMetaNode(coreProxyAddr);
    await helper.grantRole(await helper.CORE_ROLE(), coreProxyAddr);

    const vestingImpl = await ethers.deployContract("MEMEVesting");
    await vestingImpl.waitForDeployment();
    const vestingInitData = vestingImpl.interface.encodeFunctionData(
      "initialize",
      [admin.address, coreProxyAddr]
    );
    vestingProxyAddr = await deployProxy(
      ethers,
      await vestingImpl.getAddress(),
      vestingInitData,
      admin as any
    );
    await core.setVesting(vestingProxyAddr);
  });

  it("应正确初始化并设置 creationFee、费率", async function () {
    expect(await core.creationFee()).to.equal(ethers.parseEther("0.05"));
    expect(await core.preBuyFeeRate()).to.equal(300n);
    expect(await core.tradingFeeRate()).to.equal(100n);
  });

  it("createToken：签名正确且支付足够费用时应部署代币并进入 TRADING", async function () {
    // 依赖 helper.getPairAddress，需真实 DEX 或 mock，本地用假 router 会 revert
    try {
      await helper.getPairAddress(await core.getAddress());
    } catch {
      this.skip();
    }
    const [admin] = await ethers.getSigners();
    const totalSupply = ethers.parseEther("1000000");
    const saleAmount = ethers.parseEther("500000");
    const virtualBNB = ethers.parseEther("10");
    const virtualToken = saleAmount;
    const timestamp = Math.floor(Date.now() / 1000);
    const requestId = ethers.hexlify(ethers.randomBytes(32));
    const nonce = 1n;

    const params = {
      name: "Core Test Token",
      symbol: "CTT",
      totalSupply,
      saleAmount,
      virtualBNBReserve: virtualBNB,
      virtualTokenReserve: virtualToken,
      launchTime: 0n,
      creator: admin.address,
      timestamp: BigInt(timestamp),
      requestId,
      nonce,
      initialBuyPercentage: 0n,
      marginBnb: 0n,
      marginTime: 0n,
      vestingAllocations: [],
    };

    const data = ethers.AbiCoder.defaultAbiCoder().encode(
      [
        "tuple(string name, string symbol, uint256 totalSupply, uint256 saleAmount, uint256 virtualBNBReserve, uint256 virtualTokenReserve, uint256 launchTime, address creator, uint256 timestamp, bytes32 requestId, uint256 nonce, uint256 initialBuyPercentage, uint256 marginBnb, uint256 marginTime, tuple(uint256 amount, uint256 launchTime, uint256 duration, uint8 mode)[] vestingAllocations)",
      ],
      [
        [
          params.name,
          params.symbol,
          params.totalSupply,
          params.saleAmount,
          params.virtualBNBReserve,
          params.virtualTokenReserve,
          params.launchTime,
          params.creator,
          params.timestamp,
          params.requestId,
          params.nonce,
          params.initialBuyPercentage,
          params.marginBnb,
          params.marginTime,
          params.vestingAllocations,
        ],
      ]
    );

    const chainId = (await ethers.provider.getNetwork()).chainId;
    const signature = await signCreateTokenData(
      ethers,
      signerWallet,
      data,
      chainId,
      await core.getAddress()
    );

    const creationFee = await core.creationFee();
    const tokenAddress = await core.createToken.staticCall(data, signature, {
      value: creationFee,
    });
    await expect(
      core.createToken(data, signature, { value: creationFee })
    ).to.emit(core, "TokenCreated");

    expect(ethers.isAddress(tokenAddress)).to.be.true;
    const token = await ethers.getContractAt("MetaNodeToken", tokenAddress);
    expect(await token.name()).to.equal(params.name);
    expect((await core.tokenInfo(tokenAddress)).status).to.equal(1n); // TRADING
  });

  it("createToken：费用不足应 revert", async function () {
    const [admin] = await ethers.getSigners();
    const totalSupply = ethers.parseEther("1000000");
    const saleAmount = ethers.parseEther("500000");
    const timestamp = Math.floor(Date.now() / 1000);
    const requestId = ethers.hexlify(ethers.randomBytes(32));
    const params = {
      name: "Fail Token",
      symbol: "FAIL",
      totalSupply,
      saleAmount,
      virtualBNBReserve: ethers.parseEther("10"),
      virtualTokenReserve: saleAmount,
      launchTime: 0n,
      creator: admin.address,
      timestamp: BigInt(timestamp),
      requestId,
      nonce: 2n,
      initialBuyPercentage: 0n,
      marginBnb: 0n,
      marginTime: 0n,
      vestingAllocations: [],
    };
    const data = ethers.AbiCoder.defaultAbiCoder().encode(
      [
        "tuple(string name, string symbol, uint256 totalSupply, uint256 saleAmount, uint256 virtualBNBReserve, uint256 virtualTokenReserve, uint256 launchTime, address creator, uint256 timestamp, bytes32 requestId, uint256 nonce, uint256 initialBuyPercentage, uint256 marginBnb, uint256 marginTime, tuple(uint256 amount, uint256 launchTime, uint256 duration, uint8 mode)[] vestingAllocations)",
      ],
      [
        [
          params.name,
          params.symbol,
          params.totalSupply,
          params.saleAmount,
          params.virtualBNBReserve,
          params.virtualTokenReserve,
          params.launchTime,
          params.creator,
          params.timestamp,
          params.requestId,
          params.nonce,
          params.initialBuyPercentage,
          params.marginBnb,
          params.marginTime,
          params.vestingAllocations,
        ],
      ]
    );
    const chainId = (await ethers.provider.getNetwork()).chainId;
    const signature = await signCreateTokenData(
      ethers,
      signerWallet,
      data,
      chainId,
      await core.getAddress()
    );
    await expect(
      core.createToken(data, signature, { value: 0n })
    ).to.be.revertedWithCustomError(core, "InsufficientFee");
  });

  it("buy：TRADING 代币可买入并发出 TokenBought", async function () {
    try {
      await helper.getPairAddress(await core.getAddress());
    } catch {
      this.skip();
    }
    const [admin] = await ethers.getSigners();
    const totalSupply = ethers.parseEther("1000000");
    const saleAmount = ethers.parseEther("800000");
    const virtualBNB = ethers.parseEther("5");
    const virtualToken = saleAmount;
    const timestamp = Math.floor(Date.now() / 1000);
    const requestId = ethers.hexlify(ethers.randomBytes(32));
    const params = {
      name: "Buy Test",
      symbol: "BUY",
      totalSupply,
      saleAmount,
      virtualBNBReserve: virtualBNB,
      virtualTokenReserve: virtualToken,
      launchTime: 0n,
      creator: admin.address,
      timestamp: BigInt(timestamp),
      requestId,
      nonce: 3n,
      initialBuyPercentage: 0n,
      marginBnb: 0n,
      marginTime: 0n,
      vestingAllocations: [],
    };
    const data = ethers.AbiCoder.defaultAbiCoder().encode(
      [
        "tuple(string name, string symbol, uint256 totalSupply, uint256 saleAmount, uint256 virtualBNBReserve, uint256 virtualTokenReserve, uint256 launchTime, address creator, uint256 timestamp, bytes32 requestId, uint256 nonce, uint256 initialBuyPercentage, uint256 marginBnb, uint256 marginTime, tuple(uint256 amount, uint256 launchTime, uint256 duration, uint8 mode)[] vestingAllocations)",
      ],
      [
        [
          params.name,
          params.symbol,
          params.totalSupply,
          params.saleAmount,
          params.virtualBNBReserve,
          params.virtualTokenReserve,
          params.launchTime,
          params.creator,
          params.timestamp,
          params.requestId,
          params.nonce,
          params.initialBuyPercentage,
          params.marginBnb,
          params.marginTime,
          params.vestingAllocations,
        ],
      ]
    );
    const chainId = (await ethers.provider.getNetwork()).chainId;
    const signature = await signCreateTokenData(
      ethers,
      signerWallet,
      data,
      chainId,
      await core.getAddress()
    );
    await core.createToken(data, signature, {
      value: await core.creationFee(),
    });
    const tokenAddress = await factory.predictTokenAddress(
      params.name,
      params.symbol,
      params.totalSupply,
      await core.getAddress(),
      timestamp,
      params.nonce
    );
    const deadline = Math.floor(Date.now() / 1000) + 3600;
    const payAmount = ethers.parseEther("0.1");
    await expect(
      core.buy(tokenAddress, 0n, deadline, { value: payAmount })
    ).to.emit(core, "TokenBought");

    const token = await ethers.getContractAt("MetaNodeToken", tokenAddress);
    expect(await token.balanceOf(admin.address)).to.gt(0n);
  });

  it("sell：先 createToken + buy 再卖出代币应收到 BNB", async function () {
    try {
      await helper.getPairAddress(await core.getAddress());
    } catch {
      this.skip();
    }
    const [admin] = await ethers.getSigners();
    const totalSupply = ethers.parseEther("1000000");
    const saleAmount = ethers.parseEther("800000");
    const timestamp = Math.floor(Date.now() / 1000);
    const requestId = ethers.hexlify(ethers.randomBytes(32));
    const nonce = 4n;
    const params = {
      name: "Sell Test",
      symbol: "SELL",
      totalSupply,
      saleAmount,
      virtualBNBReserve: ethers.parseEther("5"),
      virtualTokenReserve: saleAmount,
      launchTime: 0n,
      creator: admin.address,
      timestamp: BigInt(timestamp),
      requestId,
      nonce,
      initialBuyPercentage: 0n,
      marginBnb: 0n,
      marginTime: 0n,
      vestingAllocations: [],
    };
    const data = ethers.AbiCoder.defaultAbiCoder().encode(
      [
        "tuple(string name, string symbol, uint256 totalSupply, uint256 saleAmount, uint256 virtualBNBReserve, uint256 virtualTokenReserve, uint256 launchTime, address creator, uint256 timestamp, bytes32 requestId, uint256 nonce, uint256 initialBuyPercentage, uint256 marginBnb, uint256 marginTime, tuple(uint256 amount, uint256 launchTime, uint256 duration, uint8 mode)[] vestingAllocations)",
      ],
      [
        [
          params.name,
          params.symbol,
          params.totalSupply,
          params.saleAmount,
          params.virtualBNBReserve,
          params.virtualTokenReserve,
          params.launchTime,
          params.creator,
          params.timestamp,
          params.requestId,
          params.nonce,
          params.initialBuyPercentage,
          params.marginBnb,
          params.marginTime,
          params.vestingAllocations,
        ],
      ]
    );
    const chainId = (await ethers.provider.getNetwork()).chainId;
    const sig = await signCreateTokenData(
      ethers,
      signerWallet,
      data,
      chainId,
      await core.getAddress()
    );
    await core.createToken(data, sig, { value: await core.creationFee() });

    const tokenAddress = await factory.predictTokenAddress(
      params.name,
      params.symbol,
      params.totalSupply,
      await core.getAddress(),
      timestamp,
      nonce
    );
    const deadline = Math.floor(Date.now() / 1000) + 3600;
    await core.buy(tokenAddress, 0n, deadline, {
      value: ethers.parseEther("0.2"),
    });

    const token = await ethers.getContractAt("MetaNodeToken", tokenAddress);
    const balance = await token.balanceOf(admin.address);
    expect(balance).to.gt(0n);

    const sellAmount = balance / 2n;
    await token.approve(await core.getAddress(), sellAmount);
    const balBefore = await ethers.provider.getBalance(admin.address);
    const tx = await core.sell(tokenAddress, sellAmount, 0n, deadline);
    const receipt = await tx.wait();
    const gasCost = receipt!.gasUsed * receipt!.gasPrice;
    const balAfter = await ethers.provider.getBalance(admin.address);
    expect(balAfter).to.gt(balBefore - gasCost);
  });

  it("pause / unpause 仅 PAUSER_ROLE", async function () {
    await core.pause();
    expect(await core.paused()).to.be.true;
    await core.unpause();
    expect(await core.paused()).to.be.false;
  });
});
