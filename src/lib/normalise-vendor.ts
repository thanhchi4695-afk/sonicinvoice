// Title-case vendor names while preserving short acronyms (BBQ, NYX, JBL, MAC,
// G2M, B&Q) and casing common business suffixes consistently. Fully-uppercase
// words longer than 3 letters and without digits/&/special chars (e.g. "GIRL",
// "SHOP", "BRAND") are treated as shouted plain words and title-cased so an
// invoice label like "GO GIRL" becomes "Go Girl" rather than staying "GO GIRL".

function isAcronym(word: string): boolean {
  if (!/^[A-Z0-9&]+$/.test(word)) return false; // must be all caps/digits/&
  if (word.length <= 3) return true;             // BBQ, NYX, JBL, SAS, MAC
  if (/[0-9&]/.test(word)) return true;          // G2M, B&Q, M&S, AT&T
  return false;                                  // GIRL, SHOP → title-case
}

export function normaliseVendor(raw: string | null | undefined): string {
  if (!raw) return "";
  const cleaned = raw.trim().replace(/\s+/g, " ");
  if (!cleaned) return "";
  return cleaned
    .split(" ")
    .map((word) => {
      if (isAcronym(word)) return word;
      return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
    })
    .join(" ");
}
