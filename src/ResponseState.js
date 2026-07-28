function responseMetadata(delta) {
  return {
    ...(delta._responses_call_id
      ? { _responses_call_id: delta._responses_call_id }
      : {}),
    ...(delta._responses_items?.length
      ? { _responses_items: delta._responses_items }
      : {}),
    ...(delta._responses_metadata_only
      ? { _responses_metadata_only: true }
      : {}),
    ...(delta._responses_output_index !== undefined
      ? { _responses_output_index: delta._responses_output_index }
      : {}),
    ...(delta._responses_phase
      ? { _responses_phase: delta._responses_phase }
      : {}),
    ...(delta._responses_refusal
      ? { _responses_refusal: true }
      : {}),
  };
}

/**
 * Applies the Chat Completions-shaped callback contract used by both network
 * adapters to the playground's canonical message transcript.
 */
export function applyResponseDelta(messages, delta) {
  if (delta.role) {
    const newMessages = [];
    let metadata = responseMetadata(delta);
    const addMessage = (message) => {
      newMessages.push({ ...message, ...metadata });
      metadata = {};
    };

    if (delta.content || (!delta.content && !delta.function_call)) {
      addMessage({ role: delta.role, content: delta.content });
    }
    if (delta.function_call) {
      addMessage({
        role: delta.role,
        content: "",
        function_call: {
          name: delta.function_call.name,
          arguments: delta.function_call.arguments,
        },
      });
    }
    return [...messages, ...newMessages];
  }

  if (!delta.function_call && !delta.content) {
    const metadata = responseMetadata(delta);
    if (Object.keys(metadata).length === 0) {
      return messages;
    }
    const messageIndex = findMessageIndex(messages, delta);
    return [
      ...messages.slice(0, messageIndex),
      { ...cloneMessage(messages[messageIndex]), ...metadata },
      ...messages.slice(messageIndex + 1),
    ];
  }

  const messageIndex = findMessageIndex(messages, delta);
  const message = {
    ...cloneMessage(messages[messageIndex]),
    ...responseMetadata(delta),
  };
  if (delta.function_call) {
    if (message.content) {
      return [
        ...messages.slice(0, messageIndex + 1),
        {
          role: message.role,
          content: "",
          function_call: {
            name: delta.function_call.name,
            arguments: delta.function_call.arguments,
          },
        },
        ...messages.slice(messageIndex + 1),
      ];
    }
    message.function_call.arguments += delta.function_call.arguments;
  } else {
    message.content += delta.content;
  }
  return [
    ...messages.slice(0, messageIndex),
    message,
    ...messages.slice(messageIndex + 1),
  ];
}

function findMessageIndex(messages, delta) {
  if (delta._responses_output_index === undefined) {
    return messages.length - 1;
  }
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    if (
      messages[index]._responses_output_index ===
      delta._responses_output_index
    ) {
      return index;
    }
  }
  throw new Error(
    `No message found for Responses output index ` +
    `${delta._responses_output_index}.`
  );
}

function cloneMessage(message) {
  return JSON.parse(JSON.stringify(message));
}
