/**
 * 测试用部署辅助：可升级合约代理部署、createToken 签名
 */
import { network } from "hardhat";
import { createRequire } from "module";

const require = createRequire(import.meta.url);
const ERC1967ProxyArtifact = require("@openzeppelin/contracts/build/contracts/ERC1967Proxy.json");

export async function getEthers() {
  const { ethers } = await network.connect();
  return ethers;
}

export async function deployProxy(
  ethers: Awaited<ReturnType<typeof getEthers>>,
  implementationAddress: string,
  initData: string,
  signer: { address: string } & { deployTransaction?: { wait: () => Promise<unknown> } }
) {
  const ProxyFactory = new ethers.ContractFactory(
    ERC1967ProxyArtifact.abi,
    ERC1967ProxyArtifact.bytecode,
    signer as any
  );
  const proxy = await ProxyFactory.deploy(implementationAddress, initData);
  await proxy.waitForDeployment();
  return proxy.getAddress();
}

/**
 * 对 createToken 的 data 做链上一致的哈希并签名（无 Ethereum 消息前缀）
 * 合约端: keccak256(abi.encodePacked(data, CHAIN_ID, address(this)))
 * signer 需为 ethers.Wallet 或带 signingKey 的 signer
 */
export async function signCreateTokenData(
  ethers: Awaited<ReturnType<typeof getEthers>>,
  signer: { signingKey?: { sign: (digest: Uint8Array) => Promise<{ r: string; s: string; v: number }> }; signMessage?: (m: string | Uint8Array) => Promise<string> },
  data: string,
  chainId: bigint,
  coreAddress: string
): Promise<string> {
  const packed = ethers.solidityPacked(
    ["bytes", "uint256", "address"],
    [data, chainId, coreAddress]
  );
  const digest = ethers.keccak256(packed);
  const digestBytes = ethers.getBytes(digest);

  let sig: { r: string; s: string; v: number };
  if (signer.signingKey?.sign) {
    sig = await signer.signingKey.sign(digestBytes);
  } else if (signer.signMessage) {
    const flatSig = await signer.signMessage(ethers.getBytes(digest));
    const s = ethers.Signature.from(flatSig);
    sig = { r: s.r, s: s.s, v: s.v };
  } else {
    throw new Error("signer must have signingKey.sign or signMessage");
  }

  const v = sig.v >= 27 ? sig.v : sig.v + 27;
  const vHex = "0x" + (v < 16 ? "0" : "") + v.toString(16);
  return ethers.concat([sig.r, sig.s, vHex]);
}
