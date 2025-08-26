import { encode, decode } from "gpt-tokenizer/esm/encoding/cl100k_base";

export const openAICompletionURL = "https://api.openai.com/v1/chat/completions";

async function getResponse({ url, apiKey, payload, signal }) {
  const response = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: "Bearer " + apiKey,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ ...payload, n: 1 }),
    signal: signal,
  });

  if (!response.ok) {
    var jsonErr;
    try {
      jsonErr = await response.json();
    } catch (e) {}
    if (jsonErr) {
      throw "APIError: " + (jsonErr.error.message || jsonErr.error.code);
    }
    throw `HTTPError: ${response.status}`;
  }
  return response;
}

export function createRequest({
  apiKey,
  payload,
  dataCallback,
  completionURL = openAICompletionURL,
}) {
  payload = JSON.parse(JSON.stringify(payload));
  // Remove system message if empty.
  if (payload.messages[0].role === "system" && !payload.messages[0].content) {
    payload.messages.shift();
  }
  const abortController = new AbortController();

  if (payload.stream !== true) {
    return {
      send: async () => {
        const response = await getResponse({
          url: completionURL,
          apiKey,
          payload,
          signal: abortController.signal,
        });
        const data = await response.json();
        if (data.error) {
          throw `${data.error.type}: ${data.error.message}`;
        }
        await dataCallback(data.choices[0]);
        await dataCallback();
      },
      cancel: () => abortController.abort(),
    };
  }

  return {
    send: async () => {
      const response = await getResponse({
        url: completionURL,
        apiKey,
        payload,
        signal: abortController.signal,
      });
      const reader = response.body.getReader();
      const decoder = new TextDecoder("utf-8");

      var buf = "";
      while (true) {
        var { value, done } = await reader.read();
        if (done) {
          throw "APIError: stream ended unexpectedly";
        }
        buf += decoder.decode(value);
        while (buf.indexOf("\n") !== -1) {
          const nlIdx = buf.indexOf("\n");
          var line = buf.slice(0, nlIdx).trim();
          buf = buf.slice(nlIdx + 1);
          if (!line.startsWith("data:")) {
            continue;
          }
          line = line.slice("data:".length).trim();
          if (line === "[DONE]") {
            await dataCallback();
            return;
          }
          const data = JSON.parse(line);
          if (data.error) {
            throw `${data.error.type}: ${data.error.message}`;
          }
          await dataCallback(data.choices[0]);
        }
      }
    },
    cancel: () => abortController.abort(),
  };
}

export const models = [
  {
    id: "gpt-5",
    alias: true,
  },
  {
    id: "gpt-5-mini",
    alias: true,
  },
  {
    id: "gpt-5-nano",
    alias: true,
  },
  {
    id: "o3",
    alias: true,
  },
  {
    id: "o4-mini",
    alias: true,
  },
  {
    id: "gpt-4.1",
    alias: true,
  },
  {
    id: "gpt-4.1-mini",
    alias: true,
  },
  {
    id: "gpt-4.1-nano",
    alias: true,
  },
  {
    id: "gpt-4o",
    alias: true,
  },
  {
    id: "chatgpt-4o-latest",
    alias: true,
  },
  {
    id: "gpt-4o-mini",
    alias: true,
  },
  {
    id: "o1",
    alias: true,
  },
  {
    id: "o1-preview",
    alias: true,
  },
  {
    id: "o1-mini",
    alias: true,
  },
  {
    id: "o3-mini",
    alias: true,
  },
  {
    id: "gpt-4-turbo",
    alias: true,
  },
  {
    id: "gpt-4-turbo-preview",
    alias: true,
  },
  {
    id: "gpt-4-vision-preview",
    alias: true,
  },
  {
    id: "gpt-4",
    alias: true,
  },
  {
    id: "gpt-4-32k",
    alias: true,
  },
  {
    id: "gpt-3.5-turbo",
    alias: true,
  },

  {
    id: "gpt-5-2025-08-07",
  },
  {
    id: "gpt-5-mini-2025-08-07",
  },
  {
    id: "gpt-5-nano-2025-08-07",
  },
  {
    id: "o3-2025-04-16",
  },
  {
    id: "o4-mini-2025-04-16",
  },
  {
    id: "gpt-4.1-2025-04-14",
  },
  {
    id: "gpt-4.1-mini-2025-04-14",
  },
  {
    id: "gpt-4.1-nano-2025-04-14",
  },
  {
    id: "gpt-4o-mini-2024-07-18",
  },
  {
    id: "gpt-4o-2024-11-20",
  },
  {
    id: "gpt-4o-2024-08-06",
  },
  {
    id: "gpt-4o-2024-05-13",
  },
  {
    id: "o1-2024-12-17",
  },
  {
    id: "o1-preview-2024-09-12",
  },
  {
    id: "o1-mini-2024-09-12",
  },
  {
    id: "o3-mini-2025-01-31",
  },
  {
    id: "gpt-4-turbo-2024-04-09",
  },
  {
    id: "gpt-4-0125-preview",
  },
  {
    id: "gpt-4-1106-preview",
  },
  {
    id: "gpt-4-1106-vision-preview",
  },

  {
    id: "gpt-4-0613",
  },
  {
    id: "gpt-4-32k-0613",
  },
  {
    id: "gpt-4-0314",
  },

  {
    id: "gpt-3.5-turbo-0125",
  },
  {
    id: "gpt-3.5-turbo-1106",
  },
  {
    id: "gpt-3.5-turbo-0301",
  },

  // Fine tuned and other base models.

  {
    prefix: "ft:gpt-3.5-turbo-0613:",
  },
];

modelNamesSortedByLength = models
  .map((m) => m.id)
  .sort((a, b) => b.length - a.length);

export function createValidator() {
  return (p) => {
    // There must be one and only one system message and it must be the first
    // message.
    if (p.messages.length === 0 || p.messages[0].role !== "system") {
      throw "The first message must be a system message.";
    }
    if (p.messages.slice(1).find((m) => m.role === "system")) {
      throw "There can be only one system message.";
    }
    // Duplicate function names are disallowed.
    const nameSet = new Set();
    for (const fn of p.functions || []) {
      if (nameSet.has(fn.name)) {
        throw "Duplicate function names are not allowed.";
      } else {
        nameSet.add(fn.name);
      }
    }
    // Logit bias keys must be non-negative integers.
    for (const key of Object.keys(p.logit_bias || {})) {
      if (!/^\d+$/.test(key)) {
        throw "Logit bias keys must be non-negative integers.";
      }
    }
  };
}

// This is an estimate arrived at by running a whole bunch of text through
// tiktoken tokenizer.
const charToTokenRatio = 0.34;

export function ModelDropdown({ model, setModel }) {
  const baseModel = !!models.find((m) => m.id === model);
  return (
    <>
      <select
        onChange={(e) => setModel(e.target.value)}
        value={baseModel ? model : ""}
      >
        {models
          .filter((m) => m.id && m.alias)
          .map(({ id }, i) => (
            <option key={id} value={id}>
              {id}
            </option>
          ))}
        <option disabled>Snapshots</option>
        {models
          .filter((m) => m.id && !m.alias)
          .map(({ id }, i) => (
            <option key={id} value={id}>
              {id}
            </option>
          ))}
        <option disabled>Others</option>
        <option value="">Custom</option>
      </select>
      {!baseModel && (
        <input
          type="text"
          placeholder="Custom model name"
          style={{ marginTop: "2px" }}
          onChange={(e) => setModel(e.target.value)}
          value={model}
        />
      )}
    </>
  );
}

export function ReasoningEffortDropdown({ effort, setEffort }) {
  return (
    <>
      <select
        onChange={(e) => setEffort(e.target.value || undefined)}
        value={effort ? effort : ""}
      >
        <option value="">Default (Medium)</option>
        {["Low", "Medium", "High"].map((e) => (
          <option key={e.toLowerCase()} value={e.toLowerCase()}>
            {e}
          </option>
        ))}
        {effort && { low: 1, medium: 1, high: 1 }[effort] === undefined && (
          <>
            <option disabled>Custom</option>
            <option value={effort}>{effort}</option>
          </>
        )}
      </select>
    </>
  );
}

// This is necessary because the tokenizer is stateful to handle multi-GPT token
// unicode characters.
function flushTokenizerState() {
  decode(encode("1 2 3 4"));
}

export function TokensToText(t) {
  flushTokenizerState();
  return decode(t);
}

export function TextToTokens(t) {
  flushTokenizerState();
  return encode(t);
}
