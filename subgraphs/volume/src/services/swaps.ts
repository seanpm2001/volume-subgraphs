import { Address, BigDecimal, BigInt, Bytes, log } from '@graphprotocol/graph-ts'
import { Pool, SwapEvent } from '../../generated/schema'
import {
  getCryptoSwapTokenPriceFromSnapshot,
  getDailySwapSnapshot,
  getHourlySwapSnapshot,
  getStableSwapTokenPriceFromSnapshot,
  getWeeklySwapSnapshot,
  takePoolSnapshots,
} from './snapshots'
import {
  ADDRESS_ZERO,
  BIG_DECIMAL_TWO,
  BIG_INT_ONE,
  BIG_INT_ZERO,
  CTOKENS,
  LENDING,
  REBASING_FACTORY_METAPOOLS,
  STABLE_FACTORY,
} from '../../../../packages/constants'
import { getBasePool, getVirtualBaseLendingPool } from './pools'
import { bytesToAddress } from '../../../../packages/utils'
import { exponentToBigDecimal } from '../../../../packages/utils/maths'
import { updateCandles } from './candles'
import { updatePriceFeed } from './pricefeeds'

export function handleExchange(
  buyer: Address,
  sold_id: BigInt,
  bought_id: BigInt,
  tokens_sold: BigInt,
  tokens_bought: BigInt,
  timestamp: BigInt,
  blockNumber: BigInt,
  address: Address,
  txhash: Bytes,
  gasLimit: BigInt,
  gasUsed: BigInt,
  exchangeUnderlying: boolean
): void {
  const pool = Pool.load(address.toHexString())
  if (!pool) {
    return
  }
  takePoolSnapshots(timestamp)
  const soldId = sold_id.toI32()
  const boughtId = bought_id.toI32()
  let tokenSold: Bytes, tokenBought: Bytes
  let tokenSoldDecimals: BigInt, tokenBoughtDecimals: BigInt

  if (exchangeUnderlying && pool.poolType == LENDING) {
    const basePool = getVirtualBaseLendingPool(bytesToAddress(pool.basePool))
    if (soldId > basePool.coins.length - 1) {
      log.error('Undefined underlying sold Id {} for lending pool {} at tx {}', [
        soldId.toString(),
        pool.id,
        txhash.toHexString(),
      ])
      return
    }
    tokenSold = basePool.coins[soldId]
    tokenSoldDecimals = basePool.coinDecimals[soldId]
  } else if (exchangeUnderlying && soldId != 0) {
    const underlyingSoldIndex = soldId - 1
    const basePool = getBasePool(bytesToAddress(pool.basePool))
    if (underlyingSoldIndex > basePool.coins.length - 1) {
      log.error('Undefined underlying sold Id {} for pool {} at tx {}', [
        soldId.toString(),
        pool.id,
        txhash.toHexString(),
      ])
      return
    }
    tokenSold = basePool.coins[underlyingSoldIndex]
    if (
      (pool.assetType == 2 || pool.assetType == 0) &&
      pool.poolType == STABLE_FACTORY &&
      boughtId == 0 &&
      !REBASING_FACTORY_METAPOOLS.includes(pool.id)
    ) {
      // handling an edge-case in the way the dx is logged in the event
      // for BTC metapools and for USD Metapool from factory v1.2
      tokenSoldDecimals = BigInt.fromI32(18)
    } else {
      tokenSoldDecimals = basePool.coinDecimals[underlyingSoldIndex]
    }
  } else {
    if (soldId > pool.coins.length - 1) {
      log.error('Undefined sold Id {} for pool {} at tx {}', [soldId.toString(), pool.id, txhash.toHexString()])
      return
    }
    tokenSold = pool.coins[soldId]
    tokenSoldDecimals = pool.coinDecimals[soldId]
  }

  if (tokenSold == ADDRESS_ZERO) {
    log.error('Undefined SOLD token for pool {} at tx {}', [pool.id, txhash.toHexString()])
    return
  }

  if (exchangeUnderlying && pool.poolType == LENDING) {
    const basePool = getVirtualBaseLendingPool(bytesToAddress(pool.basePool))
    if (boughtId > basePool.coins.length - 1) {
      log.error('Undefined underlying bought Id {} for lending pool {} at tx {}', [
        boughtId.toString(),
        pool.id,
        txhash.toHexString(),
      ])
      return
    }
    tokenBought = basePool.coins[boughtId]
    tokenBoughtDecimals = basePool.coinDecimals[boughtId]
  } else if (exchangeUnderlying && boughtId != 0) {
    const underlyingBoughtIndex = boughtId - 1
    const basePool = getBasePool(bytesToAddress(pool.basePool))
    if (underlyingBoughtIndex > basePool.coins.length - 1) {
      log.error('Undefined underlying bought Id {} for pool {} at tx {}', [
        boughtId.toString(),
        pool.id,
        txhash.toHexString(),
      ])
    }
    tokenBought = basePool.coins[underlyingBoughtIndex]
    tokenBoughtDecimals = basePool.coinDecimals[underlyingBoughtIndex]
  } else {
    if (boughtId > pool.coins.length - 1) {
      log.error('Undefined bought Id {} for pool {} at tx {}', [boughtId.toString(), pool.id, txhash.toHexString()])
      return
    }
    tokenBought = pool.coins[boughtId]
    tokenBoughtDecimals = pool.coinDecimals[boughtId]
  }

  if (tokenBought == ADDRESS_ZERO) {
    log.error('Undefined BOUGHT token for pool {} at tx {}', [pool.id, txhash.toHexString()])
    return
  }

  const amountSold = tokens_sold.toBigDecimal().div(exponentToBigDecimal(tokenSoldDecimals))
  const amountBought = tokens_bought.toBigDecimal().div(exponentToBigDecimal(tokenBoughtDecimals))
  log.debug('Getting token snaphsot for {}', [pool.id])
  let amountBoughtUSD: BigDecimal, amountSoldUSD: BigDecimal
  if (!pool.isV2) {
    const latestBoughtSnapshotPrice = getStableSwapTokenPriceFromSnapshot(pool, bytesToAddress(tokenBought), timestamp)
    const latestSoldSnapshotPrice = getStableSwapTokenPriceFromSnapshot(pool, bytesToAddress(tokenSold), timestamp)
    amountBoughtUSD = amountBought.times(latestBoughtSnapshotPrice)
    amountSoldUSD = amountSold.times(latestSoldSnapshotPrice)
  } else {
    const latestBoughtSnapshotPrice = getCryptoSwapTokenPriceFromSnapshot(pool, bytesToAddress(tokenBought), timestamp)
    const latestSoldSnapshotPrice = getCryptoSwapTokenPriceFromSnapshot(pool, bytesToAddress(tokenSold), timestamp)
    amountBoughtUSD = amountBought.times(latestBoughtSnapshotPrice)
    amountSoldUSD = amountSold.times(latestSoldSnapshotPrice)
  }

  const swapEvent = new SwapEvent(txhash.toHexString() + '-' + amountBought.toString())
  swapEvent.pool = address.toHexString()
  swapEvent.block = blockNumber
  swapEvent.buyer = buyer
  swapEvent.gasLimit = gasLimit
  swapEvent.gasUsed = gasUsed ? gasUsed : BIG_INT_ZERO
  swapEvent.tokenBought = tokenBought
  swapEvent.tokenSold = tokenSold
  swapEvent.amountBought = amountBought
  swapEvent.amountSold = amountSold
  swapEvent.amountBoughtUSD = amountBoughtUSD
  swapEvent.amountSoldUSD = amountSoldUSD
  swapEvent.timestamp = timestamp
  swapEvent.save()

  updateCandles(pool, timestamp, tokenBought, amountBought, tokenSold, amountSold, blockNumber)

  updatePriceFeed(
    pool,
    tokenSold,
    tokenBought,
    amountSold,
    amountBought,
    soldId,
    boughtId,
    exchangeUnderlying,
    blockNumber,
    timestamp
  )

  const volume = amountSold.plus(amountBought).div(BIG_DECIMAL_TWO)
  const volumeUSD = amountSoldUSD.plus(amountBoughtUSD).div(BIG_DECIMAL_TWO)

  const hourlySnapshot = getHourlySwapSnapshot(pool, timestamp)
  const dailySnapshot = getDailySwapSnapshot(pool, timestamp)
  const weeklySnapshot = getWeeklySwapSnapshot(pool, timestamp)

  hourlySnapshot.count = hourlySnapshot.count.plus(BIG_INT_ONE)
  dailySnapshot.count = dailySnapshot.count.plus(BIG_INT_ONE)
  weeklySnapshot.count = weeklySnapshot.count.plus(BIG_INT_ONE)

  hourlySnapshot.amountSold = hourlySnapshot.amountSold.plus(amountSold)
  dailySnapshot.amountSold = dailySnapshot.amountSold.plus(amountSold)
  weeklySnapshot.amountSold = weeklySnapshot.amountSold.plus(amountSold)

  hourlySnapshot.amountBought = hourlySnapshot.amountBought.plus(amountBought)
  dailySnapshot.amountBought = dailySnapshot.amountBought.plus(amountBought)
  weeklySnapshot.amountBought = weeklySnapshot.amountBought.plus(amountBought)

  hourlySnapshot.amountSoldUSD = hourlySnapshot.amountSoldUSD.plus(amountSoldUSD)
  dailySnapshot.amountSoldUSD = dailySnapshot.amountSoldUSD.plus(amountSoldUSD)
  weeklySnapshot.amountSoldUSD = weeklySnapshot.amountSoldUSD.plus(amountSoldUSD)

  hourlySnapshot.amountBoughtUSD = hourlySnapshot.amountBoughtUSD.plus(amountBoughtUSD)
  dailySnapshot.amountBoughtUSD = dailySnapshot.amountBoughtUSD.plus(amountBoughtUSD)
  weeklySnapshot.amountBoughtUSD = weeklySnapshot.amountBoughtUSD.plus(amountBoughtUSD)

  hourlySnapshot.volume = hourlySnapshot.volume.plus(volume)
  dailySnapshot.volume = dailySnapshot.volume.plus(volume)
  weeklySnapshot.volume = weeklySnapshot.volume.plus(volume)

  hourlySnapshot.volumeUSD = hourlySnapshot.volumeUSD.plus(volumeUSD)
  dailySnapshot.volumeUSD = dailySnapshot.volumeUSD.plus(volumeUSD)
  weeklySnapshot.volumeUSD = weeklySnapshot.volumeUSD.plus(volumeUSD)

  hourlySnapshot.save()
  dailySnapshot.save()
  weeklySnapshot.save()

  pool.cumulativeVolume = pool.cumulativeVolume.plus(volume)
  pool.cumulativeVolumeUSD = pool.cumulativeVolumeUSD.plus(volumeUSD)

  pool.save()
}
