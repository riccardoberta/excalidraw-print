import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { chromium } from "playwright";
import { PDFDocument } from "pdf-lib";
import { startStaticServer } from "./server.mjs";

const MM_PER_PT = 25.4 / 72;

const PAGE_SIZES_MM = {
  a4: { width: 210, height: 297 },
  letter: { width: 215.9, height: 279.4 },
};

function mmToPt(mm) {
  return mm / MM_PER_PT;
}

let frameIdCounter = 0;
function makeFrameElement(x, y, width, height) {
  frameIdCounter += 1;
  return {
    id: `print-page-frame-${frameIdCounter}`,
    type: "frame",
    x,
    y,
    width,
    height,
    angle: 0,
    strokeColor: "#000000",
    backgroundColor: "transparent",
    fillStyle: "solid",
    strokeWidth: 1,
    strokeStyle: "solid",
    roughness: 0,
    opacity: 100,
    groupIds: [],
    frameId: null,
    roundness: null,
    seed: 1,
    versionNonce: 1,
    version: 1,
    isDeleted: false,
    boundElements: null,
    updated: 1,
    link: null,
    locked: false,
    name: null,
    index: null,
  };
}

async function renderPageToPng(page, { elements, files, frame, widthPx, heightPx }, outPath) {
  const svgString = await page.evaluate(
    ({ elements, files, frame }) =>
      window.__excalidrawRenderPage(elements, files, frame),
    { elements, files, frame },
  );

  await page.setViewportSize({
    width: Math.min(Math.ceil(widthPx), 8000),
    height: Math.min(Math.ceil(heightPx), 8000),
  });

  await page.evaluate(
    ({ svgString, widthPx, heightPx }) => {
      document.body.innerHTML = "";
      const doc = new DOMParser().parseFromString(svgString, "image/svg+xml");
      const svg = doc.documentElement;
      svg.setAttribute("width", `${widthPx}px`);
      svg.setAttribute("height", `${heightPx}px`);
      svg.setAttribute("preserveAspectRatio", "none");
      svg.style.display = "block";
      document.body.appendChild(svg);
    },
    { svgString, widthPx, heightPx },
  );

  await page.locator("svg").first().screenshot({ path: outPath });
}

/**
 * Renders each paginated slice of the drawing and assembles a print-ready
 * PDF, one physical page per slice.
 *
 * @param {object} scene - { elements, files } already stripped of the guide rectangle
 * @param {{xMin:number,xMax:number}} bounds - horizontal bounds from the red rectangle
 * @param {{yStart:number,yEnd:number}[]} pages - vertical slices from paginate()
 * @param {object} options - { pageSize: 'a4'|'letter', marginMm, dpi, outFile }
 */
export async function renderToPdf(scene, bounds, pages, options) {
  const { pageSize = "a4", marginMm = 15, dpi = 200, outFile } = options;
  const sizeMm = PAGE_SIZES_MM[pageSize];
  if (!sizeMm) throw new Error(`Formato pagina sconosciuto: ${pageSize}`);

  const printableWidthMm = sizeMm.width - 2 * marginMm;
  const pxPerMm = dpi / 25.4;
  const ptPerPx = 72 / dpi;
  const widthPx = printableWidthMm * pxPerMm;

  const sceneWidth = bounds.xMax - bounds.xMin;
  const scale = widthPx / sceneWidth; // px per scene-unit

  const { url, close: closeServer } = await startStaticServer();
  const browser = await chromium.launch();
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "excalidraw-print-"));

  try {
    const page = await browser.newPage();
    await page.goto(`${url}/index.html`);
    await page.waitForFunction(() => window.__excalidrawReady === true);

    const pngPaths = [];
    for (let i = 0; i < pages.length; i++) {
      const { yStart, yEnd } = pages[i];
      const sceneHeight = yEnd - yStart;
      const frame = makeFrameElement(bounds.xMin, yStart, sceneWidth, sceneHeight);

      // Every page renders at the same scale (full printable width), so
      // pages always look consistent with one another. A single block
      // taller than a full page (paginate() gives it its own page rather
      // than cutting it) is not shrunk to fit either — that page's physical
      // height simply grows enough to hold it, instead.
      const heightPx = sceneHeight * scale;
      const outPath = path.join(tmpDir, `page-${i + 1}.png`);

      console.log(`Rendering page ${i + 1}/${pages.length}...`);
      await renderPageToPng(
        page,
        { elements: scene.elements, files: scene.files, frame, widthPx, heightPx },
        outPath,
      );
      pngPaths.push({ outPath, heightPx });
    }

    const pdfDoc = await PDFDocument.create();
    const pageWidthPt = mmToPt(sizeMm.width);
    const pageHeightPt = mmToPt(sizeMm.height);
    const marginPt = mmToPt(marginMm);
    const imgWidthPt = widthPx * ptPerPx;

    for (const { outPath, heightPx } of pngPaths) {
      const pngBytes = fs.readFileSync(outPath);
      const png = await pdfDoc.embedPng(pngBytes);
      const imgHeightPt = heightPx * ptPerPx;
      const thisPageHeightPt = Math.max(pageHeightPt, imgHeightPt + 2 * marginPt);
      const pdfPage = pdfDoc.addPage([pageWidthPt, thisPageHeightPt]);
      pdfPage.drawImage(png, {
        x: marginPt,
        y: thisPageHeightPt - marginPt - imgHeightPt,
        width: imgWidthPt,
        height: imgHeightPt,
      });
    }

    const pdfBytes = await pdfDoc.save();
    fs.writeFileSync(outFile, pdfBytes);
  } finally {
    await browser.close();
    await closeServer();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}
