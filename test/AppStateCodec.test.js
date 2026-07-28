import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { gzip as pakoGzip } from "pako";
import { hashDecode, hashEncode } from "../src/AppStateCodec.js";
import {
  chatCompletionsAPI,
  normalizeAPIType,
  responsesAPI,
} from "../src/OpenAIRequest.js";

function sessionState(apiType) {
  return {
    ...(apiType === undefined ? {} : { api_type: apiType }),
    openai_payload: {
      model: "gpt-4o",
      messages: [
        { role: "system", content: "" },
        { role: "user", content: "Keep this conversation intact." },
      ],
      stream: true,
    },
    replace_variables: true,
    vars: {},
  };
}

const legacyFixtureState = {
  openai_payload: {
    model: "gpt-4o",
    messages: [
      { role: "system", content: "" },
      { role: "user", content: "legacy" },
    ],
    stream: true,
  },
  replace_variables: true,
  vars: {},
};

// Fixed fixtures from the pre-API-selector codec formats. These must remain
// literals: regenerating them in the test would only prove current-code
// round-tripping, not backward compatibility.
const legacyHashes = {
  gzipAp: "bpilaiaaabaaaaaaaaadffmndlakmddabeeenblnemknhekjlejfbammildmaiidhooimjabcblephmiincbnnhaepdbadljdamjlbbfojcbmlaodlbapdmoaaalfpnkodjjgbbakjckjoakplbkkidjhakbhggnimalfneoinkjkniegjgodojfpfapadlnliiopjdgnafgcjbblgnfjdndkalcaehbnmlofcappjieologbcidbfngbohdpoaakpljimahkfaaaaaa",
  gzipHex: "1f8b080001000000000355cd3b0ac3301444d1bd4cad74a9b49510cc8b3c08837ee8c90121b4f7c88d21dd704f3103b930c9b115e921cb0e3b10f3ce000b5fdae3996110a92a9e0afb1aa83970a1766d8c0b5d4e8da9ad84696e3e95f50f03bdb88ef936d0562911b6d593d3a0b20471dcbe520ff984ebe6128315d61e73fe00afb98c07a5000000",
  rawHex: "7b226f70656e61695f7061796c6f6164223a7b226d6f64656c223a226770742d346f222c226d65737361676573223a5b7b22726f6c65223a2273797374656d222c22636f6e74656e74223a22227d2c7b22726f6c65223a2275736572222c22636f6e74656e74223a226c6567616379227d5d2c2273747265616d223a747275657d2c227265706c6163655f7661726961626c6573223a747275652c2276617273223a7b7d7d",
  rawAp: "hlccgphagfgogbgjfphagbhjgmgpgbgeccdkhlccgngpgegfgmccdkccghhahecndegpcccmccgngfhdhdgbghgfhdccdkflhlcchcgpgmgfccdkcchdhjhdhegfgncccmccgdgpgohegfgoheccdkcccchncmhlcchcgpgmgfccdkcchfhdgfhccccmccgdgpgohegfgoheccdkccgmgfghgbgdhjcchnfncmcchdhehcgfgbgnccdkhehchfgfhncmcchcgfhagmgbgdgffphggbhcgjgbgcgmgfhdccdkhehchfgfcmcchggbhchdccdkhlhnhn",
};

describe("share-link API compatibility", () => {
  test("decodes every pre-selector hash format and title prefix", () => {
    for (const hash of Object.values(legacyHashes)) {
      assert.deepEqual(hashDecode(hash), legacyFixtureState);
    }
    assert.deepEqual(
      hashDecode(`Legacy_session:${legacyHashes.gzipAp}`),
      legacyFixtureState
    );
  });

  test("a link with no API field decodes unchanged and resolves to Chat Completions", () => {
    const legacyState = sessionState(undefined);
    const decoded = hashDecode(hashEncode(legacyState));

    assert.deepEqual(decoded, legacyState);
    assert.equal(decoded.api_type, undefined);
    assert.equal(
      normalizeAPIType(decoded.api_type),
      chatCompletionsAPI
    );
  });

  test("a Responses selection round-trips in shareable state", () => {
    const responsesState = sessionState(responsesAPI);
    const decoded = hashDecode(hashEncode(responsesState));

    assert.deepEqual(decoded, responsesState);
    assert.equal(normalizeAPIType(decoded.api_type), responsesAPI);
  });

  test("rejects compressed states whose declared output exceeds the safety budget", () => {
    const compressed = Array.from(pakoGzip(
      new TextEncoder().encode(JSON.stringify({ openai_payload: {} })),
      { level: 6 }
    ));
    const declaredSize = 2 * 1024 * 1024 + 1;
    compressed.splice(
      -4,
      4,
      declaredSize & 0xff,
      (declaredSize >>> 8) & 0xff,
      (declaredSize >>> 16) & 0xff,
      (declaredSize >>> 24) & 0xff
    );
    const encoded = compressed
      .map(
        (byte) =>
          String.fromCharCode(97 + Math.floor(byte / 16)) +
          String.fromCharCode(97 + (byte % 16))
      )
      .join("");

    assert.throws(() => hashDecode(encoded), /Invalid state encoding/);
  });

  test("stops decompression when a forged trailer understates expanded size", () => {
    const compressed = pakoGzip(new Uint8Array(2 * 1024 * 1024 + 1));
    compressed.set([1, 0, 0, 0], compressed.length - 4);
    const encoded = Array.from(compressed)
      .map(
        (byte) =>
          String.fromCharCode(97 + Math.floor(byte / 16)) +
          String.fromCharCode(97 + (byte % 16))
      )
      .join("");

    assert.throws(() => hashDecode(encoded), /Invalid state encoding/);
  });

  test("refuses to create a link that its own decoder would reject", () => {
    const oversized = sessionState(responsesAPI);
    oversized.openai_payload.messages[1].content =
      "x".repeat(2 * 1024 * 1024);

    assert.throws(
      () => hashEncode(oversized),
      /Shared state is too large/
    );
  });
});
