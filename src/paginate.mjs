// Colour + geometry helpers to find the red margin rectangle and split the
// (unbounded-height) drawing into printable pages without slicing through
// any element.

function hexToRgb(hex) {
  const m = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(hex || "");
  if (!m) return null;
  let h = m[1];
  if (h.length === 3) {
    h = h
      .split("")
      .map((c) => c + c)
      .join("");
  }
  const n = parseInt(h, 16);
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}

function isReddish(hex) {
  const rgb = hexToRgb(hex);
  if (!rgb) return false;
  const { r, g, b } = rgb;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const light = (max + min) / 2 / 255;
  if (max === min) return false; // grey
  const sat = (max - min) / (255 - Math.abs(max + min - 255));
  let hue;
  if (max === r) hue = 60 * (((g - b) / (max - min)) % 6);
  else if (max === g) hue = 60 * ((b - r) / (max - min) + 2);
  else hue = 60 * ((r - g) / (max - min) + 4);
  if (hue < 0) hue += 360;
  return sat > 0.35 && light > 0.2 && light < 0.75 && (hue <= 20 || hue >= 340);
}

/**
 * Finds the red rectangle(s) marking the drawing's horizontal margins and
 * returns their combined x-range plus the ids to exclude from rendering.
 */
export function findMarginRectangle(elements) {
  const guides = elements.filter(
    (el) =>
      !el.isDeleted && el.type === "rectangle" && isReddish(el.strokeColor),
  );

  if (guides.length === 0) {
    throw new Error(
      "Nessun rettangolo rosso trovato negli elementi del disegno " +
        "(atteso: un elemento di tipo 'rectangle' con strokeColor rosso, " +
        "usato per delimitare la larghezza dei margini).",
    );
  }

  const angled = guides.filter((el) => el.angle && Math.abs(el.angle) > 1e-3);
  if (angled.length > 0) {
    console.warn(
      `Attenzione: ${angled.length} rettangolo/i rosso/i risultano ruotati; ` +
        "ne verra' comunque usato il bounding box assiale.",
    );
  }

  const xMin = Math.min(...guides.map((el) => el.x));
  const xMax = Math.max(...guides.map((el) => el.x + el.width));

  return { xMin, xMax, guideIds: new Set(guides.map((el) => el.id)) };
}

/** Bounding box (y-axis) of every non-excluded, non-deleted element. */
export function computeContentBounds(elements, excludeIds) {
  const content = elements.filter(
    (el) => !el.isDeleted && !excludeIds.has(el.id),
  );
  if (content.length === 0) {
    throw new Error("Il disegno non contiene elementi oltre al rettangolo guida.");
  }
  const yMin = Math.min(...content.map((el) => el.y));
  const yMax = Math.max(...content.map((el) => el.y + el.height));
  const xMinAll = Math.min(...content.map((el) => el.x));
  const xMaxAll = Math.max(...content.map((el) => el.x + el.width));
  return { yMin, yMax, xMinAll, xMaxAll };
}

/**
 * Merges every element's vertical interval into a sorted list of occupied
 * [start, end] bands (ink), so we can find whitespace gaps between them.
 */
function occupiedBands(elements, mergeEps = 2) {
  const intervals = elements
    .filter((el) => el.height > 0)
    .map((el) => [el.y, el.y + el.height])
    .sort((a, b) => a[0] - b[0]);

  const merged = [];
  for (const [start, end] of intervals) {
    const last = merged[merged.length - 1];
    if (last && start <= last[1] + mergeEps) {
      last[1] = Math.max(last[1], end);
    } else {
      merged.push([start, end]);
    }
  }
  return merged;
}

/**
 * Splits [yMin, yMax] into pages of ~pageHeightScene each, nudging every
 * break point into the nearest whitespace gap (within toleranceFraction of
 * a page height) so no element is cut in half.
 */
export function paginate(elements, { yMin, yMax, pageHeightScene, toleranceFraction = 0.25 }) {
  const bands = occupiedBands(elements);
  const tolerance = pageHeightScene * toleranceFraction;
  const minPage = pageHeightScene * 0.4;

  const gapContaining = (y) => {
    // gap = space between the end of one band and the start of the next
    // (or before the first / after the last band).
    let prevEnd = yMin;
    for (const [start, end] of bands) {
      if (y >= prevEnd && y <= start) return [prevEnd, start];
      prevEnd = Math.max(prevEnd, end);
    }
    return [prevEnd, yMax];
  };

  const pages = [];
  let cursor = yMin;
  let warned = 0;

  while (cursor < yMax) {
    const target = cursor + pageHeightScene;
    if (target >= yMax) {
      pages.push({ yStart: cursor, yEnd: yMax });
      break;
    }

    const [gapStart, gapEnd] = gapContaining(target);
    const windowLo = Math.max(cursor + minPage, target - tolerance);
    const windowHi = target + tolerance;
    const lo = Math.max(gapStart, windowLo);
    const hi = Math.min(gapEnd, windowHi);

    let breakY;
    if (lo <= hi) {
      // pick the point in [lo, hi] closest to target
      breakY = Math.min(Math.max(target, lo), hi);
    } else {
      breakY = target; // no whitespace nearby: hard cut
      warned += 1;
    }

    pages.push({ yStart: cursor, yEnd: breakY });
    cursor = breakY;
  }

  if (warned > 0) {
    console.warn(
      `Attenzione: ${warned} interruzione/i di pagina cadono dentro un elemento ` +
        "(nessuno spazio bianco trovato nelle vicinanze).",
    );
  }

  return pages;
}
