import { Prisma } from "@prisma/client";
import { FINANCE_MONEY_SCALE } from "./admin-finance.constants.js";

export function decimalToMoneyString(value: Prisma.Decimal | null | undefined): string {
  if (value == null) {
    return "0.00";
  }
  return value.toFixed(FINANCE_MONEY_SCALE);
}

export function sumDecimals(values: Array<Prisma.Decimal | null | undefined>): string {
  let total = new Prisma.Decimal(0);
  for (const value of values) {
    if (value != null) {
      total = total.add(value);
    }
  }
  return total.toFixed(FINANCE_MONEY_SCALE);
}

export function subtractMoneyStrings(minuend: string, subtrahend: string): string {
  return new Prisma.Decimal(minuend)
    .sub(new Prisma.Decimal(subtrahend))
    .toFixed(FINANCE_MONEY_SCALE);
}

export function moneyStringsEqual(a: string, b: string): boolean {
  return new Prisma.Decimal(a).eq(new Prisma.Decimal(b));
}
