import { Market, UserState, Borrow, Repayment, Removal, Liquidation, MonetaryPolicy } from '../generated/schema'
import {
  Borrow as BorrowEvent,
  RemoveCollateral as RemoveCollateralEvent,
  Liquidate as LiquidateEvent,
  UserState as UserStateEvent,
  Repay as RepayEvent,
  SetMonetaryPolicy,
} from '../generated/templates/ControllerTemplate/Controller'
import { getOrCreateUser } from './services/users'
import { MonetaryPolicy as MonetaryPolicyTemplate } from '../generated/templates'
import { log } from '@graphprotocol/graph-ts'

export function handleBorrow(event: BorrowEvent): void {
  const user = getOrCreateUser(event.params.user)
  const borrow = new Borrow(event.transaction.hash.concatI32(event.logIndex.toI32()))
  borrow.market = event.address
  borrow.user = user.id
  borrow.collateralIncrease = event.params.collateral_increase
  borrow.loanIncrease = event.params.loan_increase

  borrow.blockNumber = event.block.number
  borrow.blockTimestamp = event.block.timestamp
  borrow.transactionHash = event.transaction.hash
  borrow.save()
}

export function handleRepay(event: RepayEvent): void {
  const user = getOrCreateUser(event.params.user)
  const repay = new Repayment(event.transaction.hash.concatI32(event.logIndex.toI32()))
  repay.user = user.id
  repay.market = event.address
  repay.collateralDecrease = event.params.collateral_decrease
  repay.loanDecrease = event.params.loan_decrease

  repay.blockNumber = event.block.number
  repay.blockTimestamp = event.block.timestamp
  repay.transactionHash = event.transaction.hash
  repay.save()
}

export function handleRemoveCollateral(event: RemoveCollateralEvent): void {
  let user = getOrCreateUser(event.params.user)
  let removal = new Removal(event.transaction.hash.concatI32(event.logIndex.toI32()))
  removal.user = user.id
  removal.market = event.address
  removal.collateralDecrease = event.params.collateral_decrease

  removal.blockNumber = event.block.number
  removal.blockTimestamp = event.block.timestamp
  removal.transactionHash = event.transaction.hash
  removal.save()
}

export function handleLiquidate(event: LiquidateEvent): void {
  const user = getOrCreateUser(event.params.user)
  const liquidation = new Liquidation(event.transaction.hash.concatI32(event.logIndex.toI32()))
  const liquidator = getOrCreateUser(event.params.liquidator)
  liquidation.user = user.id
  liquidation.market = event.address
  liquidation.collateralReceived = event.params.collateral_received
  liquidation.stablecoinReceived = event.params.stablecoin_received
  liquidation.liquidator = liquidator.id
  liquidation.debt = event.params.debt

  liquidation.blockNumber = event.block.number
  liquidation.blockTimestamp = event.block.timestamp
  liquidation.transactionHash = event.transaction.hash
  liquidation.save()
}

export function handleSetMonetaryPolicy(event: SetMonetaryPolicy): void {
  const market = Market.load(event.address)
  if (!market) {
    log.error('Error: monetary policy {} from non existent market {} at {}', [
      event.params.monetary_policy.toHexString(),
      event.address.toHexString(),
      event.transaction.hash.toHexString(),
    ])
    return
  }
  const policy = new MonetaryPolicy(event.params.monetary_policy)
  policy.save()

  MonetaryPolicyTemplate.create(event.params.monetary_policy)
  market.monetaryPolicy = event.params.monetary_policy
  market.save()
}

export function handleUserState(event: UserStateEvent): void {
  const user = getOrCreateUser(event.params.user)
  const userState = new UserState(event.transaction.hash.concatI32(event.logIndex.toI32()))

  userState.user = user.id
  userState.market = event.address
  userState.liquidationDiscount = event.params.liquidation_discount
  userState.n1 = event.params.n1
  userState.n2 = event.params.n2
  userState.debt = event.params.debt
  userState.collateral = event.params.collateral

  userState.blockNumber = event.block.number
  userState.blockTimestamp = event.block.timestamp
  userState.transactionHash = event.transaction.hash
  userState.save()
}