import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const WWW_ROOT = path.join(__dirname, "..", "www");
const PROD_ROOT = path.join(
  __dirname,
  "..",
  "node_modules",
  "@excalidraw",
  "excalidraw",
  "dist",
  "prod",
);

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".woff2": "font/woff2",
  ".json": "application/json",
};

function safeResolve(root, urlPath) {
  const resolved = path.normalize(path.join(root, urlPath));
  if (!resolved.startsWith(root)) return null; // path traversal guard
  return resolved;
}

/**
 * Serves our generated www/ (index.html, bundle.js) with a fallback to the
 * excalidraw package's own dist/prod directory, so relative asset URLs in
 * its CSS (fonts, locale chunks) resolve exactly as the package expects.
 */
export function startStaticServer() {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      const urlPath = decodeURIComponent(req.url.split("?")[0]);

      for (const root of [WWW_ROOT, PROD_ROOT]) {
        const filePath = safeResolve(root, urlPath === "/" ? "/index.html" : urlPath);
        if (filePath && fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
          const ext = path.extname(filePath);
          res.writeHead(200, { "Content-Type": MIME[ext] || "application/octet-stream" });
          fs.createReadStream(filePath).pipe(res);
          return;
        }
      }

      res.writeHead(404);
      res.end("not found");
    });

    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address();
      resolve({
        url: `http://127.0.0.1:${port}`,
        close: () => new Promise((r) => server.close(r)),
      });
    });
  });
}
