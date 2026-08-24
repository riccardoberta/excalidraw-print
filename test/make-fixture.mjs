import fs from "node:fs";

function base(overrides) {
  return {
    angle: 0,
    strokeColor: "#1e1e1e",
    backgroundColor: "transparent",
    fillStyle: "solid",
    strokeWidth: 2,
    strokeStyle: "solid",
    roughness: 1,
    opacity: 100,
    groupIds: [],
    frameId: null,
    roundness: null,
    seed: Math.floor(Math.random() * 1e9),
    version: 1,
    versionNonce: Math.floor(Math.random() * 1e9),
    isDeleted: false,
    boundElements: null,
    updated: 1,
    link: null,
    locked: false,
    index: null,
    ...overrides,
  };
}

function text(id, x, y, str, fontSize = 28) {
  return base({
    id,
    type: "text",
    x,
    y,
    width: str.length * fontSize * 0.55,
    height: fontSize * 1.25,
    text: str,
    originalText: str,
    fontSize,
    fontFamily: 5, // Excalifont (hand-drawn)
    textAlign: "left",
    verticalAlign: "top",
    containerId: null,
    lineHeight: 1.25,
    baseline: fontSize,
  });
}

function rect(id, x, y, w, h, strokeColor = "#1e1e1e") {
  return base({ id, type: "rectangle", x, y, width: w, height: h, strokeColor });
}

const elements = [];

// red margin guide: spans the whole tall note, marks the width only
elements.push(rect("guide", 100, -20, 500, 3400, "#e03131"));

let y = 40;
for (let i = 1; i <= 25; i++) {
  elements.push(text(`t${i}`, 130, y, `Riga di appunti numero ${i} - lorem ipsum dolor sit amet`));
  y += 60;
  if (i % 5 === 0) {
    elements.push(rect(`box${i}`, 130, y, 300, 80));
    y += 110;
  } else {
    y += 20;
  }
}

const data = {
  type: "excalidraw",
  version: 2,
  source: "https://excalidraw.com",
  elements,
  appState: { viewBackgroundColor: "#ffffff", gridSize: null },
  files: {},
};

fs.writeFileSync(new URL("./fixture.excalidraw", import.meta.url), JSON.stringify(data, null, 2));
console.log("wrote test/fixture.excalidraw with", elements.length, "elements, y range ~0..", y);
