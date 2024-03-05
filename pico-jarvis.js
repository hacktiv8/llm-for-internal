const fs = require('fs');
const http = require('http');

const LLAMA_API_URL = 'http://127.0.0.1:11434/api/generate';

async function llama(prompt) {
    const method = 'POST';
    const headers = {
        'Content-Type': 'application/json'
    };
    const body = JSON.stringify({
        model: 'mistral-openorca',
        prompt: prompt,
        options: {
            num_predict: 200,
            temperature: 0,
            top_k: 20
        },
        stream: false
    });
    const request = { method, headers, body };
    const res = await fetch(LLAMA_API_URL, request);
    const { response } = await res.json();
    
    return response.trim();
}

const SYSTEM_MESSAGE = `You run in a process of Question, Thought, Action, Observation.

Use Thought to describe your thoughts about the question you have been asked.
Observation will be the result of running those actions.

If you can not answer the question from your memory, use Action to run one of these actions available to you:

- exchange: from to
- lookup: terms

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

Question: Who painted Mona Lisa?
Thought: This is about general knowledge, I can recall the answer from my memory.
Action: lookup: painter of Mona Lisa.
Observation: Mona Lisa was painted by Leonardo da Vinci .
Answer: Leonardo da Vinci painted Mona Lisa.`;

async function exchange(from, to) {
    const url = `https://open.er-api.com/v6/latest/${from}`;
    console.log('Fetching', url);
    const response = await fetch(url);
    const data = await response.json();
    const rate = data.rates[to];
    return `As per ${data.time_last_update_utc}, 1 ${from} equal to ${Math.ceil(rate)} ${from}.`;
}

async function answer(text) {
    const MARKER = 'Answer:';
    const pos = text.lastIndexOf(MARKER);
    if (pos < 0) return "?";
    const answer = text.substr(pos + MARKER.length).trim();
    return answer;
}

const HISTORY_MSG = "Before formulating a thought, consider the following conversation history.";

function context(history) {
    if (history.length > 0) {
        const recents = history.slice(-3 * 2); // only last 3 Q&A
        return `${HISTORY_MSG}\n\n${recents.join('\n')}`;
    }

    return "";
}

async function reason(history, inquiry) {
    
    const prompt = `${SYSTEM_MESSAGE}\n\n${context(history)}\n\n
    Now let us go!\n\n${inquiry}`;

    const response = await llama(prompt);
    console.log(`---\n${response}\n---`);

    let conclusion = '';

    const action = await act(response);
    if (action === null) {
        return answer(`Answer: ${response}`);
    } else {
        console.log("REASON result: ", action.result);
        
        conclusion = await llama(finalPrompt(inquiry, action.result));
    }

    return conclusion;
}

async function act(text) {
    const MARKER = "Action:";
    const pos = text.lastIndexOf(MARKER);
    if (pos < 0) return null;

    const subtext = text.substr(pos) + "\n";
    const matches = /Action:\s*(.*?)\n/.exec(subtext);
    const action = matches[1];
    if (!action) return null;

    const SEPARATOR = ":";
    const sep = action.indexOf(SEPARATOR);
    if (sep < 0) return null;

    const name = action.substring(0, sep);
    const args = action.substring(sep + 1).trim().split(" ");

    if (name === "lookup") return null;

    if (name === "exchange") {
        
        const result = await exchange(args[0].trim(), args[1].trim());
        console.log("ACT exchange", { args, result });
        return { action, name, args, result };
    }

    console.log("Not recognized action", { name, args });
    return null;
}

const finalPrompt = (inquiry, observation) => `${inquiry}
Observation: ${observation}.
Thought: Now I have the answer.
Answer:`;

const history = [];

async function handler(request, response) {
    const { url } = request;
    console.log(`Handling ${url}...`);
    if (url === '/health') {
        response.writeHead(200).end('OK');
    } else if (url === '/' || url === '/index.html') {
        response.writeHead(200, { 'Content-Type': 'text/html' });
        response.end(fs.readFileSync('./index.html'));
    } else if (url.startsWith('/chat')) {
        const parsedUrl = new URL(`http://localhost/${url}`);
        const { search } = parsedUrl;
        const question = decodeURIComponent(search.substring(1));
        console.log('Waiting for Llama...');
        const inquiry = `Question: ${question}`;
        const answer = await reason(history, inquiry);
        console.log('LLama answers:', answer);
        response.writeHead(200).end(answer);
        history.push(inquiry)
    } else {
        console.error(`${url} is 404!`)
        response.writeHead(404);
        response.end();
    }
}

http.createServer(handler).listen(5000);
