/**
 * Returns a cloned payload with variables rendered in operator-authored input.
 * Assistant output and its opaque Responses metadata must remain byte-for-byte
 * replayable, so neither is eligible for substitution.
 */
export function sub(openaiPayload, replacements) {
  let replace;
  if (typeof replacements === "function") {
    replace = (_, name) => replacements(name);
  } else {
    replace = (_, name) => replacements[name] || "";
  }

  const rendered = JSON.parse(JSON.stringify(openaiPayload));
  const pattern = /\$\{([a-z0-9_.-]+)\}/gi;
  rendered.messages = rendered.messages.map((message) => {
    if (
      message.role !== "assistant" &&
      typeof message.content === "string"
    ) {
      message.content = message.content.replace(pattern, replace);
    }
    return message;
  });
  return rendered;
}
