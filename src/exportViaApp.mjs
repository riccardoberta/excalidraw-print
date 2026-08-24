import zlib from "node:zlib";

/**
 * Headless Chromium aborts the real `showSaveFilePicker()` (no native
 * dialog available in this context). We shim it with an in-page fake
 * handle whose close() triggers a classic `<a download>` click instead,
 * which Playwright's `download` event can intercept normally.
 */
async function installSaveFilePickerShim(page) {
  await page.addInitScript(() => {
    window.showSaveFilePicker = async (opts) => {
      const chunks = [];
      return {
        kind: "file",
        name: opts?.suggestedName || "export",
        createWritable: async () => ({
          write: async (data) => {
            chunks.push(data && data.data !== undefined ? data.data : data);
          },
          close: async () => {
            const blob = new Blob(chunks);
            const url = URL.createObjectURL(blob);
            const a = document.createElement("a");
            a.href = url;
            a.download = opts?.suggestedName || "export";
            document.body.appendChild(a);
            a.click();
            a.remove();
          },
          truncate: async () => {},
          seek: async () => {},
        }),
        getFile: async () => {
          throw new Error("not supported by shim");
        },
      };
    };
  });
}

/**
 * Decodes the scene JSON embedded in an SVG exported with "Embed scene"
 * enabled — mirrors excalidraw's `decodeSvgBase64Payload`.
 */
export function decodeEmbeddedSvgScene(svgText) {
  const match = svgText.match(
    /<!-- payload-start -->\s*([\s\S]+?)\s*<!-- payload-end -->/,
  );
  if (!match) {
    throw new Error(
      "Nessuna scena incorporata trovata nell'SVG esportato " +
        "(l'opzione 'Embed scene' non risulta attiva).",
    );
  }

  const outerJson = Buffer.from(match[1], "base64").toString("latin1");
  const encodedData = JSON.parse(outerJson);
  const rawBytes = Buffer.from(encodedData.encoded, "latin1");
  const inflated = encodedData.compressed
    ? zlib.inflateSync(rawBytes)
    : rawBytes;
  const scene = JSON.parse(inflated.toString("utf-8"));

  return {
    elements: scene.elements || [],
    appState: scene.appState || {},
    files: scene.files || {},
  };
}

/**
 * Joins an Excalidraw+ room as a guest (view+edit rights) and drives the
 * "Export image" dialog to download an SVG with the scene embedded,
 * without ever modifying the canvas. Returns the decoded scene.
 */
export async function joinAndExportScene(browser, link) {
  const context = await browser.newContext({ acceptDownloads: true });
  const page = await context.newPage();
  await installSaveFilePickerShim(page);

  try {
    await page.goto(link);

    const joinButton = page.getByRole("button", { name: /join as a guest/i });
    const joinAppeared = await joinButton
      .waitFor({ state: "visible", timeout: 15000 })
      .then(() => true)
      .catch(() => false);
    if (joinAppeared) {
      await joinButton.click();
    }

    await page.waitForSelector(".main-menu-trigger", { state: "visible", timeout: 45000 });
    await page.waitForTimeout(2000); // let the room's elements finish syncing

    await page.locator(".main-menu-trigger").click();
    await page.getByText("Export image...", { exact: true }).click();
    await page.waitForSelector("#exportEmbedSwitch");

    const embedSwitch = page.locator("#exportEmbedSwitch");
    if (!(await embedSwitch.isChecked())) {
      await embedSwitch.click();
    }

    const downloadPromise = page.waitForEvent("download", { timeout: 20000 });
    await page.getByRole("button", { name: "Export to SVG" }).click();
    const download = await downloadPromise;

    const stream = await download.createReadStream();
    const chunks = [];
    for await (const chunk of stream) chunks.push(chunk);
    const svgText = Buffer.concat(chunks).toString("utf-8");

    return decodeEmbeddedSvgScene(svgText);
  } finally {
    await context.close();
  }
}
