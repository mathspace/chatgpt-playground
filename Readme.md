# ChatGPT Playground

A simple UI to OpenAI's ChatGPT API. Main features include:

- Variables: provide a way to create template prompts.
- State and link sharing: import/export the full state of the
  converation as JSON. Also allows for storing state in a link that once
  opened, restores the entire state.
- API transport: switch between Chat Completions and Responses while keeping
  the same editable conversation state. Links created before this option
  existed continue to use Chat Completions.

When a Responses reasoning model is active, sampling controls are omitted
unless reasoning effort is explicitly `none`; those models reject
`temperature` and `top_p` while reasoning is enabled.

API keys and custom endpoint URLs are stored only in the current browser.
Shared links include the selected API transport, but never those credentials or
endpoint URLs.

The full feature-by-feature Responses regression contract is recorded in
[RESPONSES_API_TEST_MATRIX.md](RESPONSES_API_TEST_MATRIX.md).

## Development

Install dependencies and run the development server:

```
npm i
npm run dev
```

ESBuild will automatically rebuild when any source files change.

For production build, run `npm run build`. All the files will be in the
`out/` directory and can be served using any web server.
