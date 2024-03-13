import fs from 'fs';
import http from 'http';
import { readPdfPages } from 'pdf-text-reader';

const LLAMA_API_URL = process.env.LLAMA_API_URL || 'http://127.0.0.1:11434/api/generate';

const FEATURE_MODEL = 'Xenova/all-MiniLM-L6-v2';

async function llama (prompt, attempt = 1) {
    const method = 'POST';
    const headers = {
        'Content-Type': 'application/json'
    };
    const stop = ['Llama:', 'User:', 'Question:', '<|im_end|>'];
    const body = JSON.stringify({
        model: "mistral-openorca",
        prompt,
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
        const data = await res.json();
        const { response } = data;
        return response.trim();
    }
    if (attempt > 3) {
        const message = 'LLM API server does not respond properly!';
        console.error(message);
        return message;
    }
    console.error('LLM API call failure:', response.status, 'Retrying...');
    return await llama(prompt, attempt + 1);
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

Question: {{QUESTION}}`;

async function exchange(from, to) {
    const url = `https://open.er-api.com/v6/latest/${from}`;
    console.log("Fetching", url);
    const response = await fetch(url);
    const data = await response.json();
    const rate = data.rates[to];
    return `As per ${data.time_last_update_utc}, 1 ${from} equal to ${Math.ceil(rate)} ${from}.`;
}

async function ingest (url) {

    const sequence = (N) => Array.from({ length: N }, (_, i) => i);

    const paginate = (entries, pagination) => entries.map(entry => {
        const { offset } = entry;
        const page = pagination.findIndex(i => i > offset);
        return { page, ...entry };
    });

    const isPunctuator = (ch) => (ch === '.') || (ch === '!') || (ch === '?');
    const isWhiteSpace = (ch) => (ch === ' ') || (ch === '\n') || (ch === '\t');

    const split = (text) => {
        const chunks = [];
        let str = '';
        let offset = 0;
        for (let i = 0; i < text.length; ++i) {
            const ch1 = text[i];
            const ch2 = text[i + 1];
            if (isPunctuator(ch1) && isWhiteSpace(ch2)) {
                str += ch1;
                const text = str.trim();
                chunks.push({ offset, text });
                str = '';
            }
            str += ch1;
        }
        if (str.length > 0) {
            chunks.push({ offset, text: str.trim() });
        }
        return chunks;
    }

    const vectorize = async (text) => {
        const transformers = await import('@xenova/transformers');
        const { pipeline } = transformers;
        const extractor = await pipeline('feature-extraction', FEATURE_MODEL, { quantized: true });

        const chunks = split(text);

        const result = [];
        for (let index = 0; index < chunks.length; ++index) {
            const { offset } = chunks[index];
            const block = chunks.slice(index, index + 3).map(({ text }) => text).join(' ');
            const sentence = block;
            const output = await extractor([sentence], { pooling: 'mean', normalize: true });
            const vector = output[0].data;
            result.push({ index, offset, sentence, vector });
        }
        return result;
    }


    console.log('INGEST:');
    const input = await readPdfPages({ url });
    console.log(' url:', url);
    const pages = input.map((page, number) => { return { number, content: page.lines.join(' ') } });
    console.log(' page count:', pages.length);
    const pagination = sequence(pages.length).map(k => pages.slice(0, k + 1).reduce((loc, page) => loc + page.content.length, 0))
    const text = pages.map(page => page.content).join(' ');
    const start = Date.now();
    let document = paginate(await vectorize(text), pagination);
    const elapsed = Date.now() - start;
    console.log(' vectorization time:', elapsed, 'ms');
    return document;
}

function parse (text) {
    const parts = {};
    const MARKERS = ['Answer', 'Observation', 'Action', 'Thought'];
    const ANCHOR = MARKERS.slice().pop();
    const start = text.lastIndexOf(ANCHOR + ':');
    if (start >= 0) {
        let str = text.substr(start);
        for (let i = 0; i < MARKERS.length; ++i) {
            const marker = MARKERS[i];
            const pos = str.lastIndexOf(marker + ':');
            if (pos >= 0) {
                const substr = str.substr(pos + marker.length + 1).trim();
                const value = substr.split('\n').shift();
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

async function answer (kind, passages, question) {
    console.log('ANSWER:');
    console.log(' question:', question);
    console.log('------- passages -------');
    console.log(passages);
    console.log('-------');
    const input = LOOKUP_PROMPT.
        replaceAll('{{KIND}}', kind).
        replace('{{PASSAGES}}', passages).
        replace('{{QUESTION}}', question);
    const output = await llama(input);
    const response = parse(input + output);
    console.log(' answer:', response.answer);
    return response.answer;
}

async function lookup (document, question, hint) {

    const encode = async (sentence) => {
        const transformers = await import('@xenova/transformers');
        const { pipeline } = transformers;
        const extractor = await pipeline('feature-extraction', FEATURE_MODEL, { quantized: true });

        const output = await extractor([sentence], { pooling: 'mean', normalize: true });
        const vector = output[0].data;
        return vector;
    }

    const search = async (q, document, top_k = 3) => {
        const { cos_sim } = await import('@xenova/transformers');

        const vector = await encode(q);
        const matches = document.map((entry) => {
            const score = cos_sim(vector, entry.vector);
            // console.log(`Line ${entry.index + 1} ${Math.round(100 * score)}%: ${entry.sentence}`);
            return { score, ...entry };
        });

        const relevants = matches.sort((d1, d2) => d2.score - d1.score).slice(0, top_k);
        relevants.forEach(match => {
            const { index, offset, sentence, score } = match;
            // console.log(`  Line ${index + 1} @${offset}, match ${Math.round(100 * score)}%: ${sentence}`)
        });

        return relevants;
    }

    const ascending = (x, y) => x - y;
    const dedupe = (numbers) => [...new Set(numbers)];

    const MIN_SCORE = 0.4;

    if (document.length === 0) {
        throw new Error('Document is not indexed!');
    }

    console.log('LOOKUP:');
    console.log(' question:', question);
    console.log(' hint:', hint);

    const candidates = await search(question + ' ' + hint, document);
    const best = candidates.slice(0, 1).shift();
    console.log(' best score:', best.score);
    if (best.score < MIN_SCORE) {
        const FROM_MEMORY = 'From my memory.';
        return { result: hint, source: FROM_MEMORY, reference: FROM_MEMORY };
    }

    const indexes = dedupe(candidates.map(r => r.index)).sort(ascending);
    const relevants = document.filter(({ index }) => indexes.includes(index));
    const passages = relevants.map(({ sentence }) => sentence).join(' ');
    const result = await answer('reference document', passages, question);

    const refs = await search(result || hint, relevants);
    const top = refs.slice(0, 1).pop();
    let source = `Best source (page ${top.page + 1}, score ${Math.round(top.score * 100)}%):\n${top.sentence}`;
    console.log(' source:', source);

    return { result, source, reference: passages };
}

async function act (document, question, action, observation) {
    const sep = action.indexOf(':');
    const name = action.substring(0, sep);
    const arg = action.substring(sep + 1).trim();

    if (name === 'lookup') {
        const { result, source, reference } = await lookup(document, question, observation);
        return { result, source, reference };
    }

    // fallback to a manual lookup
    console.error('Not recognized action', name, arg);
    return await act(document, question, 'lookup: ' + question, observation);
}


async function reason (document, history, question) {

    const capitalize = (str) => str[0].toUpperCase() + str.slice(1);
    const flatten = (parts) => Object.keys(parts).filter(k => parts[k]).map(k => `${capitalize(k)}: ${parts[k]}`).join('\n');

    const HISTORY_MSG = 'Before formulating a thought, consider the following conversation history.';
    const context = (history) => (history.length > 0) ? HISTORY_MSG + '\n\n' + history.map(flatten).join('\n') : '';

    console.log('REASON:');
    console.log(' question:', question);

    const prompt = REASON_PROMPT.replace('{{CONTEXT}}', context(history)).replace('{{QUESTION}}', question);
    const response = await llama(prompt);
    const steps = parse(prompt + response);
    const { thought, action, observation } = steps;
    console.log(' thought:', thought);
    console.log(' action:', action);
    console.log(' observation:', observation);
    console.log(' intermediate answer:', steps.answer);

    const { result, source, reference } = await act(document, question, action ? action : 'lookup: ' + question, observation);
    return { thought, action, observation, answer: result, source, reference };
}

(async () => {
    const document = await ingest('./Banking Product Example.pdf');

    let state = {
        history: [],
        source: 'Dunno',
        reference: 'Nothing yet'
    };

    const command = (key, response) => {
        const value = state[key.substring(1)];
        if (value && typeof value === 'string') {
            response.writeHead(200).end(value);
            return true;
        }
        return false;
    }

    const server = http.createServer(async (request, response) => {
        const { url } = request;
        if (url === '/health') {
            response.writeHead(200).end('OK');
        } else if (url === '/' || url === '/index.html') {
            response.writeHead(200, { 'Content-Type': 'text/html' });
            response.end(fs.readFileSync('./index.html'));
        } else if (url.startsWith('/chat')) {
            const parsedUrl = new URL(`http://localhost/${url}`);
            const { search } = parsedUrl;
            const question = decodeURIComponent(search.substring(1));
            if (question === '!reset') {
                state.history.length = 0;
                response.writeHead(200).end('Multi-turn conversation is reset.');
                return;
            }
            if (command(question, response)) {
                return;
            }
            console.log();
            const start = Date.now();
            const { thought, action, observation, answer, source, reference } = await reason(document, state.history, question);
            const elapsed = Date.now() - start;
            state.source = source;
            state.reference = reference;
            response.writeHead(200).end(answer);
            console.log('Responded in', elapsed, 'ms');
            state.history.push({ question, thought, action, observation, answer });
            while (state.history.length > 3) {
                state.history.shift();
            }
        } else {
            console.error(`${url} is 404!`)
            response.writeHead(404);
            response.end();
        }
    });

    const port = process.env.PORT || 5000;
    console.log('SERVER:');
    console.log(' port:', port);
    server.listen(port);
})();