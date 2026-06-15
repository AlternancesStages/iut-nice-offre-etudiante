export function parseDurationInWeeks(tempsStr: string): { min: number; max: number } | null {
  if (!tempsStr) return null;
  const str = tempsStr.toLowerCase().replace(/\uFFFD/g, 'à').trim();
  
  if (str.includes("non") && str.includes("précisé")) {
    return null;
  }
  
  const numbers = str.match(/\d+/g);
  if (!numbers || numbers.length === 0) return null;
  
  let factor = 1;
  if (str.includes("an")) {
    factor = 52;
  } else if (str.includes("mois")) {
    factor = 4.33;
  } else if (str.includes("semaine") || str.includes("sem")) {
    factor = 1;
  }
  
  const val1 = parseInt(numbers[0], 10);
  const val2 = numbers.length > 1 ? parseInt(numbers[1], 10) : val1;
  
  let isPlusDe = false;
  if (
    str.includes("plus de") ||
    str.includes("supérieur") ||
    str.includes("au-delà") ||
    str.includes("minimum") ||
    str.includes("au moins") ||
    str.includes(">")
  ) {
    isPlusDe = true;
  }
  
  return {
    min: val1 * factor,
    max: isPlusDe ? (val2 * factor) * 1.5 : val2 * factor,
  };
}

export function formatOfferDate(dateTri: string | undefined, originalDate: string): string {
  if (!dateTri || !dateTri.match(/^\d{4}-\d{2}-\d{2}$/)) {
    return originalDate || "Non précisé";
  }
  const [year, month, day] = dateTri.split("-");
  return `${day}/${month}/${year}`;
}

export function formatDurationLabel(temps: string): string | null {
  const parsed = parseDurationInWeeks(temps);
  if (!parsed) return null;
  const { min, max } = parsed;
  if (max >= 48) {
    const yrs = (w: number) => { const y = Math.round(w / 52); return y + (y > 1 ? ' ans' : ' an'); };
    return min === max ? yrs(min) : `${yrs(min)}-${yrs(max)}`;
  }
  if (max >= 6) {
    const mos = (w: number) => { const m = Math.round(w / 4.33); return m + ' mois'; };
    return min === max ? mos(min) : `${mos(min)}-${mos(max)}`;
  }
  return min === max ? `${Math.round(min)} sem` : `${Math.round(min)}-${Math.round(max)} sem`;
}

export function getPaginationRange(currentPage: number, totalPages: number) {
  const delta = 1; // Number of pages on each side of currentPage
  const range: (number | string)[] = [];

  range.push(1);

  if (totalPages <= 1) {
    return range;
  }

  const left = currentPage - delta;
  const right = currentPage + delta;

  let showLeftDots = left > 2;
  let showRightDots = right < totalPages - 1;

  if (!showLeftDots && showRightDots) {
    // Near start
    for (let i = 2; i <= Math.min(5, totalPages - 1); i++) {
      range.push(i);
    }
    if (totalPages > 5) {
      range.push("...");
    }
  } else if (showLeftDots && !showRightDots) {
    // Near end
    if (totalPages > 5) {
      range.push("...");
    }
    for (let i = Math.max(2, totalPages - 4); i < totalPages; i++) {
      range.push(i);
    }
  } else if (showLeftDots && showRightDots) {
    // Middle
    range.push("...");
    for (let i = left; i <= right; i++) {
      range.push(i);
    }
    range.push("...");
  } else {
    // All pages fit
    for (let i = 2; i < totalPages; i++) {
      range.push(i);
    }
  }

  range.push(totalPages);

  return range;
}

export function cleanJobTitle(title: string): string {
  if (!title) return "";
  let cleaned = title;
  
  // 1. Enlever les patterns du type "2026-12345 -" ou "2026-12345 :" ou "2026/12345 -"
  cleaned = cleaned.replace(/^\d{4}[-/]\d+\s*[-:]\s*/g, "");
  
  // 2. Enlever les suffixes du type "- 2026-12345" ou "- 2026/12345"
  cleaned = cleaned.replace(/\s*[-:]\s*\d{4}[-/]\d+\s*$/g, "");
  
  // 3. Enlever les codes entre parenthèses comme "(403871)" ou "(Ref. 12345)"
  cleaned = cleaned.replace(/\s*\((?:ref\.?\s*)?\d+(?:\s*-\s*\d+)?\)/gi, "");
  cleaned = cleaned.replace(/\s*\(\s*(?:réf\.?|no\.?|n°)\s*[^)]+\)/gi, "");
  
  // 4. Enlever les codes entre crochets comme "[Job-12345]" ou "[12345]"
  cleaned = cleaned.replace(/^\s*\[[^\]]+\]\s*/g, "");
  cleaned = cleaned.replace(/\s*\[[^\]]+\]\s*$/g, "");
  
  // 5. Nettoyer les espaces multiples et les tirets orphelins restants
  cleaned = cleaned.trim();
  cleaned = cleaned.replace(/^[-:\s]+/, "");
  cleaned = cleaned.replace(/[-:\s]+$/, "");
  
  return cleaned.trim() || title;
}

