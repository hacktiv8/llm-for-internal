# LLM For Internal

## Deployment LLM via ollama

After the server ready, install ollama whit the following command:

```shell
server# curl -fsSL https://ollama.com/install.sh | sh

# Stop the ollama service and run the following command so we can access it from anywhere:
server# service ollama stop
server# nohup OLLAMA_HOST=0.0.0.0:11434 ollama serve

# Open another terminal session and download desired model:
server# OLLAMA_HOST=0.0.0.0:11434 ollama pull orca-mini
```

## Access online ollama

Now we can access ollama from anywhere with ip address and port 11434.


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
