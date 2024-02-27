# LLM For Internal

## Running LLM

After install [ollama](https://ollama.com), you can run LLM with the following command:

```
$ ollama run orca-mini
>>> Can you speak Bahasa Indonesia?
Yes, I can speak and understand Bahasa Indonesia.
```

### Running Ollama as a service

```
$ ollama serve
```

```
$ curl http://localhost:11434/api/generate -d '{
  "model": "orca-mini",
  "prompt": "Can you speak Bahasa Indonesia?",
  "stream": false
}'
```

## Running the web interface

```shell
$ git clone https://github.com/hacktiv8/llm-for-internal.git
$ cd llm-for-internal
$ git checkout 2-instruction
$ node --watch pico-jarvis.js
$ open localhost:5000
```

or open `localhost:5000`.

## Example Questions

- The CEO of Google is
- The largest planet is
- Mona Lisa was painted by
- The real name of Spiderman is
- What is the official language of Indonesia?
- Who wrote the Canon of Medicine?
- Who is Elon Musk?
- What is the native language of Mr. Spock?
- Name Indonesia #1 tourist destination
- Which US state starts with G?
- What is the atomic number of Magnesium?
- Is ramen typically eaten in Egypt?
- Who directed the Dark Knight movie?
