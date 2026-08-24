import http from "node:http";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { generatePdf, PAGE_SIZES_MM } from "./run.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const INDEX_HTML = fs.readFileSync(path.join(__dirname, "gui", "index.html"));
const PORT = Number(process.env.PORT) || 5173;
const DEFAULT_OUT_DIR = path.join(os.homedir(), "Desktop");

function expandHome(p) {
  if (p && p.startsWith("~")) return path.join(os.homedir(), p.slice(1));
  return p;
}

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    let data = "";
    req.on("data", (chunk) => (data += chunk));
    req.on("end", () => {
      try {
        resolve(JSON.parse(data || "{}"));
      } catch (err) {
        reject(err);
      }
    });
    req.on("error", reject);
  });
}

let busy = false;

async function handleGenerate(req, res) {
  if (busy) {
    res.writeHead(409, { "Content-Type": "text/plain" });
    res.end("Another job is already running, please wait for it to finish.\n");
    return;
  }

  let body;
  try {
    body = await readJsonBody(req);
  } catch {
    res.writeHead(400, { "Content-Type": "text/plain" });
    res.end("Invalid request body.\n");
    return;
  }

  busy = true;
  res.writeHead(200, { "Content-Type": "text/plain; charset=utf-8" });

  const origLog = console.log;
  const origWarn = console.warn;
  console.log = (...a) => {
    origLog(...a);
    res.write(a.join(" ") + "\n");
  };
  console.warn = (...a) => {
    origWarn(...a);
    res.write("WARNING: " + a.join(" ") + "\n");
  };

  try {
    const outDir = expandHome(body.outDir) || DEFAULT_OUT_DIR;
    fs.mkdirSync(outDir, { recursive: true });
    const outFile = path.join(outDir, body.outFile || "output.pdf");

    const result = await generatePdf({
      input: body.input,
      outFile,
      pageSize: PAGE_SIZES_MM[body.pageSize] ? body.pageSize : "a4",
      marginMm: Number(body.marginMm) || 15,
      dpi: Number(body.dpi) || 200,
      tolerance: body.tolerance !== undefined ? Number(body.tolerance) : 0.25,
      keepGuide: !!body.keepGuide,
    });
    res.write(`DONE:${result}\n`);
  } catch (err) {
    res.write(`ERROR:${err.message || err}\n`);
  } finally {
    console.log = origLog;
    console.warn = origWarn;
    busy = false;
    res.end();
  }
}

const server = http.createServer((req, res) => {
  if (req.method === "GET" && req.url === "/") {
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    res.end(INDEX_HTML);
    return;
  }

  if (req.method === "GET" && req.url === "/defaults") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ outDir: DEFAULT_OUT_DIR }));
    return;
  }

  if (req.method === "POST" && req.url === "/generate") {
    handleGenerate(req, res);
    return;
  }

  res.writeHead(404);
  res.end("Not found");
});

server.listen(PORT, "127.0.0.1", () => {
  console.log(`excalidraw-print GUI running at http://127.0.0.1:${PORT}`);
});
