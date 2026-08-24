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
      "No red rectangle found among the drawing's elements " +
        "(expected: a 'rectangle' element with a red strokeColor, " +
        "used to mark the horizontal margins).",
    );
  }

  const angled = guides.filter((el) => el.angle && Math.abs(el.angle) > 1e-3);
  if (angled.length > 0) {
    console.warn(
      `Warning: ${angled.length} red rectangle(s) are rotated; ` +
        "their axis-aligned bounding box will be used anyway.",
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
    throw new Error("The drawing has no elements besides the guide rectangle.");
  }
  const yMin = Math.min(...content.map((el) => el.y));
  const yMax = Math.max(...content.map((el) => el.y + el.height));
  const xMinAll = Math.min(...content.map((el) => el.x));
  const xMaxAll = Math.max(...content.map((el) => el.x + el.width));
  return { yMin, yMax, xMinAll, xMaxAll };
}

/**
 * Groups elements sharing an Excalidraw group (groupIds) into single
 * blocks, so a page break can never separate elements the user grouped
 * together.
 */
function buildBlocks(elements) {
  const parent = new Map(elements.map((el) => [el.id, el.id]));

  const find = (id) => {
    while (parent.get(id) !== id) {
      parent.set(id, parent.get(parent.get(id)));
      id = parent.get(id);
    }
    return id;
  };
  const union = (a, b) => {
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent.set(ra, rb);
  };

  const groupRep = new Map();
  for (const el of elements) {
    for (const gid of el.groupIds || []) {
      if (groupRep.has(gid)) union(el.id, groupRep.get(gid));
      else groupRep.set(gid, el.id);
    }
  }

  const groups = new Map();
  for (const el of elements) {
    if (el.height <= 0) continue;
    const root = find(el.id);
    if (!groups.has(root)) groups.set(root, []);
    groups.get(root).push(el);
  }

  return [...groups.values()].map((els) => ({
    elements: els,
    y: Math.min(...els.map((el) => el.y)),
    yEnd: Math.max(...els.map((el) => el.y + el.height)),
  }));
}

/**
 * Merges every block's vertical interval into a sorted list of occupied
 * [start, end] bands (ink), so we can find whitespace gaps between them.
 * Arrows/lines don't count as occupying space here: they're often used as
 * connectors pointing from one group toward the next, whose bounding box
 * would otherwise bridge two unrelated groups into one huge occupied
 * region. They're still rendered normally; a page break landing on one
 * just clips that thin connecting line, not any real content.
 */
function occupiedBands(elements, mergeEps = 2) {
  const contentElements = elements.filter((el) => el.type !== "arrow" && el.type !== "line");
  const blocks = buildBlocks(contentElements);
  const intervals = blocks
    .map((block) => [block.y, block.yEnd])
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
 * Splits [yMin, yMax] into pages of up to pageHeightScene each. A break is
 * never placed inside an element: if the nominal page height would land
 * inside one, the break backs off to just before that element instead (it
 * moves whole to the next page, shrinking this page), unless the element
 * is taller than a whole page, in which case it gets a page of its own
 * (the only case where a page can exceed pageHeightScene).
 */
export function paginate(elements, { yMin, yMax, pageHeightScene }) {
  const bands = occupiedBands(elements);
  const pages = [];
  let cursor = yMin;
  let oversized = 0;

  while (cursor < yMax) {
    const target = cursor + pageHeightScene;
    if (target >= yMax) {
      pages.push({ yStart: cursor, yEnd: yMax });
      break;
    }

    const straddling = bands.find(([start, end]) => start < target && target < end);
    let breakY = target;
    if (straddling) {
      const [start, end] = straddling;
      if (start > cursor) {
        breakY = start; // push the whole element to the next page
      } else {
        breakY = end; // element taller than a page: give it its own page
        oversized += 1;
      }
    }

    pages.push({ yStart: cursor, yEnd: breakY });
    cursor = breakY;
  }

  if (oversized > 0) {
    console.warn(
      `Warning: ${oversized} block(s) are taller than a full page; each got ` +
        "a taller page of its own (same scale as the rest) instead of being split.",
    );
  }

  return pages;
}
