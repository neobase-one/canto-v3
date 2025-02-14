import { SLINGSHOT_API_URL } from "@/config/api";
import { tryFetch } from "../async";
import BigNumber from "bignumber.js";
import { NEW_ERROR, NO_ERROR, PromiseWithError } from "@/config/interfaces";

/**
 * @notice gets the price of a token in USDC
 * @dev automatically uses USDC mainnet address
 * @param {string} tokenAddress address of token
 * @param {number} decimals decimals of token
 * @returns {PromiseWithError<number>} price of token in USDC
 */
export async function getTokenPriceInUSDC(
  tokenAddress: string,
  decimals: number
): PromiseWithError<string> {
  const { data, error } = await tryFetch<{ estimatedOutput: string }>(
    SLINGSHOT_API_URL + "/trade",
    {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        liquidityZone: "canto",
      },
      body: JSON.stringify({
        fromAmount: new BigNumber(10).pow(decimals).toString(),
        from: tokenAddress,
        to: "0x80b5a32E4F032B2a058b4F29EC95EEfEEB87aDcd",
      }),
    }
  );
  if (error) {
    return NEW_ERROR("getTokenPriceInUSDC", error);
  }
  return NO_ERROR(new BigNumber(data.estimatedOutput).div(10 ** 6).toString());
}
