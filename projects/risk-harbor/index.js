const sdk = require("@defillama/sdk");
const {
  queryV1Beta1,
  queryContract,
  getDenomBalance,
} = require("../helper/chain/terra");
const { sumTokens } = require("../helper/unwrapLPs");
const vaultManagerAbi = require("./vaultManager.abi.json");
const vaultAbi = require("./vault.abi.json");

const networks = {
  ethereum: {
    // V2.5 Factory (underwriting tokens are dynamically fetched)
    vaultManager: "0x7B99AfA5A2EC23499e6CD6955dEdF85318347cc9",
    // V2 Vaults
    vaults: [
      // [underwritingAsset, vaultAddress]
      [
        "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48",
        "0x83944C256e5C057A246aE1b1945934440eb35Af6",
      ],
      [
        "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48",
        "0x8D999a2f262FfDA47A734B987D1A15bc984e45Be",
      ],
      [
        "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48",
        "0x0881Ec8e0e743906E1c1dFeE8Ae12BfDc0611b24",
      ],
      [
        "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48",
        "0x8529687adD661120C9E23E366Cc7F545f1A03ADf",
      ],
      [
        "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48",
        "0x61635d1De721DD1DB35f8aCFD0f1ea367dF65671",
      ],
    ],
  },
  arbitrum: {
    vaults: [
      [
        "0xff970a61a04b1ca14834a43f5de4533ebddb5cc8",
        "0x207472891AF32F5636c35d9ca8e17464Df7108bB",
      ],
      [
        "0xff970a61a04b1ca14834a43f5de4533ebddb5cc8",
        "0xbcA81A2118982182d897845571BE950aE94C619c",
      ],
      [
        "0xff970a61a04b1ca14834a43f5de4533ebddb5cc8",
        "0x2DafE4DD7C661c2CEaf967d51206f5130AA32782",
      ],
    ],
  },
  avax: {
    vaultManager: "0xBf8c506a56F355d2340F37a91FA6569737b08254",
    vaults: [
      [
        "0xb97ef9ef8734c71904d8002f8b6bc66dd9c48a6e",
        "0x2DafE4DD7C661c2CEaf967d51206f5130AA32782",
      ],
      [
        // Count av3CRV in the above vault too
        "0x1337BedC9D22ecbe766dF105c9623922A27963EC",
        "0x2DafE4DD7C661c2CEaf967d51206f5130AA32782",
      ],
      [
        "0xb97ef9ef8734c71904d8002f8b6bc66dd9c48a6e",
        "0xBe09C11d28683E283fdf7566DE1685A6A221B6bf",
      ],
      [
        "0xb97ef9ef8734c71904d8002f8b6bc66dd9c48a6e",
        "0xBe09C11d28683E283fdf7566DE1685A6A221B6bf",
      ],
    ],
  },
  fantom: {
    vaults: [
      [
        "0x04068DA6C83AFCFA0e13ba15A6696662335D5B75",
        "0xca67B16b02E418CFbC9EF287C7C20B77dbb665f2",
      ],
    ],
  },
  aurora: {
    vaults: [
      [
        "0xb12bfca5a55806aaf64e99521918a4bf0fc40802",
        "0x8D999a2f262FfDA47A734B987D1A15bc984e45Be",
      ],
    ],
  },
  optimism: {
    vaultManager: "0x7c1187AF4D6B23F7f7682799454168E24bC06EED",
    vaults: [
      [
        "0x7F5c764cBc14f9669B88837ca1490cCa17c31607",
        "0xfB969b45Fa9186CD8B420407552aD447F7c3817b",
      ],
    ],
  },
  terra: {
    vaults: [
      "terra1dlfz2teqt5shxuw87npfecjtv7xlrxvqd4sapt", // Ozone v1 pool 1
      "terra1h6t8gx7jvc2ens9nrxcf9vqylzquey75e2wvzt", // Ozone v1 pool 2
    ],
  },
  terra2: {
    factory: "terra1lnq5rk4gla2c537hpyxq6wjs8g0k0dedxug2p50myydaqjtm4g5ss94y8n",
    masterPool:
      "terra1gz50vgzjssefzmld0kfkt7sfvejgel9znun9chsc82k09xfess5qqu8qyc", // Ozone v2 underwriting master pool
  },
};

async function getManagedVaults(vaultManager, block, chain) {
  let res = [];
  const { output: managedVaults } = await sdk.api.abi.call({
    abi: vaultManagerAbi,
    target: vaultManager,
    block,
    chain,
  });

  let calls = [];
  managedVaults.forEach((vault) => {
    calls.push({
      target: vault,
    });
  });

  const { output: vaultStoragesResult } = await sdk.api.abi.multiCall({
    abi: vaultAbi,
    calls,
    block,
    chain,
  });

  // Join the two arrays into [[underwritingToken, vaultAddr]]
  vaultStoragesResult.forEach((vaultStorageResult) => {
    if (vaultStorageResult.success) {
      const underwritingToken =
        vaultStorageResult.output.config.underwritingToken;
      res.push([underwritingToken, vaultStorageResult.input.target]);
    }
  });

  return res;
}

async function terra2(timestamp, ethBlock, chainBlocks) {
  const balances = { "terra-luna-2": 0 };

  const { vaults } = await queryContract({
    contract: networks.terra2.factory,
    isTerra2: true,
    data: {
      get_vaults: {},
    },
  });

  // Go through each vault and add it's underwriting balance
  // stored in allocation_vector slot 0
  // 09-28-22 As of now, the only asset supported for deposit
  // is Luna2 in the form of wrapped Luna2 since RH Ozone v2 does
  // not support native token types
  vaults.forEach((vault) => {
    balances["terra-luna-2"] +=
      parseInt(vault.state.allocation_vector[0]) / 1e6;
  });

  // Query the Master underwriting vault
  balances["terra-luna-2"] +=
    (await getDenomBalance(
      "uluna",
      networks.terra2.masterPool,
      chainBlocks.terra2,
      {
        isTerra2: true,
      }
    )) / 1e6;

  return balances;
}

async function terra(timestamp, ethBlock, chainBlocks) {
  const balances = { terrausd: 0 };

  for (const vaultAddr of networks.terra.vaults) {
    let paginationKey;

    do {
      const data = await queryV1Beta1(
        `bank/v1beta1/balances/${vaultAddr}`,
        paginationKey,
        chainBlocks.terra
      );

      paginationKey = data.pagination.next_key;

      data.balances.forEach(({ denom, amount }) => {
        /**
         * 3/10/2022 - As of now the only supported underwriting token for Risk Harbor Ozone is UST, so
         * balances should always be an array of length 1. Added support for dynamic balances length, denom checking, and pagination for
         * future proofing and safety.
         */
        if (denom === "uusd") {
          balances["terrausd"] += parseInt(amount) / 1e6;
        }
      });
    } while (paginationKey);
  }
  return balances;
}

function evm(chainName) {
  return async (timestamp, block, chainBlocks) => {
    const isEth = chainName === "ethereum";
    const network = networks[chainName];

    if (network.vaultManager) {
      const managedVaults = await getManagedVaults(
        network.vaultManager,
        isEth ? block : chainBlocks[chainName],
        chainName
      );
      network.vaults = [...network.vaults, ...managedVaults];
    }

    return sumTokens(
      undefined,
      network.vaults,
      isEth ? block : chainBlocks[chainName],
      chainName,
      undefined,
      { resolveCrv: true }
    );
  };
}

module.exports = {
  timetravel: true,
  misrepresentedTokens: false,
  methodology: "Amount of underwriter capital inside the protocol",
  terra: {
    tvl: terra,
  },
  terra2: {
    tvl: terra2,
  },
  ethereum: {
    tvl: evm("ethereum"),
  },
  arbitrum: {
    tvl: evm("arbitrum"),
  },
  avax: {
    tvl: evm("avax"),
  },
  fantom: {
    tvl: evm("fantom"),
  },
  aurora: {
    tvl: evm("aurora"),
  },
  optimism: {
    tvl: evm("optimism"),
  },
  hallmarks: [[1651881600, "UST depeg"]],
};
