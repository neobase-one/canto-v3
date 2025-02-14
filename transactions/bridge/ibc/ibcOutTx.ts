import { TX_PARAM_ERRORS } from "@/config/consts/errors";
import {
  IBCToken,
  NEW_ERROR,
  NO_ERROR,
  PromiseWithError,
  Validation,
} from "@/config/interfaces";
import {
  TX_DESCRIPTIONS,
  Transaction,
  TxCreatorFunctionReturn,
} from "@/transactions/interfaces";
import { ethToCantoAddress, isValidEthAddress } from "@/utils/address";
import { validateWeiUserInputTokenAmount } from "@/utils/math";
import { getNetworkInfoFromChainId, isCosmosNetwork } from "@/utils/networks";
import { isERC20Token, isIBCToken } from "@/utils/tokens";
import IBC_CHANNELS from "@/config/jsons/ibcChannels.json";
import { getBlockTimestamp, getIBCData } from "./helpers";
import { getCosmosTokenBalance } from "@/utils/cosmos";
import { displayAmount } from "@/utils/formatting";
import BigNumber from "bignumber.js";
import { _convertERC20Tx, _ibcOutTx } from "./txCreators";
import { CANTO_MAINNET_COSMOS } from "@/config/networks";
import { BridgingMethod, getBridgeMethodInfo } from "..";

type IBCOutTxParams = {
  senderEthAddress: string;
  receiverCosmosAddress: string;
  receivingChainId: string;
  token: IBCToken;
  amount: string;
  convert: boolean;
};

/**
 * @notice creates a list of transactions that need to be made for IBC out of canto
 * @param {IBCOutTxParams} txParams parameters for bridging out with IBC
 * @returns {PromiseWithError<Transaction[]>} list of transactions to make or error
 */
export async function IBCOutTx(
  txParams: IBCOutTxParams
): PromiseWithError<TxCreatorFunctionReturn> {
  try {
    /** validate params */
    const validation = validateIBCOutTxParams(txParams);
    if (validation.error) throw new Error(validation.reason);

    /** get receiving chain */

    const { data: receivingChain, error: chainError } =
      getNetworkInfoFromChainId(txParams.receivingChainId);
    if (chainError) throw chainError;

    // check to network and address for safety
    if (
      !isCosmosNetwork(receivingChain) ||
      !receivingChain.checkAddress(txParams.receiverCosmosAddress)
    ) {
      throw new Error(
        "invalid cosmos address: " +
          txParams.receiverCosmosAddress +
          " for chain " +
          receivingChain.id
      );
    }

    /** canto address */
    const { data: cantoAddress, error: ethToCantoError } =
      await ethToCantoAddress(txParams.senderEthAddress);
    if (ethToCantoError) throw ethToCantoError;

    /** channel id */
    const channelId =
      IBC_CHANNELS[receivingChain.id as keyof typeof IBC_CHANNELS];
    if (!channelId || !channelId.fromCanto) throw new Error("invalid channel");

    /** ibc data */
    const { data: ibcData, error: ibcDataError } = await getIBCData(
      receivingChain.restEndpoint,
      receivingChain.extraEndpoints
    );
    if (ibcDataError) throw ibcDataError;

    /** block timestamp */
    const { data: blockTimestamp, error: timestampError } =
      await getBlockTimestamp(
        receivingChain.restEndpoint,
        receivingChain.extraEndpoints,
        receivingChain.latestBlockEndpoint
      );
    if (timestampError) throw timestampError;

    /** create tx list */
    const txList: Transaction[] = [];

    /** convert coin */
    if (txParams.convert) {
      // make sure token is also an ERC20 token for type saftey
      if (!isERC20Token(txParams.token)) {
        throw new Error(
          "token must be ERC20 to convert to IBC: " + txParams.token.id
        );
      }
      // check native balance to see if we need to convert
      const { data: nativeBalance, error: nativeBalanceError } =
        await getCosmosTokenBalance(
          txParams.token.chainId,
          cantoAddress,
          txParams.token.ibcDenom
        );
      if (nativeBalanceError) throw nativeBalanceError;
      const amountToConvert = new BigNumber(txParams.amount).minus(
        nativeBalance
      );
      if (amountToConvert.gt(0)) {
        txList.push(
          _convertERC20Tx(
            txParams.token.chainId,
            txParams.token.address,
            amountToConvert.toString(),
            txParams.senderEthAddress,
            cantoAddress,
            TX_DESCRIPTIONS.CONVERT_ERC20(
              txParams.token.symbol,
              displayAmount(txParams.amount, txParams.token.decimals)
            )
          )
        );
      }
    }

    /** ibc transfer */
    txList.push(
      _ibcOutTx(
        txParams.token.chainId,
        "transfer",
        channelId.fromCanto,
        txParams.amount,
        txParams.token.ibcDenom,
        txParams.receiverCosmosAddress,
        cantoAddress,
        Number(ibcData.height.revision_number),
        Number(ibcData.height.revision_height) + 1000,
        blockTimestamp.slice(0, 9) + "00000000000",
        "ibc from canto",
        TX_DESCRIPTIONS.BRIDGE(
          txParams.token.symbol,
          displayAmount(txParams.amount, txParams.token.decimals),
          CANTO_MAINNET_COSMOS.name,
          receivingChain.name,
          getBridgeMethodInfo(BridgingMethod.IBC).name
        )
      )
    );

    /** return tx list */
    return NO_ERROR({ transactions: txList });
  } catch (err) {
    return NEW_ERROR("IBCOutTx" + err);
  }
}

export function validateIBCOutTxParams(txParams: IBCOutTxParams): Validation {
  // check ethSender
  if (!isValidEthAddress(txParams.senderEthAddress)) {
    return {
      error: true,
      reason: TX_PARAM_ERRORS.PARAM_INVALID("ethSender"),
    };
  }
  // check cosmos receiver
  const { data: receivingChain, error } = getNetworkInfoFromChainId(
    txParams.receivingChainId
  );
  if (error) {
    return {
      error: true,
      reason: TX_PARAM_ERRORS.PARAM_INVALID("receivingChainId"),
    };
  }
  if (!isCosmosNetwork(receivingChain)) {
    return {
      error: true,
      reason: TX_PARAM_ERRORS.PARAM_INVALID("receivingChainId"),
    };
  }
  if (!receivingChain.checkAddress(txParams.receiverCosmosAddress)) {
    return {
      error: true,
      reason: TX_PARAM_ERRORS.PARAM_INVALID("receiverCosmosAddress"),
    };
  }

  // check token
  if (!isIBCToken(txParams.token)) {
    return {
      error: true,
      reason: TX_PARAM_ERRORS.PARAM_INVALID("token"),
    };
  }
  if (txParams.convert && !isERC20Token(txParams.token)) {
    return {
      error: true,
      reason: TX_PARAM_ERRORS.PARAM_INVALID("token"),
    };
  }
  // check amount
  return validateWeiUserInputTokenAmount(
    txParams.amount,
    "1",
    txParams.token.balance ?? "0",
    txParams.token.symbol,
    txParams.token.decimals
  );
}
