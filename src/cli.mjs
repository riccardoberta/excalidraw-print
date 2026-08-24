import fs from "node:fs";
import { chromium } from "playwright";
import { resolveShareLink, fetchScene } from "./fetchScene.mjs";
import { joinAndExportScene } from "./exportViaApp.mjs";
import { findMarginRectangle, computeContentBounds, paginate } from "./paginate.mjs";
import { renderToPdf } from "./render.mjs";

function parseArgs(argv) {
  const args = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith("--")) {
      const key = a.slice(2);
      const next = argv[i + 1];
      if (next === undefined || next.startsWith("--")) {
        args[key] = true;
      } else {
        args[key] = next;
        i++;
      }
    } else {
      args._.push(a);
    }
  }
  return args;
}

function printUsage() {
  console.log(`Uso:
  node src/cli.mjs <link-o-file-excalidraw> [output.pdf] [opzioni]

Opzioni:
  --page-size a4|letter   default: a4
  --margin-mm N           default: 15
  --dpi N                 default: 200
  --tolerance N           frazione di pagina entro cui cercare uno spazio bianco (default 0.25)
  --keep-guide            non escludere il rettangolo rosso dalla stampa
`);
}

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
    console.log("Link di una stanza Excalidraw+: mi unisco come ospite ed esporto dall'app...");
    return await joinAndExportScene(browser, input);
  } finally {
    await browser.close();
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const input = args._[0];
  const outFile = args._[1] || "output.pdf";

  if (!input) {
    printUsage();
    process.exit(1);
  }

  console.log(`Caricamento scena da: ${input}`);
  const scene = await loadScene(input);
  console.log(`Trovati ${scene.elements.length} elementi.`);

  const { xMin, xMax, guideIds } = findMarginRectangle(scene.elements);
  console.log(`Margini orizzontali (dal rettangolo rosso): x=[${xMin.toFixed(0)}, ${xMax.toFixed(0)}]`);

  const { yMin, yMax } = computeContentBounds(scene.elements, guideIds);
  console.log(`Estensione verticale del contenuto: y=[${yMin.toFixed(0)}, ${yMax.toFixed(0)}]`);

  const pageSize = args["page-size"] || "a4";
  const marginMm = Number(args["margin-mm"] || 15);
  const dpi = Number(args.dpi || 200);
  const tolerance = Number(args.tolerance || 0.25);
  const keepGuide = !!args["keep-guide"];

  const PAGE_SIZES_MM = { a4: { width: 210, height: 297 }, letter: { width: 215.9, height: 279.4 } };
  const sizeMm = PAGE_SIZES_MM[pageSize];
  const printableWidthMm = sizeMm.width - 2 * marginMm;
  const printableHeightMm = sizeMm.height - 2 * marginMm;
  const sceneWidth = xMax - xMin;
  const pageHeightScene = (printableHeightMm / printableWidthMm) * sceneWidth;

  const elementsForRender = keepGuide
    ? scene.elements.filter((el) => !el.isDeleted)
    : scene.elements.filter((el) => !el.isDeleted && !guideIds.has(el.id));

  const pages = paginate(elementsForRender, {
    yMin,
    yMax,
    pageHeightScene,
    toleranceFraction: tolerance,
  });
  console.log(`Impaginato in ${pages.length} pagine.`);

  await renderToPdf(
    { elements: elementsForRender, files: scene.files },
    { xMin, xMax },
    pages,
    { pageSize, marginMm, dpi, outFile },
  );

  console.log(`Fatto: ${outFile}`);
}

main().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});
