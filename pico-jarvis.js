import http from 'http';
import fs from 'fs';

const LLAMA_API_URL = process.env.LLAMA_API_URL || 'http://18.143.138.212:11434/api/generate';

async function llama(prompt) {
    const method = 'POST';
    const headers = {
        'Content-Type': 'application/json'
    };

    const body = JSON.stringify({ 
        model: 'orca-mini',
        prompt,
        options: {
            num_predict: 200,
            temperature: 0,
            top_k: 20
        },
        stream: false
    });

    const request = { method, headers, body };
    const res = await fetch(LLAMA_API_URL, request);
    try {
        console.log(res);
        const { response } = await res.json();
        console.log(response);
        return response;
    } catch(error) {
        console.error(error);
    }

}

async function handler(req, res) {

    const { url } = req;
    console.log(req.url);

    if ( url === '/health' ) {
        res.writeHead(200).end('OK');
    } else if ( url === '/' || url === '/index.html' ) {
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end(fs.readFileSync('./index.html'));
    } else if( url.startsWith('/chat') ) {
        const parsesUrl = new URL(`http://localhost/${url}`);
        const { search } = parsesUrl;
        const question = decodeURIComponent(search.substring(1));
        const answer = await llama(question);
        console.log({ question, answer });
        res.writeHead(200).end(answer);
    } else {
        console.error(`${url} is 404`);
        res.writeHead(404);
        res.end();
    }
}

http.createServer(handler).listen(3000);