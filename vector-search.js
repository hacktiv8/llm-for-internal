import { readPdfPages } from "pdf-text-reader";

const FEATURE_MODEL = 'Xenova/paraphrase-MiniLM-L3-v2';
const TOP_K = 3;

function isPunctuator(ch) {
  return ch === "." || ch === "!" || ch === "?";
}

function isWhiteSpace (ch) {
  return ch === " " || ch === "\t" || ch === "\n";
}

function split(text) {
  const chunks = [];
  let str = "";
  let offset = 0;
  for (let i = 0; i < text.length; i++) {
    const ch1 = text[i];
    const ch2 = text[i + 1];

    if (isPunctuator(ch1) && isWhiteSpace(ch2)) {
      str += ch1;
      
      const text = str.trim();
      chunks.push({ offset, text });
      str = "";
      offset = i + 1;
      continue;
    }
    str += ch1;
  }

  if (str.length > 0) {
    chunks.push({ offset, text: str.trim() });
  }
  return chunks;
}

async function vectorize(text) {
  const transformers = await import("@xenova/transformers");
  const { pipeline } = transformers;
  const extractor = await pipeline("feature-extraction", FEATURE_MODEL, { quantized: true });

  const chunks = split(text);

  const start = Date.now();
  let result = [];

  for (let index =0; index < chunks.length; index++) {
    const { offset, text } = chunks[index];
    const sentence = text;
    const output = await extractor([sentence], { pooling: "mean", normalize: true });
    const vector = output[0].data;
    result.push({ index, offset, sentence, vector });
  }

  const elapsed = Date.now() - start;

  if (result.length > 1) console.log(`Finished computing the vectors for ${result.length} sentences in ${elapsed}ms`);

  return result;
}

async function search(q, document, top_k = TOP_K) {
  const { cos_sim } = await import("@xenova/transformers");

  const { vector } = (await vectorize(q)).pop();
  const matches = document.map(function (entry) {
    const score = cos_sim(vector, entry.vector);
    return { score, ...entry };
  });

  const relevants = matches.sort(function (d1, d2) {
    return d2.score - d1.score;
  }).slice(0, top_k);

  return relevants;
}

(async function (){
  const args = process.argv.slice(2);
  if (args.length != 1) {
    console.log("Usage: vector-search 'Some sentence about something'");
    process.exit(-1);
  }

  const query = args[0];

  const input = await readPdfPages({ url: "./document.pdf" });
  const pages = input.map(function (page, num) {
    return { num, content: page.lines.join(" ") };
  });
  const text = pages.map(function (page) {
    return page.content;
  }).join(" ");
  const document = await vectorize(text);

  console.log(`The ${TOP_K} most relevant sentences are: `);
  const hits = await search(query, document);
  hits.forEach(function (match) {
    const { index, sentence, score } = match;
    console.log(` Line ${index + 1}, score ${Math.round(100 * score)}%: ${sentence}`);
  });

})();