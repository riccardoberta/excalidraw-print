import { generatePdf } from "./run.mjs";

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
  console.log(`Usage:
  node src/cli.mjs <excalidraw-link-or-file> [output.pdf] [options]

Options:
  --page-size a4|letter   default: a4
  --margin-mm N           default: 15
  --dpi N                 default: 200
  --tolerance N           fraction of a page height to search for a whitespace break (default 0.25)
  --keep-guide            do not exclude the red guide rectangle from the printed output
`);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const input = args._[0];
  const outFile = args._[1] || "output.pdf";

  if (!input) {
    printUsage();
    process.exit(1);
  }

  await generatePdf({
    input,
    outFile,
    pageSize: args["page-size"] || "a4",
    marginMm: Number(args["margin-mm"] || 15),
    dpi: Number(args.dpi || 200),
    tolerance: Number(args.tolerance || 0.25),
    keepGuide: !!args["keep-guide"],
  });
}

main().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});
