import BigNumber from "bignumber.js";
import dynamodb from "../utils/dynamodb";

const ethereumAddress = "0x0000000000000000000000000000000000000000";
const weth = "0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2";
const DAY = 24 * 3600;
type Balances = {
  [symbol: string]: number;
};

export default async function (balances: { [address: string]: string }) {
  const eth = balances[ethereumAddress];
  if (eth !== undefined) {
    balances[weth] = new BigNumber(balances[weth] ?? 0).plus(eth).toFixed();
    delete balances[eth];
  }
  const PKsToTokens = {} as { [t: string]: string[] };
  const readKeys = Object.keys(balances)
    .map((address) => {
      const PK = `asset#${
        address.startsWith("0x") ? "ethereum:" : ""
      }${address.toLowerCase()}`;
      if (PKsToTokens[PK] === undefined) {
        PKsToTokens[PK] = [address];
        return {
          PK,
          SK: 0,
        };
      } else {
        PKsToTokens[PK].push(address);
        return undefined;
      }
    })
    .filter((item) => item !== undefined) as any[];
  const readRequests = [];
  for (let i = 0; i < readKeys.length; i += 100) {
    readRequests.push(
      dynamodb
        .batchGet(readKeys.slice(i, i + 100))
        .then((r) => r.Responses?.[process.env.tableName!])
    );
  }
  const tokenData = ([] as any[]).concat(...(await Promise.all(readRequests)));
  let usdTvl = 0;
  const tokenBalances = {} as Balances;
  const usdTokenBalances = {} as Balances;
  const now = Math.round(Date.now() / 1000);
  tokenData.forEach((response) => {
    if (Math.abs(response.timestamp - now) < DAY) {
      PKsToTokens[response.PK].forEach((address) => {
        const balance = balances[address];
        const { price, decimals } = response;
        const symbol = (response.symbol as string).toUpperCase();
        const amount = new BigNumber(balance).div(10 ** decimals).toNumber();
        const usdAmount = amount * price;
        tokenBalances[symbol] = (tokenBalances[symbol] ?? 0) + amount;
        usdTokenBalances[symbol] = (usdTokenBalances[symbol] ?? 0) + usdAmount;
        usdTvl += usdAmount;
      });
    } else {
      console.error(`Data for ${response.PK} is stale`);
    }
  });
  return {
    usdTvl,
    tokenBalances,
    usdTokenBalances,
  };
}
