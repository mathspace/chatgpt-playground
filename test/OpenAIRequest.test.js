import assert from "node:assert/strict";
import { afterEach, describe, test } from "node:test";
import {
  chatCompletionsAPI,
  createRequest,
  isResponsesMetadataCarrier,
  normalizeAPIType,
  responsesAPI,
  supportsResponsesSamplingControls,
  translateToResponsesPayload,
  validateEndpointURL,
} from "../src/OpenAIRequest.js";
import { applyResponseDelta } from "../src/ResponseState.js";

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function streamResponse(events) {
  const body = events
    .map((event) => `data: ${JSON.stringify(event)}\n\n`)
    .join("");
  return new Response(body, {
    status: 200,
    headers: { "Content-Type": "text/event-stream" },
  });
}

describe("API type compatibility", () => {
  test("missing and blank API types retain the legacy Chat Completions default", () => {
    assert.equal(normalizeAPIType(undefined), chatCompletionsAPI);
    assert.equal(normalizeAPIType(null), chatCompletionsAPI);
    assert.equal(normalizeAPIType(""), chatCompletionsAPI);
    assert.equal(normalizeAPIType(responsesAPI), responsesAPI);
  });

  test("accepts secure and loopback endpoints but rejects key-leaking URLs", () => {
    assert.equal(
      validateEndpointURL(" https://proxy.example.test/v1/responses "),
      "https://proxy.example.test/v1/responses"
    );
    assert.equal(
      validateEndpointURL("http://localhost:8080/v1/responses"),
      "http://localhost:8080/v1/responses"
    );
    assert.throws(
      () => validateEndpointURL("/v1/responses"),
      /absolute HTTP\(S\) URL/
    );
    assert.throws(
      () => validateEndpointURL("http://proxy.example.test/v1/responses"),
      /must use HTTPS/
    );
    assert.throws(
      () => validateEndpointURL("https://user:secret@proxy.example.test"),
      /cannot contain credentials/
    );
  });

  test("recognizes only valid trailing Responses metadata carriers", () => {
    const carrier = {
      role: "assistant",
      content: "",
      _responses_items: [{ type: "reasoning", id: "rs_123" }],
      _responses_metadata_only: true,
    };
    assert.equal(isResponsesMetadataCarrier(carrier), true);
    assert.equal(
      isResponsesMetadataCarrier({ ...carrier, content: "visible" }),
      false
    );
    assert.equal(
      isResponsesMetadataCarrier({ ...carrier, role: "user" }),
      false
    );
    assert.equal(
      isResponsesMetadataCarrier({
        ...carrier,
        _responses_items: [{ type: "message" }],
      }),
      false
    );
    assert.equal(
      isResponsesMetadataCarrier({
        ...carrier,
        _responses_items: [null],
      }),
      false
    );
  });

  test("uses sampling controls only when the Responses model supports them", () => {
    assert.equal(
      supportsResponsesSamplingControls("gpt-5.6-luna", "max"),
      false
    );
    assert.equal(
      supportsResponsesSamplingControls("gpt-5.6-luna", undefined),
      false
    );
    assert.equal(
      supportsResponsesSamplingControls("gpt-5.6-luna", "none"),
      true
    );
    assert.equal(
      supportsResponsesSamplingControls("gpt-5.1", "none"),
      true
    );
    assert.equal(
      supportsResponsesSamplingControls("gpt-5", "none"),
      false
    );
    assert.equal(
      supportsResponsesSamplingControls("o3", "none"),
      false
    );
    assert.equal(
      supportsResponsesSamplingControls("gpt-4o", undefined),
      true
    );
    assert.equal(
      supportsResponsesSamplingControls("ft:gpt-5:org:job", "none"),
      false
    );
    assert.equal(
      supportsResponsesSamplingControls("ft:gpt-4o:org:job", undefined),
      true
    );
    assert.equal(
      supportsResponsesSamplingControls("custom-o3-deployment", undefined),
      false
    );
    assert.deepEqual(
      translateToResponsesPayload({
        model: "gpt-4o",
        messages: [{ role: "system", content: "" }],
        temperature: 0.2,
        top_p: 0.8,
      }),
      {
        model: "gpt-4o",
        input: [],
        store: false,
        include: ["reasoning.encrypted_content"],
        temperature: 0.2,
        top_p: 0.8,
      }
    );
  });
});

describe("Responses payload translation", () => {
  test("maps supported settings without mutating durable Chat state", () => {
    const payload = {
      model: "gpt-5.6-luna",
      messages: [
        { role: "system", content: "Be precise." },
        { role: "user", content: "Calculate it." },
        {
          role: "assistant",
          content: "",
          function_call: {
            name: "calculate",
            arguments: "{\"expression\":\"6*7\"}",
          },
        },
        { role: "function", name: "calculate", content: "42" },
      ],
      functions: [
        {
          name: "calculate",
          description: "Evaluate an expression.",
          parameters: {
            type: "object",
            properties: { expression: { type: "string" } },
          },
        },
      ],
      function_call: { name: "calculate" },
      response_format: {
        type: "json_schema",
        json_schema: {
          name: "answer",
          strict: true,
          schema: {
            type: "object",
            properties: { answer: { type: "number" } },
            required: ["answer"],
            additionalProperties: false,
          },
        },
      },
      reasoning_effort: "max",
      max_tokens: 2000,
      temperature: 0.4,
      top_p: 0.9,
      stream: true,
      seed: 7,
      stop: ["END"],
      presence_penalty: 1,
      frequency_penalty: 1,
      logit_bias: { 42: 100 },
    };
    const before = structuredClone(payload);

    assert.deepEqual(translateToResponsesPayload(payload), {
      include: ["reasoning.encrypted_content"],
      model: "gpt-5.6-luna",
      store: false,
      stream: true,
      input: [
        { role: "system", content: "Be precise." },
        { role: "user", content: "Calculate it." },
        {
          type: "function_call",
          call_id: "call_playground_2",
          name: "calculate",
          arguments: "{\"expression\":\"6*7\"}",
        },
        {
          type: "function_call_output",
          call_id: "call_playground_2",
          output: "42",
        },
      ],
      max_output_tokens: 2000,
      reasoning: { effort: "max" },
      text: {
        format: {
          type: "json_schema",
          name: "answer",
          strict: true,
          schema: {
            type: "object",
            properties: { answer: { type: "number" } },
            required: ["answer"],
            additionalProperties: false,
          },
        },
      },
      tools: [
        {
          type: "function",
          name: "calculate",
          description: "Evaluate an expression.",
          parameters: {
            type: "object",
            properties: { expression: { type: "string" } },
          },
          strict: false,
        },
      ],
      parallel_tool_calls: false,
      tool_choice: { type: "function", name: "calculate" },
    });
    assert.deepEqual(payload, before);
  });

  test("removes the empty system placeholder", () => {
    assert.deepEqual(
      translateToResponsesPayload({
        model: "gpt-5.6",
        messages: [
          { role: "system", content: "" },
          { role: "user", content: "Hello" },
        ],
      }).input,
      [{ role: "user", content: "Hello" }]
    );
  });

  test("allows an explicit opt-in to stored Responses", () => {
    const translated = translateToResponsesPayload({
      model: "gpt-5.6",
      messages: [{ role: "system", content: "" }],
      store: true,
    });

    assert.equal(translated.store, true);
    assert.equal(translated.include, undefined);
  });

  test("replays opaque reasoning items and the original function call ID", () => {
    const reasoning = {
      type: "reasoning",
      id: "rs_123",
      encrypted_content: "opaque",
      summary: [],
    };

    assert.deepEqual(
      translateToResponsesPayload({
        model: "gpt-5.6",
        messages: [
          { role: "system", content: "" },
          { role: "user", content: "Calculate" },
          {
            role: "assistant",
            content: "",
            function_call: { name: "calculate", arguments: "{}" },
            _responses_call_id: "call_123",
            _responses_items: [reasoning],
          },
          { role: "function", name: "calculate", content: "42" },
        ],
      }).input,
      [
        { role: "user", content: "Calculate" },
        reasoning,
        {
          type: "function_call",
          call_id: "call_123",
          name: "calculate",
          arguments: "{}",
        },
        {
          type: "function_call_output",
          call_id: "call_123",
          output: "42",
        },
      ]
    );
  });

  test("fails before fetch when a legacy function result cannot be correlated", () => {
    assert.throws(
      () =>
        translateToResponsesPayload({
          model: "gpt-5.6",
          messages: [
            { role: "system", content: "" },
            { role: "function", name: "missing", content: "result" },
          ],
        }),
      /no preceding function call/
    );
  });

  test("correlates same-name function results by Responses call ID", () => {
    const input = translateToResponsesPayload({
      model: "gpt-5.6",
      messages: [
        { role: "system", content: "" },
        { role: "user", content: "Look up both." },
        {
          role: "assistant",
          content: "",
          function_call: { name: "lookup", arguments: "{\"id\":1}" },
          _responses_call_id: "call_A",
        },
        {
          role: "assistant",
          content: "",
          function_call: { name: "lookup", arguments: "{\"id\":2}" },
          _responses_call_id: "call_B",
        },
        {
          role: "function",
          name: "lookup",
          content: "result 2",
          _responses_call_id: "call_B",
        },
      ],
    }).input;

    assert.deepEqual(input.at(-1), {
      type: "function_call_output",
      call_id: "call_B",
      output: "result 2",
    });
  });

  test("translates modern Chat tool choice and rejects background jobs", () => {
    const translated = translateToResponsesPayload({
      model: "gpt-5.6",
      messages: [{ role: "system", content: "" }],
      tools: [{
        type: "function",
        function: {
          name: "lookup",
          parameters: { type: "object", properties: {} },
        },
      }],
      tool_choice: {
        type: "function",
        function: { name: "lookup" },
      },
      parallel_tool_calls: true,
    });

    assert.deepEqual(translated.tool_choice, {
      type: "function",
      name: "lookup",
    });
    assert.equal(translated.parallel_tool_calls, false);
    assert.throws(
      () =>
        translateToResponsesPayload({
          model: "gpt-5.6",
          messages: [{ role: "system", content: "" }],
          background: true,
        }),
      /Background Responses are not supported/
    );
    assert.throws(
      () =>
        translateToResponsesPayload({
          model: "gpt-5.6",
          messages: [{ role: "system", content: "" }],
          tools: [{ type: "web_search" }],
        }),
      /tool type "web_search" is not supported/
    );
    assert.throws(
      () =>
        translateToResponsesPayload({
          model: "gpt-5.6",
          messages: [{ role: "system", content: "" }],
          functions: [],
          tools: [{ type: "web_search" }],
        }),
      /cannot contain both legacy functions and tools/
    );
  });

  test("preflights Responses JSON mode and strict schema requirements", () => {
    assert.throws(
      () =>
        translateToResponsesPayload({
          model: "gpt-4o",
          messages: [{ role: "user", content: "Return an object." }],
          response_format: { type: "json_object" },
        }),
      /word "JSON"/
    );
    assert.deepEqual(
      translateToResponsesPayload({
        model: "gpt-4o",
        messages: [{ role: "user", content: "Return JSON." }],
        response_format: { type: "json_object" },
      }).text,
      { format: { type: "json_object" } }
    );
    assert.throws(
      () =>
        translateToResponsesPayload({
          model: "gpt-4o",
          messages: [{ role: "user", content: "Return JSON." }],
          response_format: {
            type: "json_schema",
            json_schema: {
              name: "invalid",
              strict: true,
              schema: {
                type: "object",
                properties: { value: { type: "string" } },
                required: [],
              },
            },
          },
        }),
      /additionalProperties/
    );
    assert.throws(
      () =>
        translateToResponsesPayload({
          model: "gpt-4o",
          messages: [{ role: "user", content: "Return JSON." }],
          response_format: {
            type: "json_schema",
            json_schema: {
              name: "invalid",
              strict: true,
              schema: {
                type: "object",
                properties: { value: { type: "string" } },
                required: [],
                additionalProperties: false,
              },
            },
          },
        }),
      /missing: value/
    );
    assert.throws(
      () =>
        translateToResponsesPayload({
          model: "gpt-4o",
          messages: [{ role: "user", content: "Return JSON." }],
          response_format: {
            type: "json_schema",
            json_schema: {
              name: "invalid_definition",
              strict: true,
              schema: {
                type: "object",
                properties: {
                  value: { $ref: "#/$defs/value" },
                },
                required: ["value"],
                additionalProperties: false,
                $defs: {
                  value: {
                    type: "object",
                    properties: { nested: { type: "string" } },
                    required: [],
                    additionalProperties: false,
                  },
                },
              },
            },
          },
        }),
      /missing: nested/
    );
  });

  test("maps default, none, and auto function choices", () => {
    const base = {
      model: "gpt-4o",
      messages: [{ role: "system", content: "" }],
      functions: [
        {
          name: "lookup",
          parameters: { type: "object", properties: {} },
        },
      ],
    };

    assert.equal(translateToResponsesPayload(base).tool_choice, undefined);
    assert.equal(
      translateToResponsesPayload({ ...base, function_call: "none" })
        .tool_choice,
      "none"
    );
    assert.equal(
      translateToResponsesPayload({ ...base, function_call: "auto" })
        .tool_choice,
      "auto"
    );
  });
});

describe("Chat Completions request contract", () => {
  test("preserves the legacy endpoint, request shape, and callback shape", async () => {
    let request;
    globalThis.fetch = async (url, options) => {
      request = { url, options };
      return jsonResponse({
        choices: [
          {
            finish_reason: "stop",
            message: { role: "assistant", content: "Hello back" },
          },
        ],
        usage: { total_tokens: 5 },
      });
    };
    const callbacks = [];

    await createRequest({
      apiKey: "test-key",
      payload: {
        model: "gpt-4o",
        messages: [
          { role: "system", content: "" },
          {
            role: "user",
            content: "Hello",
            _responses_items: [{ type: "reasoning", id: "rs_old" }],
            _responses_call_id: "call_old",
            _responses_output_index: 0,
            _responses_phase: "final_answer",
          },
          {
            role: "assistant",
            content: "",
            _responses_items: [
              { type: "reasoning", id: "rs_trailing" },
            ],
            _responses_metadata_only: true,
          },
        ],
        stream: false,
      },
      dataCallback: async (data) => callbacks.push(data),
      completionURL: "https://chat.example.test/v1/chat/completions",
    }).send();

    assert.equal(
      request.url,
      "https://chat.example.test/v1/chat/completions"
    );
    assert.equal(request.options.headers.Authorization, "Bearer test-key");
    assert.deepEqual(JSON.parse(request.options.body), {
      model: "gpt-4o",
      messages: [{ role: "user", content: "Hello" }],
      stream: false,
      n: 1,
    });
    assert.deepEqual(callbacks, [
      {
        finish_reason: "stop",
        message: { role: "assistant", content: "Hello back" },
        usage: { total_tokens: 5 },
      },
      undefined,
    ]);
  });

  test("continues to request streamed usage", async () => {
    let body;
    globalThis.fetch = async (_url, options) => {
      body = JSON.parse(options.body);
      return new Response(
        [
          'data: {"choices":[{"delta":{"role":"assistant","content":""}}]}\n\n',
          'data: {"choices":[{"delta":{"content":"Hi"}}]}\n\n',
          "data: [DONE]\n\n",
        ].join(""),
        { status: 200 }
      );
    };
    const callbacks = [];

    await createRequest({
      apiKey: "test-key",
      payload: {
        model: "gpt-4o",
        messages: [{ role: "system", content: "" }],
        stream: true,
      },
      dataCallback: async (data) => callbacks.push(data),
    }).send();

    assert.deepEqual(body.stream_options, { include_usage: true });
    assert.equal(body.n, 1);
    assert.equal(callbacks.at(-1), undefined);
  });
});

describe("Responses request contract", () => {
  test("uses the configured endpoint and adapts non-streaming output", async () => {
    let request;
    globalThis.fetch = async (url, options) => {
      request = { url, options };
      return jsonResponse({
        status: "completed",
        output: [
          {
            type: "reasoning",
            id: "rs_123",
            encrypted_content: "opaque",
            summary: [],
          },
          {
            type: "message",
            role: "assistant",
            phase: "final_answer",
            content: [
              { type: "output_text", text: "The answer is " },
              { type: "output_text", text: "42." },
            ],
          },
          {
            type: "function_call",
            call_id: "call_record",
            name: "record_answer",
            arguments: "{\"answer\":42}",
          },
        ],
        usage: {
          input_tokens: 10,
          output_tokens: 5,
          total_tokens: 15,
        },
      });
    };
    const callbacks = [];

    await createRequest({
      apiKey: "test-key",
      apiType: responsesAPI,
      responsesURL: "https://responses.example.test/v1/responses",
      payload: {
        model: "gpt-5.6-luna",
        messages: [
          { role: "system", content: "" },
          { role: "user", content: "Answer" },
        ],
        reasoning_effort: "max",
        stream: false,
      },
      dataCallback: async (data) => callbacks.push(data),
    }).send();

    assert.equal(
      request.url,
      "https://responses.example.test/v1/responses"
    );
    assert.deepEqual(JSON.parse(request.options.body), {
      include: ["reasoning.encrypted_content"],
      model: "gpt-5.6-luna",
      store: false,
      stream: false,
      input: [{ role: "user", content: "Answer" }],
      reasoning: { effort: "max" },
    });
    assert.deepEqual(callbacks, [
      {
        message: {
          role: "assistant",
          content: "The answer is 42.",
          _responses_phase: "final_answer",
          _responses_items: [
            {
              type: "reasoning",
              id: "rs_123",
              encrypted_content: "opaque",
              summary: [],
            },
          ],
        },
      },
      {
        message: {
          role: "assistant",
          content: "",
          function_call: {
            name: "record_answer",
            arguments: "{\"answer\":42}",
          },
          _responses_call_id: "call_record",
        },
      },
      {
        usage: {
          input_tokens: 10,
          output_tokens: 5,
          total_tokens: 15,
        },
      },
      undefined,
    ]);

    assert.deepEqual(
      translateToResponsesPayload({
        model: "gpt-5.6-luna",
        messages: [
          { role: "user", content: "Answer" },
          callbacks[0].message,
          callbacks[1].message,
          {
            role: "function",
            name: "record_answer",
            content: "saved",
            _responses_call_id: "call_record",
          },
          { role: "user", content: "Why?" },
        ],
      }).input,
      [
        { role: "user", content: "Answer" },
        {
          type: "reasoning",
          id: "rs_123",
          encrypted_content: "opaque",
          summary: [],
        },
        {
          role: "assistant",
          content: "The answer is 42.",
          phase: "final_answer",
        },
        {
          type: "function_call",
          call_id: "call_record",
          name: "record_answer",
          arguments: "{\"answer\":42}",
        },
        {
          type: "function_call_output",
          call_id: "call_record",
          output: "saved",
        },
        { role: "user", content: "Why?" },
      ]
    );
  });

  test("carries trailing stateless reasoning into the next request", async () => {
    const reasoning = {
      type: "reasoning",
      id: "rs_trailing",
      encrypted_content: "opaque-trailing",
      summary: [],
    };
    globalThis.fetch = async () =>
      jsonResponse({
        status: "incomplete",
        output: [reasoning],
        incomplete_details: { reason: "max_output_tokens" },
      });
    const callbacks = [];

    await createRequest({
      apiKey: "test-key",
      apiType: responsesAPI,
      payload: {
        model: "gpt-5.6",
        messages: [{ role: "system", content: "" }],
        stream: false,
      },
      dataCallback: async (data) => callbacks.push(data),
    }).send();

    assert.deepEqual(callbacks[0], {
      message: {
        role: "assistant",
        content: "",
        _responses_items: [reasoning],
        _responses_metadata_only: true,
      },
    });
    assert.deepEqual(
      translateToResponsesPayload({
        model: "gpt-5.6",
        messages: [
          callbacks[0].message,
          { role: "user", content: "Continue." },
        ],
      }).input,
      [reasoning, { role: "user", content: "Continue." }]
    );
    assert.deepEqual(callbacks[1], {
      finish_reason: "max_output_tokens",
    });
  });

  test("adapts typed text streaming events and terminal usage", async () => {
    const reasoning = {
      type: "reasoning",
      id: "rs_text",
      encrypted_content: "opaque-stream",
      summary: [],
    };
    globalThis.fetch = async () =>
      streamResponse([
        {
          type: "response.output_item.added",
          output_index: 0,
          item: reasoning,
        },
        {
          type: "response.output_item.done",
          output_index: 0,
          item: reasoning,
        },
        {
          type: "response.output_item.added",
          output_index: 1,
          item: {
            type: "message",
            role: "assistant",
            phase: "final_answer",
            content: [],
          },
        },
        {
          type: "response.output_text.delta",
          output_index: 1,
          delta: "Hello",
        },
        {
          type: "response.output_text.delta",
          output_index: 1,
          delta: " world",
        },
        {
          type: "response.completed",
          response: {
            status: "completed",
            usage: {
              input_tokens: 3,
              output_tokens: 2,
              total_tokens: 5,
            },
          },
        },
      ]);
    const callbacks = [];

    await createRequest({
      apiKey: "test-key",
      apiType: responsesAPI,
      payload: {
        model: "gpt-5.6",
        messages: [{ role: "system", content: "" }],
        stream: true,
      },
      dataCallback: async (data) => callbacks.push(data),
    }).send();

    assert.deepEqual(callbacks, [
      {
        delta: {
          role: "assistant",
          content: "",
          _responses_items: [reasoning],
          _responses_phase: "final_answer",
          _responses_output_index: 1,
        },
      },
      {
        delta: { content: "Hello", _responses_output_index: 1 },
      },
      {
        delta: { content: " world", _responses_output_index: 1 },
      },
      {
        usage: {
          input_tokens: 3,
          output_tokens: 2,
          total_tokens: 5,
        },
      },
      undefined,
    ]);

    let messages = [{ role: "user", content: "Greet me." }];
    for (const callback of callbacks) {
      if (callback?.delta) {
        messages = applyResponseDelta(messages, callback.delta);
      }
    }
    messages.push({ role: "user", content: "Again." });
    assert.deepEqual(
      translateToResponsesPayload({
        model: "gpt-5.6",
        messages,
      }).input,
      [
        { role: "user", content: "Greet me." },
        reasoning,
        {
          role: "assistant",
          content: "Hello world",
          phase: "final_answer",
        },
        { role: "user", content: "Again." },
      ]
    );
  });

  test("adapts typed function-call streaming events", async () => {
    globalThis.fetch = async () =>
      streamResponse([
        {
          type: "response.output_item.added",
          output_index: 0,
          item: { type: "reasoning", id: "rs_123", summary: [] },
        },
        {
          type: "response.output_item.done",
          output_index: 0,
          item: { type: "reasoning", id: "rs_123", summary: [] },
        },
        {
          type: "response.output_item.added",
          output_index: 1,
          item: {
            type: "function_call",
            call_id: "call_123",
            name: "calculate",
            arguments: "",
          },
        },
        {
          type: "response.function_call_arguments.delta",
          output_index: 1,
          delta: "{\"value\":",
        },
        {
          type: "response.function_call_arguments.delta",
          output_index: 1,
          delta: "42}",
        },
        {
          type: "response.completed",
          response: { status: "completed" },
        },
      ]);
    const callbacks = [];

    await createRequest({
      apiKey: "test-key",
      apiType: responsesAPI,
      payload: {
        model: "gpt-5.6",
        messages: [{ role: "system", content: "" }],
        stream: true,
      },
      dataCallback: async (data) => callbacks.push(data),
    }).send();

    assert.deepEqual(callbacks, [
      {
        delta: {
          role: "assistant",
          function_call: { name: "calculate", arguments: "" },
          _responses_call_id: "call_123",
          _responses_items: [
            { type: "reasoning", id: "rs_123", summary: [] },
          ],
          _responses_output_index: 1,
        },
      },
      {
        delta: {
          function_call: { arguments: "{\"value\":" },
          _responses_output_index: 1,
        },
      },
      {
        delta: {
          function_call: { arguments: "42}" },
          _responses_output_index: 1,
        },
      },
      undefined,
    ]);
  });

  test("routes interleaved parallel function deltas by output index", async () => {
    globalThis.fetch = async () =>
      streamResponse([
        {
          type: "response.output_item.added",
          output_index: 0,
          item: {
            type: "function_call",
            call_id: "call_A",
            name: "lookup",
            arguments: "",
          },
        },
        {
          type: "response.output_item.added",
          output_index: 1,
          item: {
            type: "function_call",
            call_id: "call_B",
            name: "lookup",
            arguments: "",
          },
        },
        {
          type: "response.function_call_arguments.delta",
          output_index: 1,
          delta: "{\"id\":2}",
        },
        {
          type: "response.function_call_arguments.delta",
          output_index: 0,
          delta: "{\"id\":1}",
        },
        {
          type: "response.completed",
          response: { status: "completed" },
        },
      ]);
    let messages = [{ role: "user", content: "Look up both." }];

    await createRequest({
      apiKey: "test-key",
      apiType: responsesAPI,
      payload: {
        model: "gpt-5.6",
        messages: [{ role: "system", content: "" }],
        stream: true,
      },
      dataCallback: async (data) => {
        if (data?.delta) {
          messages = applyResponseDelta(messages, data.delta);
        }
      },
    }).send();

    assert.deepEqual(
      messages.slice(1).map((message) => ({
        callId: message._responses_call_id,
        arguments: message.function_call.arguments,
      })),
      [
        { callId: "call_A", arguments: "{\"id\":1}" },
        { callId: "call_B", arguments: "{\"id\":2}" },
      ]
    );
  });

  test("surfaces top-level streaming error details", async () => {
    globalThis.fetch = async () =>
      streamResponse([
        {
          type: "error",
          code: "invalid_request_error",
          message: "Reasoning effort is unsupported.",
          param: "reasoning.effort",
        },
      ]);

    await assert.rejects(
      createRequest({
        apiKey: "test-key",
        apiType: responsesAPI,
        payload: {
          model: "gpt-5.6",
          messages: [{ role: "system", content: "" }],
          stream: true,
        },
        dataCallback: async () => {},
      }).send(),
      (error) =>
        error === "APIError: Reasoning effort is unsupported."
    );
  });

  test("surfaces compatible endpoint errors without assuming OpenAI's shape", async () => {
    globalThis.fetch = async () =>
      jsonResponse({ message: "Proxy rejected the request" }, 403);

    await assert.rejects(
      createRequest({
        apiKey: "test-key",
        apiType: responsesAPI,
        payload: {
          model: "gpt-5.6",
          messages: [{ role: "system", content: "" }],
          stream: false,
        },
        dataCallback: async () => {},
      }).send(),
      (error) => error === "APIError: Proxy rejected the request"
    );
  });

  test("flushes completed reasoning metadata when a stream is cancelled", async () => {
    const reasoning = {
      type: "reasoning",
      id: "rs_cancelled",
      encrypted_content: "opaque-cancelled",
      summary: [],
    };
    globalThis.fetch = async (_url, options) =>
      new Response(
        new ReadableStream({
          start(controller) {
            const encoder = new TextEncoder();
            controller.enqueue(
              encoder.encode(
                `data: ${JSON.stringify({
                  type: "response.output_item.done",
                  output_index: 0,
                  item: reasoning,
                })}\n\n`
              )
            );
            options.signal.addEventListener("abort", () => {
              controller.error(
                new DOMException("The operation was aborted.", "AbortError")
              );
            });
          },
        }),
        {
          status: 200,
          headers: { "Content-Type": "text/event-stream" },
        }
      );

    const callbacks = [];
    const request = createRequest({
      apiKey: "test-key",
      apiType: responsesAPI,
      payload: {
        model: "gpt-5.6",
        messages: [{ role: "system", content: "" }],
        stream: true,
      },
      dataCallback: async (data) => callbacks.push(data),
    });
    const sending = request.send();
    await new Promise((resolve) => setTimeout(resolve, 0));
    request.cancel();

    await assert.rejects(sending, (error) => error?.name === "AbortError");
    assert.deepEqual(callbacks, [
      {
        delta: {
          role: "assistant",
          content: "",
          _responses_items: [reasoning],
          _responses_metadata_only: true,
        },
      },
    ]);
  });

  test("adapts refusal output in streaming and non-streaming modes", async () => {
    const nonStreamingCallbacks = [];
    globalThis.fetch = async () =>
      jsonResponse({
        status: "completed",
        output: [
          {
            type: "message",
            role: "assistant",
            content: [{ type: "refusal", refusal: "Cannot comply." }],
          },
        ],
      });
    await createRequest({
      apiKey: "test-key",
      apiType: responsesAPI,
      payload: {
        model: "gpt-4o",
        messages: [{ role: "system", content: "" }],
        stream: false,
      },
      dataCallback: async (data) => nonStreamingCallbacks.push(data),
    }).send();
    assert.equal(
      nonStreamingCallbacks[0].message.content,
      "Cannot comply."
    );
    assert.equal(
      nonStreamingCallbacks[0].message._responses_refusal,
      true
    );

    const streamingCallbacks = [];
    globalThis.fetch = async () =>
      streamResponse([
        {
          type: "response.output_item.added",
          output_index: 0,
          item: { type: "message", role: "assistant", content: [] },
        },
        {
          type: "response.refusal.delta",
          output_index: 0,
          delta: "Cannot comply.",
        },
        {
          type: "response.completed",
          response: { status: "completed" },
        },
      ]);
    await createRequest({
      apiKey: "test-key",
      apiType: responsesAPI,
      payload: {
        model: "gpt-4o",
        messages: [{ role: "system", content: "" }],
        stream: true,
      },
      dataCallback: async (data) => streamingCallbacks.push(data),
    }).send();
    assert.equal(
      streamingCallbacks[1].delta.content,
      "Cannot comply."
    );
    assert.equal(
      streamingCallbacks[1].delta._responses_refusal,
      true
    );

    const doneOnlyCallbacks = [];
    globalThis.fetch = async () =>
      streamResponse([
        {
          type: "response.output_item.added",
          output_index: 0,
          item: { type: "message", role: "assistant", content: [] },
        },
        {
          type: "response.output_item.done",
          output_index: 0,
          item: {
            type: "message",
            role: "assistant",
            content: [{ type: "refusal", refusal: "Cannot comply." }],
          },
        },
        {
          type: "response.completed",
          response: { status: "completed" },
        },
      ]);
    await createRequest({
      apiKey: "test-key",
      apiType: responsesAPI,
      payload: {
        model: "gpt-4o",
        messages: [{ role: "system", content: "" }],
        stream: true,
      },
      dataCallback: async (data) => doneOnlyCallbacks.push(data),
    }).send();
    assert.equal(doneOnlyCallbacks[1].delta.content, "Cannot comply.");
    assert.equal(doneOnlyCallbacks[1].delta._responses_refusal, true);
  });

  test("rejects a stream that ends without a terminal event", async () => {
    globalThis.fetch = async () =>
      streamResponse([
        {
          type: "response.output_text.delta",
          output_index: 0,
          delta: "partial",
        },
      ]);

    await assert.rejects(
      createRequest({
        apiKey: "test-key",
        apiType: responsesAPI,
        payload: {
          model: "gpt-4o",
          messages: [{ role: "system", content: "" }],
          stream: true,
        },
        dataCallback: async () => {},
      }).send(),
      (error) => error === "APIError: stream ended unexpectedly"
    );
  });
});
