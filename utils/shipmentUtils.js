// lib/shipmentUtils.js

import { addDays } from "date-fns" ; // or however you import addDays

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
 * Starts from `startDate` (a UTC Date), runs for `period` weeks,
 * only includes days matching `selectedDays` (e.g. ["Tue", "Sun"]).
 *
 * Returns array of UTC Date objects at 11AM IST (5:30AM UTC).
 */
export function generateShipmentDates(startDate, period, selectedDays) {
  const dates = [];
  const totalDays = period * 7;

  for (let i = 0; i < totalDays; i++) {
    const candidate = addDays(startDate, i);
    const dayOfWeek = candidate.getUTCDay(); // use UTC to avoid timezone drift

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
 * - If the customer already has a shipment on that date (any active sub) → NOT chargeable
 * - Otherwise → chargeable (₹60)
 * - If customer has any active sub with totalAmount > 5000, OR new sub > 5000 → all FREE
 *
 * @param {Date[]} newDates
 * @param {Set<string>} existingDateKeys - Set of "YYYY-MM-DD" strings from existing scheduled shipments
 * @param {boolean} waiveAll - true if high value rule applies
 * @returns {{ shipmentRecords: object[], finalDeliveryFee: number }}
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

