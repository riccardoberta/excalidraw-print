import { exportToSvg } from "@excalidraw/excalidraw";

const FONT_FAMILIES = [
  "Assistant",
  "Cascadia",
  "ComicShanns",
  "Excalifont",
  "Liberation",
  "Lilita",
  "Nunito",
  "Virgil",
  "Xiaolai",
];

async function preloadFonts() {
  await Promise.all(
    FONT_FAMILIES.map((f) =>
      document.fonts.load(`20px "${f}"`).catch(() => {}),
    ),
  );
  await document.fonts.ready;
}

/**
 * Renders one page: `frame` is a synthetic Excalidraw "frame" element whose
 * x/y/width/height define the exact crop rectangle for this page. Returns
 * the exported SVG as a string.
 */
window.__excalidrawRenderPage = async function (elements, files, frame) {
  await preloadFonts();
  const allElements = [...elements, frame];
  const svg = await exportToSvg({
    elements: allElements,
    appState: {
      exportBackground: true,
      viewBackgroundColor: "#ffffff",
      exportPadding: 0,
    },
    files: files || {},
    exportingFrame: frame,
  });
  return svg.outerHTML;
};

window.__excalidrawReady = true;
