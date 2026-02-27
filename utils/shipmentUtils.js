// lib/shipmentUtils.js

import { addDays } from "date-fns";

export const DAY_MAP = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
export const DELIVERY_PRICE = 60;

/**
 * Convert a date to a UTC date key string: "YYYY-MM-DD"
 */
export function toDateKey(date) {
  const d = new Date(date);
  return (
    d.getUTCFullYear() +
    "-" +
    String(d.getUTCMonth() + 1).padStart(2, "0") +
    "-" +
    String(d.getUTCDate()).padStart(2, "0")
  );
}

/**
 * Generate all real shipping dates for a subscription.
 *
 * Weekly mode  : picks every matching weekday across period × 7 days.
 * Monthly mode : picks the chosen day(s) once per 4-week block.
 *                e.g. "Once a Month"  → 1 date per 28-day block
 *                     "Twice a Month" → 2 dates per 28-day block
 *
 * @param {Date}     startDate    - First shipping date (UTC)
 * @param {number}   period       - Always in weeks (4 / 8 / 12)
 * @param {string[]} selectedDays - e.g. ["Tue"] or ["Mon","Thu"]
 * @param {boolean}  isMonthly    - true for "Once a Month" / "Twice a Month"
 * @returns {Date[]}
 */
export function generateShipmentDates(startDate, period, selectedDays, isMonthly = false) {
  const dates = [];

  if (isMonthly) {
    // period is always stored in weeks; months = period / 4
    const totalMonths = Math.round(period / 4);

    for (let m = 0; m < totalMonths; m++) {
      // Start of this 28-day month block
      const blockStart = addDays(startDate, m * 28);

      for (const day of selectedDays) {
        // Find the first occurrence of this weekday within a 14-day window
        for (let i = 0; i < 14; i++) {
          const candidate = addDays(blockStart, i);
          if (DAY_MAP[day] === candidate.getUTCDay()) {
            dates.push(candidate);
            break;
          }
        }
      }
    }

    // Sort ascending (multiple selectedDays can produce out-of-order results)
    return dates.sort((a, b) => a - b);
  }

  // Weekly (original logic)
  const totalDays = period * 7;

  for (let i = 0; i < totalDays; i++) {
    const candidate = addDays(startDate, i);
    const dayOfWeek = candidate.getUTCDay();

    if (selectedDays.some((d) => DAY_MAP[d] === dayOfWeek)) {
      dates.push(candidate);
    }
  }

  return dates;
}

/**
 * Given the new subscription's shipment dates and a set of existing scheduled
 * shipment date keys, build shipment records and calculate delivery fee.
 *
 * Rules:
 * - If the customer already has a shipment on that date → NOT chargeable
 * - Otherwise → chargeable (Rs.60)
 * - If any active sub > 5000 OR new sub > 5000 → all FREE
 */
export function buildShipmentRecords(newDates, existingDateKeys, waiveAll) {
  const shipmentRecords = [];
  let chargeableDeliveries = 0;

  for (const date of newDates) {
    const dateKey = toDateKey(date);
    const isChargeable = !existingDateKeys.has(dateKey);

    if (isChargeable) chargeableDeliveries++;

    shipmentRecords.push({
      shippingDate: date,
      isChargeable,
      deliveryFee: !waiveAll && isChargeable ? DELIVERY_PRICE : 0,
    });
  }

  const finalDeliveryFee = waiveAll ? 0 : chargeableDeliveries * DELIVERY_PRICE;

  return { shipmentRecords, finalDeliveryFee };
}
