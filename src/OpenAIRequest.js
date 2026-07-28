export const chatCompletionsAPI = "chat_completions";
export const responsesAPI = "responses";
export const apiTypes = Object.freeze([chatCompletionsAPI, responsesAPI]);

export const openAICompletionURL = "https://api.openai.com/v1/chat/completions";
export const openAIResponsesURL = "https://api.openai.com/v1/responses";

export function normalizeAPIType(apiType) {
  return apiType || chatCompletionsAPI;
}

export function supportsResponsesSamplingControls(model, reasoningEffort) {
  const configuredName = model || "";
  const fineTunedBase = /^ft:([^:]+):/.exec(configuredName)?.[1];
  const modelName = fineTunedBase || configuredName;
  const reasoningModel =
    /^(?:gpt-5(?:[.-]|$)|o[1-9](?:-|$))/.test(modelName);
  if (!reasoningModel) {
    return /^(?:gpt-4(?:o|\.1|-|$)|gpt-3\.5(?:[.-]|$)|chat(?:gpt)?-)/.test(
      modelName
    );
  }

  const generation = /^gpt-5\.(\d+)(?:[.-]|$)/.exec(modelName);
  const supportsNoneSampling =
    generation &&
    Number(generation[1]) >= 1 &&
    !/-(?:chat|codex|pro)(?:-|$)/.test(modelName);
  return Boolean(
    supportsNoneSampling && reasoningEffort === "none"
  );
}

export function validateEndpointURL(url) {
  const value = typeof url === "string" ? url.trim() : "";
  if (!value) {
    throw new Error("API endpoint URL is required.");
  }

  let parsed;
  try {
    parsed = new URL(value);
  } catch (e) {
    throw new Error("API endpoint must be an absolute HTTP(S) URL.");
  }
  if (parsed.username || parsed.password) {
    throw new Error("API endpoint URLs cannot contain credentials.");
  }
  if (parsed.protocol === "https:") {
    return value;
  }
  const loopbackHosts = new Set([
    "localhost",
    "127.0.0.1",
    "[::1]",
    "0.0.0.0",
  ]);
  if (
    parsed.protocol === "http:" &&
    (
      loopbackHosts.has(parsed.hostname) ||
      parsed.hostname.endsWith(".localhost")
    )
  ) {
    return value;
  }
  throw new Error(
    "API endpoints must use HTTPS, except for loopback development URLs."
  );
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function withoutEmptySystemMessage(messages) {
  if (messages[0]?.role === "system" && !messages[0].content) {
    return messages.slice(1);
  }
  return messages;
}

export function isResponsesMetadataCarrier(message) {
  return Boolean(
    message?._responses_metadata_only === true &&
    message.role === "assistant" &&
    !message.content &&
    !message.function_call &&
    !message.tool_calls?.length &&
    Array.isArray(message._responses_items) &&
    message._responses_items.length > 0 &&
    message._responses_items.every((item) => item?.type === "reasoning")
  );
}

function prepareChatCompletionsPayload(payload) {
  const prepared = clone(payload);
  prepared.messages = withoutEmptySystemMessage(prepared.messages)
    .filter((message) => !isResponsesMetadataCarrier(message))
    .map((message) => {
      const {
        _responses_call_id,
        _responses_items,
        _responses_metadata_only,
        _responses_output_index,
        _responses_phase,
        _responses_refusal,
        ...chatMessage
      } = message;
      return chatMessage;
    });
  if (prepared.stream === true && prepared.stream_options === undefined) {
    prepared.stream_options = { include_usage: true };
  }
  // The playground has always requested exactly one choice.
  prepared.n = 1;
  return prepared;
}

function addPendingCall(pendingCalls, name, callId) {
  const calls = pendingCalls.get(name) || [];
  calls.push(callId);
  pendingCalls.set(name, calls);
}

function takePendingCall(pendingCalls, name) {
  const calls = pendingCalls.get(name);
  if (!calls?.length) {
    throw new Error(
      `Cannot translate function result "${name}": no preceding function call was found.`
    );
  }
  const callId = calls.shift();
  if (calls.length === 0) {
    pendingCalls.delete(name);
  }
  return callId;
}

function removePendingCallById(pendingCalls, callId) {
  for (const [name, calls] of pendingCalls) {
    const index = calls.indexOf(callId);
    if (index === -1) {
      continue;
    }
    calls.splice(index, 1);
    if (calls.length === 0) {
      pendingCalls.delete(name);
    }
    return true;
  }
  return false;
}

function translateMessages(messages) {
  const input = [];
  const pendingCalls = new Map();

  withoutEmptySystemMessage(messages).forEach((message, messageIndex) => {
    if (
      message._responses_items !== undefined &&
      !Array.isArray(message._responses_items)
    ) {
      throw new Error("Responses reasoning metadata must be an array.");
    }
    for (const item of message._responses_items || []) {
      if (item?.type !== "reasoning") {
        throw new Error(
          `Cannot replay Responses item type "${item?.type}".`
        );
      }
      input.push(item);
    }
    if (message._responses_metadata_only) {
      if (!isResponsesMetadataCarrier(message)) {
        throw new Error("Invalid Responses metadata-only message.");
      }
      return;
    }

    if (message.role === "function") {
      let callId;
      if (message._responses_call_id) {
        callId = message._responses_call_id;
        if (!removePendingCallById(pendingCalls, callId)) {
          throw new Error(
            `Cannot translate function result "${callId}": ` +
            "no preceding function call was found."
          );
        }
      } else {
        callId = takePendingCall(pendingCalls, message.name);
      }
      input.push({
        type: "function_call_output",
        call_id: callId,
        output: message.content ?? "",
      });
      return;
    }

    if (message.role === "tool") {
      if (!message.tool_call_id) {
        throw new Error("Cannot translate tool result: tool_call_id is required.");
      }
      if (!removePendingCallById(pendingCalls, message.tool_call_id)) {
        throw new Error(
          `Cannot translate tool result "${message.tool_call_id}": ` +
          "no preceding tool call was found."
        );
      }
      input.push({
        type: "function_call_output",
        call_id: message.tool_call_id,
        output: message.content ?? "",
      });
      return;
    }

    const legacyCall = message.function_call;
    const toolCalls = message.tool_calls || [];
    if (message.content || (!legacyCall && toolCalls.length === 0)) {
      input.push({
        role: message.role,
        content: message.content ?? "",
        ...(message.role === "assistant" && message._responses_phase
          ? { phase: message._responses_phase }
          : {}),
      });
    }

    if (legacyCall) {
      const callId =
        message._responses_call_id || `call_playground_${messageIndex}`;
      input.push({
        type: "function_call",
        call_id: callId,
        name: legacyCall.name,
        arguments: legacyCall.arguments || "",
      });
      addPendingCall(pendingCalls, legacyCall.name, callId);
    }

    toolCalls.forEach((toolCall, toolIndex) => {
      if (toolCall.type !== "function" || !toolCall.function) {
        throw new Error(`Cannot translate tool call type "${toolCall.type}".`);
      }
      const callId =
        toolCall.id || `call_playground_${messageIndex}_${toolIndex}`;
      input.push({
        type: "function_call",
        call_id: callId,
        name: toolCall.function.name,
        arguments: toolCall.function.arguments || "",
      });
      addPendingCall(pendingCalls, toolCall.function.name, callId);
    });
  });

  return input;
}

function translateFunctions(functions) {
  return functions.map((fn) => ({
    ...fn,
    type: "function",
    // Legacy Chat Completions functions were non-strict by default.
    strict: fn.strict ?? false,
  }));
}

function translateTools(tools) {
  return tools.map((tool) => {
    if (tool.type !== "function" || !tool.function) {
      throw new Error(
        `Responses tool type "${tool.type}" is not supported by this playground.`
      );
    }
    return {
      ...tool.function,
      type: "function",
      strict: tool.function.strict ?? false,
    };
  });
}

function translateFunctionChoice(functionCall) {
  if (typeof functionCall === "string") {
    return functionCall;
  }
  if (
    functionCall?.type === "function" &&
    functionCall.function?.name
  ) {
    return { type: "function", name: functionCall.function.name };
  }
  if (functionCall?.name) {
    return { type: "function", name: functionCall.name };
  }
  return functionCall ? clone(functionCall) : undefined;
}

function translateResponseFormat(responseFormat) {
  if (!responseFormat) {
    return undefined;
  }
  if (responseFormat.type === "json_schema") {
    return {
      type: "json_schema",
      ...responseFormat.json_schema,
    };
  }
  return clone(responseFormat);
}

function validateResponsesFormat(responseFormat, messages) {
  if (responseFormat?.type === "json_object") {
    const hasJSONInstruction = messages.some(
      (message) =>
        typeof message.content === "string" &&
        /\bjson\b/i.test(message.content)
    );
    if (!hasJSONInstruction) {
      throw new Error(
        'JSON response format requires an instruction containing the word "JSON".'
      );
    }
  }

  const jsonSchema = responseFormat?.json_schema;
  if (responseFormat?.type !== "json_schema" || !jsonSchema?.strict) {
    return;
  }
  validateStrictObjectSchemas(jsonSchema.schema, "$");
}

function validateStrictObjectSchemas(schema, path) {
  if (!schema || typeof schema !== "object") {
    return;
  }
  if (schema.type === "object" || schema.properties) {
    if (schema.additionalProperties !== false) {
      throw new Error(
        `Strict JSON Schema object at ${path} must set additionalProperties to false.`
      );
    }
    const propertyNames = Object.keys(schema.properties || {});
    const required = new Set(schema.required || []);
    const missing = propertyNames.filter((name) => !required.has(name));
    if (missing.length > 0) {
      throw new Error(
        `Strict JSON Schema object at ${path} must require every property ` +
        `(missing: ${missing.join(", ")}).`
      );
    }
    for (const [name, propertySchema] of Object.entries(
      schema.properties || {}
    )) {
      validateStrictObjectSchemas(propertySchema, `${path}.${name}`);
    }
  }
  if (schema.items) {
    validateStrictObjectSchemas(schema.items, `${path}[]`);
  }
  for (const keyword of ["anyOf", "oneOf", "allOf"]) {
    (schema[keyword] || []).forEach((nested, index) => {
      validateStrictObjectSchemas(nested, `${path}.${keyword}[${index}]`);
    });
  }
  for (const keyword of ["$defs", "definitions"]) {
    for (const [name, definition] of Object.entries(schema[keyword] || {})) {
      validateStrictObjectSchemas(
        definition,
        `${path}.${keyword}.${name}`
      );
    }
  }
}

// Fields with the same meaning and shape on both generation APIs.
const sharedResponsesFields = [
  "include",
  "metadata",
  "model",
  "prompt_cache_key",
  "prompt_cache_options",
  "prompt_cache_retention",
  "safety_identifier",
  "service_tier",
  "store",
  "stream",
  "top_logprobs",
  "truncation",
  "user",
];

/**
 * Translates the playground's durable Chat Completions-shaped payload at the
 * network boundary. Keeping one canonical state shape is what lets old links,
 * clipboard exports, and the existing editor remain interoperable.
 */
export function translateToResponsesPayload(payload) {
  const source = clone(payload);
  const translated = {};

  if (source.background) {
    throw new Error(
      "Background Responses are not supported by this playground."
    );
  }

  for (const field of sharedResponsesFields) {
    if (source[field] !== undefined) {
      translated[field] = source[field];
    }
  }
  const reasoningEffort =
    source.reasoning_effort ?? source.reasoning?.effort;
  if (
    supportsResponsesSamplingControls(source.model, reasoningEffort)
  ) {
    if (source.temperature !== undefined) {
      translated.temperature = source.temperature;
    }
    if (source.top_p !== undefined) {
      translated.top_p = source.top_p;
    }
  }

  translated.input = translateMessages(source.messages);
  translated.store = source.store ?? false;
  if (translated.store === false) {
    const include = translated.include || [];
    if (!Array.isArray(include)) {
      throw new Error("Responses include must be an array.");
    }
    translated.include = [
      ...new Set([...include, "reasoning.encrypted_content"]),
    ];
  }

  const maxOutputTokens =
    source.max_completion_tokens ?? source.max_tokens;
  if (maxOutputTokens !== undefined) {
    translated.max_output_tokens = maxOutputTokens;
  }

  if (source.reasoning || source.reasoning_effort !== undefined) {
    translated.reasoning = {
      ...(source.reasoning || {}),
      ...(source.reasoning_effort !== undefined
        ? { effort: source.reasoning_effort }
        : {}),
    };
  }

  validateResponsesFormat(source.response_format, source.messages);
  const format = translateResponseFormat(source.response_format);
  if (format || source.verbosity !== undefined) {
    translated.text = {
      ...(format ? { format } : {}),
      ...(source.verbosity !== undefined
        ? { verbosity: source.verbosity }
        : {}),
    };
  }

  if (source.functions !== undefined && source.tools !== undefined) {
    throw new Error(
      "Responses payload cannot contain both legacy functions and tools."
    );
  }
  if (source.functions) {
    translated.tools = translateFunctions(source.functions);
  } else if (source.tools) {
    translated.tools = translateTools(source.tools);
  }
  if (translated.tools?.length > 0) {
    // The transcript editor has a single pending-call workflow. Serializing
    // calls prevents the model from producing calls the user cannot complete.
    translated.parallel_tool_calls = false;
  }

  const toolChoice =
    source.function_call !== undefined
      ? translateFunctionChoice(source.function_call)
      : translateFunctionChoice(source.tool_choice);
  if (toolChoice !== undefined) {
    translated.tool_choice = toolChoice;
  }

  return translated;
}

function errorMessage(error) {
  if (!error) {
    return undefined;
  }
  if (typeof error === "string") {
    return error;
  }
  return error.message || error.code || error.type;
}

async function getResponse({ url, apiKey, payload, signal }) {
  url = validateEndpointURL(url);
  const response = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: "Bearer " + apiKey,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
    signal,
  });

  if (!response.ok) {
    let jsonError;
    try {
      jsonError = await response.json();
    } catch (e) {
      // Some compatible endpoints return an empty or non-JSON error body.
    }
    const message = errorMessage(jsonError?.error) || errorMessage(jsonError);
    if (message) {
      throw `APIError: ${message}`;
    }
    throw `HTTPError: ${response.status}`;
  }
  return response;
}

async function readEventStream(response, onData) {
  const reader = response.body.getReader();
  const decoder = new TextDecoder("utf-8");
  let buffer = "";

  while (true) {
    const { value, done } = await reader.read();
    buffer += decoder.decode(value || new Uint8Array(), { stream: !done });

    while (buffer.indexOf("\n") !== -1) {
      const newlineIndex = buffer.indexOf("\n");
      let line = buffer.slice(0, newlineIndex).trim();
      buffer = buffer.slice(newlineIndex + 1);
      if (!line.startsWith("data:")) {
        continue;
      }
      line = line.slice("data:".length).trim();
      if (line === "[DONE]") {
        return;
      }
      if (line && (await onData(JSON.parse(line)))) {
        return;
      }
    }

    if (done) {
      break;
    }
  }

  const finalLine = buffer.trim();
  if (finalLine.startsWith("data:")) {
    const data = finalLine.slice("data:".length).trim();
    if (data === "[DONE]") {
      return;
    }
    if (data && (await onData(JSON.parse(data)))) {
      return;
    }
  }

  throw "APIError: stream ended unexpectedly";
}

function throwResponseError(response) {
  const message =
    errorMessage(response?.error) || errorMessage(response);
  if (message) {
    throw `APIError: ${message}`;
  }
  throw `APIError: response ${response?.status || "failed"}`;
}

function responseText(item) {
  return (item.content || [])
    .map((part) => {
      if (part.type === "output_text") {
        return part.text || "";
      }
      if (part.type === "refusal") {
        return part.refusal || "";
      }
      return "";
    })
    .join("");
}

function hasResponseRefusal(item) {
  return item.content?.some((content) => content.type === "refusal") === true;
}

function responseMetadata(responseItems, outputIndex) {
  return {
    ...(responseItems.length > 0
      ? { _responses_items: responseItems }
      : {}),
    ...(outputIndex !== undefined
      ? { _responses_output_index: outputIndex }
      : {}),
  };
}

function responseMessageMetadata(item, responseItems, outputIndex) {
  return {
    ...responseMetadata(responseItems, outputIndex),
    ...(item.phase ? { _responses_phase: item.phase } : {}),
    ...(hasResponseRefusal(item)
      ? { _responses_refusal: true }
      : {}),
  };
}

async function emitResponseItem(
  item,
  dataCallback,
  responseItems = [],
  outputIndex
) {
  if (item.type === "message") {
    await dataCallback({
      message: {
        role: item.role || "assistant",
        content: responseText(item),
        ...responseMessageMetadata(item, responseItems, outputIndex),
      },
    });
    return true;
  } else if (item.type === "function_call") {
    await dataCallback({
      message: {
        role: "assistant",
        content: "",
        function_call: {
          name: item.name,
          arguments: item.arguments || "",
        },
        ...(item.call_id
          ? { _responses_call_id: item.call_id }
          : {}),
        ...responseMetadata(responseItems, outputIndex),
      },
    });
    return true;
  }
  return false;
}

async function emitCompletedResponse(response, dataCallback) {
  if (response.status === "failed" || response.error) {
    throwResponseError(response);
  }

  let pendingResponseItems = [];
  for (const item of response.output || []) {
    if (item.type === "reasoning") {
      pendingResponseItems.push(item);
      continue;
    }
    const emitted = await emitResponseItem(
      item,
      dataCallback,
      pendingResponseItems
    );
    if (emitted) {
      pendingResponseItems = [];
    }
  }
  if (pendingResponseItems.length > 0) {
    await dataCallback({
      message: {
        role: "assistant",
        content: "",
        _responses_items: pendingResponseItems,
        _responses_metadata_only: true,
      },
    });
  }
  if (response.usage) {
    await dataCallback({ usage: response.usage });
  }
  if (response.status === "incomplete") {
    await dataCallback({
      finish_reason:
        response.incomplete_details?.reason || "incomplete",
    });
  }
  await dataCallback();
}

function createChatCompletionsRequest({
  apiKey,
  payload,
  dataCallback,
  completionURL,
  abortController,
}) {
  const prepared = prepareChatCompletionsPayload(payload);

  if (prepared.stream !== true) {
    return {
      send: async () => {
        const response = await getResponse({
          url: completionURL,
          apiKey,
          payload: prepared,
          signal: abortController.signal,
        });
        const data = await response.json();
        if (data.error) {
          throw `${data.error.type}: ${data.error.message}`;
        }
        const choice = data.choices && data.choices[0];
        if (choice) {
          await dataCallback({ ...choice, usage: data.usage });
        } else if (data.usage) {
          await dataCallback({ usage: data.usage });
        }
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
        payload: prepared,
        signal: abortController.signal,
      });
      await readEventStream(response, async (data) => {
        if (data.error) {
          throw `${data.error.type}: ${data.error.message}`;
        }
        const choice = data.choices && data.choices[0];
        if (choice) {
          await dataCallback({ ...choice, usage: data.usage });
        } else if (data.usage) {
          await dataCallback({ usage: data.usage });
        }
        return false;
      });
      await dataCallback();
    },
    cancel: () => abortController.abort(),
  };
}

function createResponsesRequest({
  apiKey,
  payload,
  dataCallback,
  responsesURL,
  abortController,
}) {
  const prepared = translateToResponsesPayload(payload);

  if (prepared.stream !== true) {
    return {
      send: async () => {
        const response = await getResponse({
          url: responsesURL,
          apiKey,
          payload: prepared,
          signal: abortController.signal,
        });
        await emitCompletedResponse(await response.json(), dataCallback);
      },
      cancel: () => abortController.abort(),
    };
  }

  return {
    send: async () => {
      const response = await getResponse({
        url: responsesURL,
        apiKey,
        payload: prepared,
        signal: abortController.signal,
      });
      const startedItems = new Set();
      const textDeltas = new Set();
      const argumentDeltas = new Set();
      let pendingResponseItems = [];

      const takeResponseMetadata = () => {
        const metadata = responseMetadata(pendingResponseItems);
        pendingResponseItems = [];
        return metadata;
      };

      try {
        await readEventStream(response, async (event) => {
        if (event.type === "error") {
          throwResponseError(event);
        }
        if (event.type === "response.failed") {
          throwResponseError(event.response);
        }
        if (event.type === "response.output_item.added") {
          startedItems.add(event.output_index);
          if (event.item.type === "message") {
            await dataCallback({
              delta: {
                role: event.item.role || "assistant",
                content: "",
                ...takeResponseMetadata(),
                ...(event.item.phase
                  ? { _responses_phase: event.item.phase }
                  : {}),
                ...(hasResponseRefusal(event.item)
                  ? { _responses_refusal: true }
                  : {}),
                _responses_output_index: event.output_index,
              },
            });
          } else if (event.item.type === "function_call") {
            await dataCallback({
              delta: {
                role: "assistant",
                function_call: {
                  name: event.item.name,
                  arguments: event.item.arguments || "",
                },
                ...(event.item.call_id
                  ? { _responses_call_id: event.item.call_id }
                  : {}),
                ...takeResponseMetadata(),
                _responses_output_index: event.output_index,
              },
            });
          }
        } else if (
          event.type === "response.output_text.delta" ||
          event.type === "response.refusal.delta"
        ) {
          if (!startedItems.has(event.output_index)) {
            startedItems.add(event.output_index);
            await dataCallback({
              delta: {
                role: "assistant",
                content: "",
                ...takeResponseMetadata(),
                _responses_output_index: event.output_index,
              },
            });
          }
          textDeltas.add(event.output_index);
          await dataCallback({
            delta: {
              content: event.delta || "",
              ...(event.type === "response.refusal.delta"
                ? { _responses_refusal: true }
                : {}),
              _responses_output_index: event.output_index,
            },
          });
        } else if (
          event.type === "response.function_call_arguments.delta"
        ) {
          argumentDeltas.add(event.output_index);
          await dataCallback({
            delta: {
              function_call: { arguments: event.delta || "" },
              _responses_output_index: event.output_index,
            },
          });
        } else if (event.type === "response.output_item.done") {
          if (event.item.type === "reasoning") {
            pendingResponseItems.push(event.item);
          } else if (!startedItems.has(event.output_index)) {
            startedItems.add(event.output_index);
            const emitted = await emitResponseItem(
              event.item,
              dataCallback,
              pendingResponseItems,
              event.output_index
            );
            if (emitted) {
              pendingResponseItems = [];
            }
          } else if (
            event.item.type === "message" &&
            !textDeltas.has(event.output_index)
          ) {
            await dataCallback({
              delta: {
                content: responseText(event.item),
                ...(hasResponseRefusal(event.item)
                  ? { _responses_refusal: true }
                  : {}),
                _responses_output_index: event.output_index,
              },
            });
          } else if (
            event.item.type === "function_call" &&
            !argumentDeltas.has(event.output_index) &&
            event.item.arguments
          ) {
            await dataCallback({
              delta: {
                function_call: { arguments: event.item.arguments },
                _responses_output_index: event.output_index,
              },
            });
          }
        } else if (
          event.type === "response.completed" ||
          event.type === "response.incomplete"
        ) {
          if (pendingResponseItems.length > 0) {
            await dataCallback({
              delta: {
                role: "assistant",
                content: "",
                _responses_items: pendingResponseItems,
                _responses_metadata_only: true,
              },
            });
            pendingResponseItems = [];
          }
          if (event.response?.usage) {
            await dataCallback({ usage: event.response.usage });
          }
          if (
            event.type === "response.incomplete" ||
            event.response?.status === "incomplete"
          ) {
            await dataCallback({
              finish_reason:
                event.response?.incomplete_details?.reason || "incomplete",
            });
          }
          await dataCallback();
          return true;
        }
        return false;
        });
      } finally {
        if (pendingResponseItems.length > 0) {
          await dataCallback({
            delta: {
              role: "assistant",
              content: "",
              _responses_items: pendingResponseItems,
              _responses_metadata_only: true,
            },
          });
        }
      }
    },
    cancel: () => abortController.abort(),
  };
}

export function createRequest({
  apiKey,
  payload,
  dataCallback,
  apiType,
  completionURL = openAICompletionURL,
  responsesURL = openAIResponsesURL,
}) {
  const resolvedAPIType = normalizeAPIType(apiType);
  if (!apiTypes.includes(resolvedAPIType)) {
    throw new Error(`Unknown API type "${resolvedAPIType}".`);
  }

  const abortController = new AbortController();
  if (resolvedAPIType === responsesAPI) {
    return createResponsesRequest({
      apiKey,
      payload,
      dataCallback,
      responsesURL,
      abortController,
    });
  }
  return createChatCompletionsRequest({
    apiKey,
    payload,
    dataCallback,
    completionURL,
    abortController,
  });
}
