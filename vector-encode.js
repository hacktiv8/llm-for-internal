const EMBEDDING_MODEL = "Xenova/paraphrase-MiniLM-L3-v2";

(async function() {
  const args = process.argv.slice(2);
  if (args.length < 1) {
    console.error("Usage: node vector-encode 'Some sentence about something'");
    process.exit(1);
  }

  const transformers = await import("@xenova/transformers");
  const { pipeline } = transformers;
  const extractor = await pipeline('feature-extraction', EMBEDDING_MODEL, { quantized: true });

  const text = args[0];
  const output = await extractor([text], { polling: 'mean', normalize: true });

  const embedding = output[0].data;
  console.log({ text, embedding });
})();