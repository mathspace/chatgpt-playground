import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { sub } from "../src/VariableSubstitution.js";

describe("playground variables", () => {
  test("substitutes system, user, and function output without altering assistant state", () => {
    const payload = {
      messages: [
        { role: "system", content: "System ${value}" },
        { role: "user", content: "User ${value}" },
        { role: "assistant", content: "Assistant ${value}" },
        {
          role: "assistant",
          content: "",
          function_call: {
            name: "lookup",
            arguments: '{"value":"${value}"}',
          },
          _responses_items: [
            {
              type: "reasoning",
              encrypted_content: "opaque-${value}",
            },
          ],
        },
        {
          role: "function",
          name: "lookup",
          content: "Function ${value}",
        },
        {
          role: "user",
          content: [{ type: "input_text", text: "Unsupported ${value}" }],
        },
      ],
    };
    const original = structuredClone(payload);

    const rendered = sub(payload, { value: "REPLACED" });

    assert.equal(rendered.messages[0].content, "System REPLACED");
    assert.equal(rendered.messages[1].content, "User REPLACED");
    assert.equal(rendered.messages[2].content, "Assistant ${value}");
    assert.equal(
      rendered.messages[3].function_call.arguments,
      '{"value":"${value}"}'
    );
    assert.equal(
      rendered.messages[3]._responses_items[0].encrypted_content,
      "opaque-${value}"
    );
    assert.equal(rendered.messages[4].content, "Function REPLACED");
    assert.deepEqual(rendered.messages[5].content, [
      { type: "input_text", text: "Unsupported ${value}" },
    ]);
    assert.deepEqual(payload, original);
  });
});
