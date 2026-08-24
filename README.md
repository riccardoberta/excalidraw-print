# excalidraw-print

Turn a long, hand-drawn Excalidraw note into a well-laid-out, multi-page PDF ready for printing.

Excalidraw canvases have no page boundaries, so a tall note (lecture notes, a running log, a whiteboard session) has to be split into pages somehow before it can be printed. This tool does that automatically:

- you mark the **horizontal** margins of your note with a **red rectangle** on the canvas
- the tool measures how tall your content actually is and splits it into as many pages as needed
- page breaks are nudged into whitespace gaps between elements whenever possible, so a line of text or a diagram is never sliced in half
- each page is rendered using the real `@excalidraw/excalidraw` library (in headless Chromium), so fonts, hand-drawn strokes and colors look exactly like in the app
- the pages are assembled into a single PDF, one physical page (A4 or Letter) per slice

## Requirements

- Node.js 18+ (needs the built-in `fetch` and `crypto.subtle`, both global since Node 18/19)
- npm

## Setup

```bash
npm install
npx playwright install chromium
```

`npx playwright install chromium` downloads a headless Chromium build (~200 MB) used for rendering — this is a one-time step.

## The margin guide rectangle

The tool needs one **rectangle** element on the canvas with a **red stroke color** (Excalidraw's default red swatch, e.g. `#e03131`). Its horizontal extent (`x` to `x + width`) defines the printable width — the guide's *height* and vertical position don't matter, it can be as tall as you like, or you can just stretch it the full length of your notes as you write.

Everything to the left/right of the guide gets clipped off; everything above/below it (i.e. all your actual content) becomes the printable area for pagination. The guide rectangle itself is excluded from the printed output by default.

[`examples/margin-guide.excalidraw`](examples/margin-guide.excalidraw) contains just this rectangle — open it in Excalidraw and draw or paste your notes on top of it, keeping your content between the two red lines.

## Usage

```bash
node src/cli.mjs <input> [output.pdf] [options]
```

or, via the npm script (which also rebuilds the render bundle first):

```bash
npm run print -- <input> [output.pdf] [options]
```

`<input>` can be:

- **a local `.excalidraw` file** — exported from Excalidraw via the menu → *Save to file*
- **an Excalidraw shareable link** (`https://excalidraw.com/#json=...` or a `link.excalidraw.com` short link pointing to one) — the open-source app's read-only export link. The scene is downloaded and decrypted directly (client-side encryption key comes from the URL itself, same as the app does).
- **an Excalidraw+ room invite link** (`app.excalidraw.com`, e.g. from `link.excalidraw.com/l/...`) — the tool joins the room as a guest (view+edit rights, same as clicking "Join as a guest" yourself), opens the *Export image* dialog with **Embed scene** enabled, and downloads the scene from there. It never draws on or otherwise edits the canvas. Because this actually joins the room, only use it with rooms you're allowed to join — other participants will see the guest join, same as if you opened the link yourself.

### Options

| Flag | Default | Description |
|---|---|---|
| `--page-size` | `a4` | `a4` or `letter` |
| `--margin-mm` | `15` | Physical page margin, in mm |
| `--dpi` | `200` | Raster resolution used when rendering each page |
| `--keep-guide` | off | Keep the red guide rectangle visible in the printed output instead of excluding it |

### Examples

```bash
# from a local file
node src/cli.mjs examples/margin-guide.excalidraw guide.pdf

# from an Excalidraw+ link, Letter paper, wider margins
node src/cli.mjs "https://link.excalidraw.com/l/xxxxx/yyyyy" notes.pdf --page-size letter --margin-mm 20
```

## GUI

A small local web form is included for interactive use, so you don't need the command line:

```bash
npm run gui
```

This starts a server on [http://127.0.0.1:5173](http://127.0.0.1:5173) (open it in a browser) with a form for the link/file, destination folder, output file name, and all the options above (pre-filled with their defaults). Submitting streams progress live and shows the final file path once the PDF is ready. Everything runs locally — nothing leaves your machine except the requests Excalidraw itself needs to load the scene.

Set the `PORT` environment variable to use a different port, e.g. `PORT=8080 npm run gui`.

### Install as a Mac app

To launch the GUI without a terminal — from Spotlight, Launchpad, or `~/Applications` — install it as a small app bundle:

```bash
npm run install:mac
```

This symlinks [`mac/excalidraw-print.app`](mac/excalidraw-print.app) into `~/Applications/excalidraw-print.app`. The app is just a launcher script (no Xcode build involved): double-clicking it starts the local server if it isn't already running and opens the form in its own chrome-less window (using the Chromium build Playwright already manages, in `--app=` mode — no tabs or address bar, so it feels like a real app rather than a browser tab); closing that window or quitting the app (Cmd+Q, or Dock → Quit) stops the server. It resolves its project directory relative to itself, so it keeps working if you move the whole `excalidraw-print` folder — as long as `mac/excalidraw-print.app` stays inside it.

Diagnostics for every launch are logged to `~/Library/Logs/excalidraw-print.log`, useful if the app ever fails silently (nothing is visible in a terminal when it's launched from Spotlight/Finder).

Since the app isn't code-signed, **the first time you launch it** macOS Gatekeeper will likely refuse to open it with a "cannot be opened because the developer cannot be verified" warning. Right-click (or Control-click) the app in `~/Applications` and choose **Open**, then confirm in the dialog — this is only needed once.

## How it works, briefly

1. **Load the scene** — from a local file, an OSS shareable link, or by joining an Excalidraw+ room and exporting an SVG with the scene embedded in it.
2. **Find the margins** — locate the red-stroked rectangle(s) and take their combined x-range.
3. **Measure the content** — compute the vertical bounding box of every other element.
4. **Paginate** — first, elements sharing an Excalidraw group are merged into a single block (arrows and lines aren't counted here — they're often used as connectors pointing from one group toward the next, and would otherwise bridge unrelated groups into one huge block). Then each page is filled with as many whole blocks as fit within the nominal page height; the moment the next block wouldn't fit, it moves entirely to the next page instead (shrinking this one, never cutting it). Nothing is ever scaled down to fit: the one exception is a single block taller than a full page, which still gets a page of its own, at the same scale as every other page — that page is just physically taller instead.
5. **Render** — for each page, a synthetic Excalidraw "frame" element is used to crop the scene to that page's exact rectangle via `exportToSvg`'s native frame-export support, then rasterized in Chromium at the target DPI.
6. **Assemble** — the page images are placed onto A4/Letter PDF pages with the requested margins via `pdf-lib`.

## Project layout

```
src/
  cli.mjs           CLI entry point: argument parsing
  gui-server.mjs     GUI entry point: local web server + streaming job log
  gui/index.html     GUI form page
  run.mjs            shared pipeline: load -> find margins -> paginate -> render, used by both CLI and GUI
  fetchScene.mjs     OSS shareable-link (#json=...) download + decrypt
  exportViaApp.mjs   Excalidraw+ room join + in-app export automation
  paginate.mjs       margin detection, content bounds, page-break search
  render.mjs         Playwright-driven per-page rendering + PDF assembly
  server.mjs         tiny static file server (serves the render bundle + Excalidraw's own assets/fonts)
  browser/entry.js   in-page script bundled into www/bundle.js, wraps exportToSvg
build.mjs            esbuild script that produces www/bundle.js
examples/            sample .excalidraw files
```
