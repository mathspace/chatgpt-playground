import { useCallback, useEffect, useRef, useState } from "react";
import { Modal } from './Modal';
import {
  openAICompletionURL,
  openAIResponsesURL,
  validateEndpointURL,
} from "./OpenAIRequest.js";

export function APIEndpointModal({
  completionURL,
  responsesURL,
  onSave,
  onCancel,
}) {
  const completionRef = useRef(null);
  const responsesRef = useRef(null);
  const [error, setError] = useState("");

  useEffect(() => {
    if (completionRef.current) {
      completionRef.current.focus();
    }
  }, []);

  const reset = useCallback(() => {
    if (completionRef.current && responsesRef.current) {
      completionRef.current.value = openAICompletionURL;
      responsesRef.current.value = openAIResponsesURL;
      setError("");
    }
  }, []);

  const save = useCallback((event) => {
    event.preventDefault();
    try {
      onSave({
        completionURL: validateEndpointURL(
          completionRef.current.value.trim() || openAICompletionURL
        ),
        responsesURL: validateEndpointURL(
          responsesRef.current.value.trim() || openAIResponsesURL
        ),
      });
    } catch (e) {
      setError(e.message);
    }
  }, [onSave]);

  return (
    <Modal
      onCancel={onCancel}
      width="550px"
      contentClassName="api-endpoint-modal"
    >
      <form onSubmit={save}>
        <h2>API Endpoints</h2>
        <p>
          Your API key is sent to the selected endpoint. Only configure
          endpoints you trust.
        </p>
        {error ? <p className="api-endpoint-modal__error" role="alert">{error}</p> : null}
        <label htmlFor="chat-completions-url">Chat Completion API</label>
        <input
          id="chat-completions-url"
          ref={completionRef}
          type="text"
          placeholder="https://..."
          defaultValue={completionURL}
        />
        <label htmlFor="responses-url">Responses API</label>
        <input
          id="responses-url"
          ref={responsesRef}
          type="text"
          placeholder="https://..."
          defaultValue={responsesURL}
        />
        <div className="api-endpoint-modal__actions">
          <button type="submit">Save</button>
          <button type="button" onClick={onCancel}>Cancel</button>
          <button
            type="button"
            className="api-endpoint-modal__reset"
            onClick={reset}
          >
            Reset to OpenAI
          </button>
        </div>
      </form>
    </Modal>
  );
}
