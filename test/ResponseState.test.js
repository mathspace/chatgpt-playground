import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { applyResponseDelta } from "../src/ResponseState.js";

describe("response callback state", () => {
  test("keeps opaque reasoning metadata on a streamed assistant message", () => {
    const reasoning = {
      type: "reasoning",
      id: "rs_123",
      encrypted_content: "opaque",
      summary: [],
    };
    let messages = [{ role: "user", content: "Question" }];

    messages = applyResponseDelta(messages, {
      role: "assistant",
      content: "",
      _responses_items: [reasoning],
      _responses_phase: "final_answer",
    });
    messages = applyResponseDelta(messages, { content: "Answer" });

    assert.deepEqual(messages, [
      { role: "user", content: "Question" },
      {
        role: "assistant",
        content: "Answer",
        _responses_items: [reasoning],
        _responses_phase: "final_answer",
      },
    ]);
  });

  test("keeps the Responses call ID while aggregating function arguments", () => {
    let messages = [{ role: "user", content: "Calculate" }];

    messages = applyResponseDelta(messages, {
      role: "assistant",
      function_call: { name: "calculate", arguments: "" },
      _responses_call_id: "call_123",
    });
    messages = applyResponseDelta(messages, {
      function_call: { arguments: "{\"value\":42}" },
    });

    assert.deepEqual(messages.at(-1), {
      role: "assistant",
      content: "",
      function_call: {
        name: "calculate",
        arguments: "{\"value\":42}",
      },
      _responses_call_id: "call_123",
    });
  });

  test("preserves the legacy split when content changes into a function call", () => {
    const messages = [
      { role: "user", content: "Question" },
      { role: "assistant", content: "Partial answer" },
    ];

    assert.deepEqual(
      applyResponseDelta(messages, {
        function_call: { name: "calculate", arguments: "{}" },
      }),
      [
        ...messages,
        {
          role: "assistant",
          content: "",
          function_call: { name: "calculate", arguments: "{}" },
        },
      ]
    );
  });

  test("preserves the Responses refusal marker while streaming text", () => {
    let messages = applyResponseDelta([], {
      role: "assistant",
      content: "",
      _responses_output_index: 0,
    });
    messages = applyResponseDelta(messages, {
      content: "Cannot comply.",
      _responses_refusal: true,
      _responses_output_index: 0,
    });

    assert.deepEqual(messages, [
      {
        role: "assistant",
        content: "Cannot comply.",
        _responses_output_index: 0,
        _responses_refusal: true,
      },
    ]);
  });

  test("applies a refusal marker carried by an empty stream delta", () => {
    let messages = applyResponseDelta([], {
      role: "assistant",
      content: "",
      _responses_output_index: 0,
    });
    messages = applyResponseDelta(messages, {
      content: "",
      _responses_refusal: true,
      _responses_output_index: 0,
    });

    assert.equal(messages[0]._responses_refusal, true);
  });
});
