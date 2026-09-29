import { Prisma } from "@prisma/client";

export function toMoneyDecimal(value: number | string): Prisma.Decimal {
  return new Prisma.Decimal(value);
}

export function moneyToNumber(value: Prisma.Decimal): number {
  return Number(value.toString());
}

export function isPositiveMoney(value: Prisma.Decimal): boolean {
  return value.gt(0);
}

export function addMoney(a: Prisma.Decimal, b: Prisma.Decimal): Prisma.Decimal {
  return a.add(b);
}

export function isRefundWithinPaidAmount(input: {
  paidAmount: Prisma.Decimal;
  alreadyReserved: Prisma.Decimal;
  requested: Prisma.Decimal;
}): boolean {
  return input.alreadyReserved.add(input.requested).lte(input.paidAmount);
}
