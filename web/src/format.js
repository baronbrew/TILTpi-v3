// Number display helpers shared by the dashboard tabs and widgets.

/** "-0", "-0.0", "-0.0000" -> without the sign (a tiny negative rounded to zero). */
export const noNegZero = (s) => String(s ?? '').replace(/^-(0(?:\.0*)?)$/, '$1');

/** n.toFixed(d) without a negative zero; '' for non-numbers. */
export function fixed(v, d) {
  const n = Number(v);
  return v === '' || v === null || v === undefined || !Number.isFinite(n) ? '' : noNegZero(n.toFixed(d));
}
