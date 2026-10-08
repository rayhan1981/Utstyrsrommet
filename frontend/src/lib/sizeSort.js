/**
 * Naturlig sortering av størrelser:
 * Rene tall (128, 140, 164) sorteres numerisk først.
 * Deretter klesstørrelser i rekkefølge: XXS, XS, S, M, L, XL, XXL, XXXL, 2XL, 3XL, 4XL, 5XL.
 * Alt annet (f.eks. ballstørrelser "00 Mykball") kommer til slutt alfabetisk.
 */
const CLOTHING_ORDER = ["XXS", "XS", "S", "M", "L", "XL", "XXL", "XXXL", "4XL", "5XL"];

export function naturalSizeKey(size) {
  const s = String(size || "").trim();
  if (!s) return [3, "", 0];
  // 1. Pure numeric (child sizes like 128, 140, 164)
  if (/^\d+$/.test(s)) return [0, "", parseInt(s, 10)];
  // 2. Numeric + letter (e.g., "140B" or "140/152")
  const num = s.match(/^(\d+)/);
  if (num) return [0, s.slice(num[0].length), parseInt(num[1], 10)];
  // 3. Clothing letter sizes
  const upper = s.toUpperCase().replace(/\s+/g, "");
  const idx = CLOTHING_ORDER.indexOf(upper);
  if (idx >= 0) return [1, "", idx];
  // 4. Numeric-prefixed XL (2XL, 3XL etc.)
  const xl = upper.match(/^(\d+)XL$/);
  if (xl) return [1, "", CLOTHING_ORDER.length + parseInt(xl[1], 10) - 1];
  // 5. Anything else (ball sizes "00 Mykball" etc.)
  return [2, s.toLowerCase(), 0];
}

export function sortSizesNatural(sizes, getter = (x) => x) {
  return [...sizes].sort((a, b) => {
    const ka = naturalSizeKey(getter(a));
    const kb = naturalSizeKey(getter(b));
    for (let i = 0; i < 3; i++) {
      if (ka[i] < kb[i]) return -1;
      if (ka[i] > kb[i]) return 1;
    }
    return 0;
  });
}
