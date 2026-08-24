import fs from "node:fs";
import { chromium } from "playwright";
import { resolveShareLink, fetchScene } from "./fetchScene.mjs";
import { joinAndExportScene } from "./exportViaApp.mjs";
import { findMarginRectangle, computeContentBounds, paginate } from "./paginate.mjs";
import { renderToPdf } from "./render.mjs";

export const PAGE_SIZES_MM = {
  a4: { width: 210, height: 297 },
  letter: { width: 215.9, height: 279.4 },
};

async function loadScene(input) {
  if (fs.existsSync(input)) {
    const raw = JSON.parse(fs.readFileSync(input, "utf-8"));
    return {
      elements: raw.elements || [],
      appState: raw.appState || {},
      files: raw.files || {},
    };
  }

  const browser = await chromium.launch();
  try {
    const resolved = await resolveShareLink(await browser.newPage(), input);
    if (resolved.type === "json") {
      return await fetchScene(resolved);
    }
    console.log("Excalidraw+ room link: joining as a guest and exporting from the app...");
    return await joinAndExportScene(browser, input);
  } finally {
    await browser.close();
  }
}

/**
 * Runs the full pipeline (load -> find margins -> paginate -> render) and
 * writes the resulting PDF to `outFile`. Shared by the CLI and the GUI
 * server. Progress is reported via console.log/console.warn.
 *
 * @returns {Promise<string>} the output file path
 */
export async function generatePdf({
  input,
  outFile,
  pageSize = "a4",
  marginMm = 15,
  dpi = 200,
  keepGuide = false,
}) {
  if (!input) throw new Error("Missing input (link or .excalidraw file path)");
  if (!outFile) throw new Error("Missing output file path");

  const sizeMm = PAGE_SIZES_MM[pageSize];
  if (!sizeMm) throw new Error(`Unknown page size: ${pageSize}`);

  console.log(`Loading scene from: ${input}`);
  const scene = await loadScene(input);
  console.log(`Found ${scene.elements.length} elements.`);

  const { xMin, xMax, guideIds } = findMarginRectangle(scene.elements);
  console.log(`Horizontal margins (from the red rectangle): x=[${xMin.toFixed(0)}, ${xMax.toFixed(0)}]`);

  const { yMin, yMax } = computeContentBounds(scene.elements, guideIds);
  console.log(`Vertical content extent: y=[${yMin.toFixed(0)}, ${yMax.toFixed(0)}]`);

  const printableWidthMm = sizeMm.width - 2 * marginMm;
  const printableHeightMm = sizeMm.height - 2 * marginMm;
  const sceneWidth = xMax - xMin;
  const pageHeightScene = (printableHeightMm / printableWidthMm) * sceneWidth;

  const elementsForRender = keepGuide
    ? scene.elements.filter((el) => !el.isDeleted)
    : scene.elements.filter((el) => !el.isDeleted && !guideIds.has(el.id));

  const pages = paginate(elementsForRender, { yMin, yMax, pageHeightScene });
  console.log(`Paginated into ${pages.length} page(s).`);

  await renderToPdf(
    { elements: elementsForRender, files: scene.files },
    { xMin, xMax },
    pages,
    { pageSize, marginMm, dpi, outFile },
  );

  console.log(`Done: ${outFile}`);
  return outFile;
}
