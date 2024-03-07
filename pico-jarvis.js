import fs from "fs";
import http from "http";
import { readPdfPages } from "pdf-text-reader";

const LLAMA_API_URL = "http://127.0.0.1:11434/api/generate";
const FEATURE_MODEL = "Xenova/all-MiniLM-L6-v2";

async function llama(prompt, attempt = 1) {
    const method = "POST";
    const headers = {
        "Content-Type": "application/json"
    };
    const stop = ["Llama:", "User:", "Question:"];

    const body = JSON.stringify({
        model: "mistral-openorca",
        prompt: prompt,
        options: {
            num_predict: 200,
            temperature: 0,
            top_k: 20,
            stop,
        },
        stream: false
    });
    const request = { method, headers, body };
    const res = await fetch(LLAMA_API_URL, request);

    if (res.ok) {
        const { response } = await res.json();
        return response.trim();
    }

    if (attempt > 3) {
        const message = "LLM API server does not response properly!";
        console.error(message);
        return message;
    }

    console.error(`LLM API call failure:${response.status}, retrying...`);

    return await(llama(prompt, attempt + 1));
}

const REASON_PROMPT = `You run in a process of Question, Thought, Action, Observation.

Think step by step. Always specify the full steps: Thought, Action, Observation, and Answer.

Use Thought to describe your thoughts about the question you have been asked.
For Action, choose exactly one of the following:

- exchange: from to
- lookup: terms

Observation will be the result of running those actions.
Finally at the end, state the Answer in the same language as the original Question.

Here are some sample sessions.

Question: What is capital of france?
Thought: This is about geography, I can recall the answer from my memory.
Action: lookup: capital of France.
Observation: Paris is the capital of France.
Answer: The capital of France is Paris.

Question: What is the exchange rate from USD to EUR?
Thought: This is about currency exchange rates, I need to check the current rate.
Action: exchange: USD EUR
Observation: 0.8276 EUR for 1 USD.
Answer: The current exchange rate is 0.8276 EUR for 1 USD.

{{CONTEXT}}

Now it is your turn to answer the following!

Question: {{QUESTION}}
`;

async function exchange(from, to) {
    const url = `https://open.er-api.com/v6/latest/${from}`;
    console.log("Fetching", url);
    const response = await fetch(url);
    const data = await response.json();
    const rate = data.rates[to];
    return `As per ${data.time_last_update_utc}, 1 ${from} equal to ${Math.ceil(rate)} ${from}.`;
}

function parse(text) {
    const parts = {};
    const MARKERS = ["Answer", "Observation", "Action", "Thought"];
    const ANCHOR = MARKERS.slice().pop();
    const start = text.lastIndexOf(`${ANCHOR}:`);
    if (start >= 0) {
        let str = text.substr(start)
        for (let i = 0; i < MARKERS.length; i++) {
            const marker = MARKERS[i];
            const pos = str.lastIndexOf(`${marker}:`);
            if (pos >= 0) {
                const substr = str.substr(pos + marker.length + 1).trim();
                const value = substr.split("\n").shift();
                str = str.slice(0, pos);   
                const key = marker.toLowerCase();
                parts[key] = value;
            }
        }
    }

    return parts;
}

const LOOKUP_PROMPT = `You are an expert in retrieving information.
You are given a {{KIND}}, and then you respond to a question.
Avoid stating your personal opinion. Avoid making other commentary.
Think step by step.

Here is the {{KIND}}:

{{PASSAGES}}

(End of {{KIND}})

Now it is time to use the above {{KIND}} exclusively to answer this.

Question: {{QUESTION}}
Thought: Let us the above reference document to find the answer.
Answer:`;

async function answer(kind, passage, question) {
    console.log("ANSWER:");
    console.log(" question:", question);
    console.log("------------- passages -------------");
    console.log(passage);
    console.log("-------------");

    const input = LOOKUP_PROMPT
    .replaceAll("{{KIND}}", kind)
    .replaceAll("{{PASSAGES}}", passage)
    .replaceAll("{{QUESTION}}", question);
    const output = await llama(input);
    const response = parse(input + output);
    console.log(" answer:", response.answer);
    return response.answer;
}

async function lookup(document, question, hint) {
    
    async function encode(sentence) {
        const transformers = await import("@xenova/transformers");
        const { pipeline } = transformers;
        const extractor = await pipeline("feature-extraction", FEATURE_MODEL, { quantized: true });

        const output = await extractor([sentence], { pooling: "mean", normalize: true });
        return output[0].data;
    }
    async function search(q, document, top_k = 3) {
        const { cos_sim } = await import("@xenova/transformers");

        const vector = await encode(q);
        const matches = document.map(function (entry) {
            const score = cos_sim(vector, entry.vector);
            return { score, ...entry };
        });

        const relevants = matches.sort(function (d1, d2) {
            return d2.score - d1.score;
        }).slice(0, top_k);

        return relevants;
        
    }

    function ascending(x, y) {
        return x -y;
    }

    function dedupe(numbers) {
        return [...new Set(numbers)];
    }

    const MIN_SCORE = 0.4;

    if (document.length === 0) {
        throw new Error("Document is not indexed!");
    }

    console.log("LOOKUP:");
    console.log(" question:", question);
    console.log(" hint:", hint);

    const candidates = await search(`${question} ${hint}`, document);
    const best = candidates.slice(0, 1).shift();
    console.log(" best score:", best.score);
    if (best.score < MIN_SCORE) {
        const FROM_MEMORY = "From my memory.";
        return { result: hint, source: FROM_MEMORY, reference: FROM_MEMORY };
    }

    const indexes = dedupe(candidates.map(function (r) {
        return r.index;
    })).sort(ascending);

    const relevants = document.filter(function ({ index }) {
        return indexes.includes(index);
    });

    const passages = relevants.map(function ({ sentence }) {
        return sentence;
    }).join(" ");

    const result = await answer("reference document", passages, question);

    const refs = await search(result || hint, relevants);
    const top = refs.slice(0, 1).pop();
    source = `Best source (page ${top.page + 1}, score ${Math.round(top.score * 100)}%): ${top.sentence}`;
    console.log(" source:", source);

    return { result, source, reference: passages}

}


async function reason(document, history, question) {
    function capitalize(str) {
        return str[0].toUpperCase() + str.slice(1);
    }
    function flatten(parts) {
        return Object.keys(parts).filter(function (key) {
            return parts[key];
        }).map(function (key) {
            return `${capitalize(key)}: ${parts[key]}`;
        }).join("\n");
    }

    const HISTORY_MSG = "Before formulating a thought, consider the following conversation history.";

    function context(history) {
        if (history.length > 0) {
            return `${HISTORY_MSG}\n\n${history.map(flatten).join("\n")}`;
        }
    
        return "";
    }

    console.log("REASON:");
    console.log(" question:", question);

    const prompt = REASON_PROMPT.replace("{{CONTEXT}}", context(history)).replace("{{QUESTION}}", question);
    const response = await llama(prompt);
    const { thought, action, observation, answer } = parse(prompt + response);
    console.log(` thought:${thought}`);
    console.log(` action:${action}`);
    console.log(` observation:${observation}`);
    console.log(` intermediate answer:${answer}`);

    const { result, source, reference } = await act(document, question, action ? action : "lookup: " + question, observation);
    return { thought, action, observation, answer: result, source, reference };
    
}

async function act(document, question, action, observation) {
    const sep = action.indexOf(":");
    const name = action.substring(0, sep);
    const arg = action.substring(sep + 1).trim();
    console.log(`------------- NAME: ${name} -------------------`);

    if (name === "lookup") {
        const { result, source, reference } = await lookup(document, question, observation);
        return { result, source, reference };
    }

    if (name === "exchange") {
        const response = await exchange(...arg.split(" "));
        const { summary } = result;
        const result = await answer("exchange rate", summary, question);
        const reference = `Exchange rate API: ${JSON.stringify(response)}`;
        return { result, source: summary, reference };
    }

    // fallback to a manual lookup
    console.error("Not recognized action", name, arg);
    return await act(document, question, "lookup: " + question, observation);
}

async function ingest(url) {

    function sequence(N) {
        return Array.from({ length: N }, (_, i) => i + 1);
    }
    function paginate(entries, pagination) {
        return entries.map(function (entry) {
            const { offset } = entry;
            const page = pagination.findIndex(function (i) {
                return i > offset;
            });
            return { page, ...entry }
        });
    }

    function isPunctuator(ch) {
        return ch === "." || ch === "?" || ch === "!";
    }

    function isWhitespace(ch) {
        return ch === " " || ch === "\t" || ch === "\n";
    }

    function split(text) {
        const chunks = [];
        let str = "";
        let offset = 0;

        for (let i = 0; i < text.length; i++) {
            const ch1 = text[i];
            const ch2 = text[i + 1];
            if (isPunctuator(ch1) && isWhitespace(ch2)) {
                str += ch1;
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

        const result = [];
        for (let index = 0; index < chunks.length; index++) {
            const { offset } = chunks[index];
            const sentence = chunks.slice(index, index + 3).map(function (chunk) {
                return chunk.text;
            }).join(" ");
            const ouutput = await extractor([sentence], { pooling: "mean", normalize: true });
            const vector = ouutput[0].data;
            result.push({ index, offset, sentence, vector });
        }
        return result;
    }

    console.log("INGEST:");
    const input = await readPdfPages({ url });
    console.log(` url:${url}`);
    const pages = input.map(function (page, number) {
        return { number, content: page.lines.join(" ") };
    });
    console.log(` page count:${pages.length}`);
    const pagination = sequence(pages.length).map(function (k) {
        return pages.slice(0, k + 1).reduce(function (loc, page) {
            return loc + page.content.length;
        }, 0);
    });
    const text = pages.map(function (page) {
        return page.content;
    }).join(" ");
    const start = Date.now();
    const vectorized = await vectorize(text);
    const document = paginate(vectorized, pagination);
    const elapsed = Date.now() - start;
    console.log(` vectorization time:${elapsed}ms`);
    return document;
}


(async function() {
    const document = await ingest("./document.pdf");

    let state = {
        history: [],
        source: '',
        reference: ''
    };

    function command(key, response) {
        const value = state[key.substring(1)];
        if (value && typeof value === "string") {
            response.writeHead(200).end(value);
            return true;
        }
        return false;
    }

    const server = http.createServer(async function(req, res) {
        const { url } = req;
        if (url === "/health") {
            res.writeHead(200).end("OK");    
        } else if (url === "/" || url === "/index.html") {
            res.writeHead(200, { "Content-Type": "text/html" });
            res.end(fs.readFileSync("./index.html"));
        } else if (url.startsWith("/chat")) {
            const parsedUrl = new URL(`http://localhost${url}`);
            const { search } = parsedUrl;
            const question = decodeURIComponent(search.substring(1));
            if (question === "!reset") {
                state.history.length = 0;
                res.writeHead(200).end("Multi-turn conversation is reset.");
                return;
            }
            if (command(question, res)) return;
            console.log();
            const start = Date.now();
            const { thought, action, observation, answer, source, reference } = await reason(document, state.history, question);
            const elapsed = Date.now() - start;
            state.source = source;
            state.reference = reference;
            res.writeHead(200).end(answer);
            console.log(`Responded in ${elapsed}ms`);
            state.history.push({ question, thought, action, observation, answer });
            while (state.history.length > 3) {
                state.history.shift();
            }
        } else {
            console.error(`${url} is 404!`);
            res.writeHead(404);
            res.end();
        }
        
    });

    const port = process.env.PORT || 5000;
    console.log("Server:");
    console.log(" port:", port);
    server.listen(port);
})();