import * as esbuild from "esbuild";

await esbuild.build({
  entryPoints: ["src/browser/entry.js"],
  bundle: true,
  outfile: "www/bundle.js",
  format: "iife",
  platform: "browser",
  target: "es2020",
  define: { "process.env.NODE_ENV": '"production"' },
});

console.log("built www/bundle.js");
