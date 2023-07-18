import { useCallback, useEffect, useRef, useState } from 'react';
import { LoadButton, SaveButton, CopyLinkButton } from "./Clipboard.jsx";
import * as Vars from "./Vars.jsx";
import { Messages } from "./Messages.jsx";
import * as OpenAI from './OpenAI.jsx';
import AutoExtendingTextarea from './AutoExtendingTextarea.jsx';
import './App.css';
import { APIKeyModal } from './APIKeyModal.jsx';
import { useLocalStorage } from './LocalStorage.jsx';
import NumberInput from './NumberInput.jsx';
import { FunctionCallSelector } from './FunctionCallSelector.jsx';
import InfoLabel from './InfoLabel.jsx';
import StopSequences from './StopSequences.jsx';
import Functions from './Functions.jsx';
import WindowHash from './WindowHash.jsx';

// Converts the ad-hoc state format of pre-react version to official OpenAI's
// payload format.
function oldStateToOpenAIPayload(state) {
  return {
    messages: [
      {
        role: "system",
        content: state.system,
      },
      ...state.messages.map(m => ({
        role: m.type,
        content: m.content,
      })),
    ],
    model: state.model,
    temperature: state.temperature,
    top_p: state.top_p,
    max_tokens: state.max_tokens,
    presence_penalty: state.presence_penalty,
    frequency_penalty: state.frequency_penalty,
    stop: (state.stop || []).length > 0 ? state.stop : undefined,
  };
}

const apiKeyLocalStorageKey = "chatgpt-playground-api-key";

const validateState = (() => {
  const validate = OpenAI.createValidator();
  return v => {
    if (typeof v.vars !== 'object' && v.vars !== undefined) {
      throw new Error("vars must be object/undefined.");
    }
    validate(v.openai_payload);
  };
})();

export default function App() {

  const [defaultSettings, setDefaultSettings] = useLocalStorage("chatgpt-playground-default-settings", JSON.stringify({
    model: "gpt-4-0314",
    temperature: 0.7,
    top_p: 1,
    max_tokens: 256,
    presence_penalty: 0,
    frequency_penalty: 0,
  }));
  const [defaultReplaceVar, setDefaultReplaceVar] = useLocalStorage("chatgpt-playground-default-replace-var", "true");
  const defaultState = {
    openai_payload: {
      ...JSON.parse(defaultSettings),
      messages: [{
        role: "system",
        content: "",
      }],
    },
    replace_variables: JSON.parse(defaultReplaceVar),
    vars: {},
  };

  const [state, unvalidatedSetState] = useState(defaultState);
  const renderedPayload = state.replace_variables ? Vars.sub(state.openai_payload, state.vars) : state.openai_payload;

  // Sets the app state only after validation succeeds.
  const setState = useCallback(v => {
    unvalidatedSetState(oldState => {
      let newState;
      if (typeof v === 'function') {
        newState = v(oldState);
      } else {
        newState = v;
      }
      try {
        validateState(newState);
        return newState;
      } catch (e) {
        console.log('app state validation failed:', newState, e);
        return oldState; // do not make changes to state
      }
    });
  });

  const setPayloadKey = useCallback((k, v) => {
    setState(s => {
      if (typeof v === 'function') {
        v = v(s.openai_payload[k]);
      }
      return { ...s, openai_payload: { ...s.openai_payload, [k]: v } };
    });
  });

  const loadState = useCallback(s => {
    try {
      // Convert old state format to the new format.
      if (!s.openai_payload) {
        s = {
          openai_payload: oldStateToOpenAIPayload(s),
          replace_variables: true,
          vars: s.vars,
        };
      }
      validateState(s);
      setState(s);
      return true;
    } catch (e) {
      alert("Load failed: " + e);
      return false;
    }
  });

  const systemRef = useRef(null);
  useEffect(() => {
    systemRef.current.focus();
  }, []);

  const dataCallback = useCallback(async (data) => {
    if (!data) {
      return;
    }
    if (data.finish_reason && data.finish_reason != "stop" && data.finish_reason != "function_call") {
      setStopReason("stopped reason: " + data.finish_reason);
      return
    }
    const delta = data.delta;
    if (!delta) {
      return;
    }
    setPayloadKey('messages', msgs => {
      if (delta.role) {
        const m = { role: delta.role, content: '' };
        if (delta.function_call) {
          m.function_call = {
            name: delta.function_call.name,
            arguments: delta.function_call.arguments,
          }
        } else if (delta.content) {
          m.content = delta.content;
        }
        return [...msgs, m];
      } else if (delta.function_call || delta.content) {
        const m = JSON.parse(JSON.stringify(msgs[msgs.length - 1]));
        if (delta.function_call) {
          m.function_call.arguments += delta.function_call.arguments;
        } else if (delta.content) {
          m.content += delta.content;
        }
        return [...msgs.slice(0, msgs.length - 1), m];
      } else {
        return msgs;
      }
    });
  });

  const [apiKey, setAPIKey] = useLocalStorage(apiKeyLocalStorageKey, "");
  const [openAIRequest, setOpenAIRequest] = useState(null);
  const [stopReason, setStopReason] = useState('');
  const submit = useCallback(async () => {
    if (!apiKey) {
      setStopReason('set API key & try again');
      setShowAPIKeyModal(true);
      return;
    }
    setStopReason('');
    const req = OpenAI.createRequest({
      apiKey,
      payload: renderedPayload,
      dataCallback,
    });
    setOpenAIRequest(req);
    try {
      await req.send();
    } catch (e) {
      setStopReason(e + '');
    }
    setOpenAIRequest(null);
  }, [apiKey, renderedPayload]);

  const cancel = useCallback(() => {
    if (openAIRequest) {
      openAIRequest.cancel();
    }
  }, [openAIRequest]);

  const { roundTrips, totalCost } = OpenAI.estimateCost(renderedPayload);

  const [showAPIKeyModal, setShowAPIKeyModal] = useState(false);

  const setSystemPrompt = useCallback(sysPrompt => {
    setPayloadKey('messages', msgs => {
      const m = {
        role: "system",
        content: sysPrompt,
      };
      return [m, ...msgs.slice(1)];
    });
  });

  const setMessages = useCallback(m => {
    setPayloadKey('messages', v => [v[0], ...(typeof m === 'function' ? m(v.slice(1)) : m)])
  });

  const setTitle = useCallback(e => {
    setState(s => ({ ...s, title: e.target.value || undefined }));
  });

  useEffect(() => {
    document.title = state.title || "ChatGPT Playground";
  }, [state.title]);

  return <>
    <div className="app column system">

      <AutoExtendingTextarea
        rows="1"
        placeholder="Untitled ChatGPT Playground Session 🖉"
        className="titleBox"
        value={state.title || ''}
        onInput={setTitle}
      />
      <div className="saveBox">
        <button onClick={() => open(window.location.href.split('#')[0])}>New</button>
        &nbsp;|&nbsp;
        <LoadButton setAppState={loadState}>Load from</LoadButton>
        &nbsp;/&nbsp;
        <SaveButton appState={state}>Save to</SaveButton>
        &nbsp;/&nbsp;
        <CopyLinkButton appState={state}>Copy link to</CopyLinkButton>
        &nbsp;clipboard.
      </div>

      <h2>System Prompt<InfoLabel href="messages" /></h2>
      <div className="prompt">
        <AutoExtendingTextarea
          ref={systemRef}
          onInput={useCallback(e => setSystemPrompt(e.target.value))}
          value={state.openai_payload.messages[0].content || ''}
        />
      </div>

      <h2>Functions<InfoLabel href="functions" /></h2>
      <p><i>Not all models support functions.</i></p>
      <div>
        <Functions
          functions={state.openai_payload.functions}
          setFunctions={useCallback(fs => setPayloadKey('functions', fs))}
        />
      </div>

      <h2>
        Variables
        <input
          type="checkbox"
          title="Enable"
          onChange={useCallback(e => setState(s => ({ ...s, replace_variables: e.target.checked })))}
          checked={state.replace_variables}
          style={{ float: "right" }}
        />
      </h2>
      <p>
        When enabled, variables in form of ${"{name}"} can be used in the system
        prompt, user, and function result messages. They will be replaced with
        values below. Variables are automatically added here when used.
      </p>
      <Vars.Vars
        openai_payload={state.openai_payload}
        appVars={state.vars}
        setAppVars={v => setState({ ...state, vars: v })} />
    </div >

    <div className="app column conversation">
      <h2>Messages<InfoLabel href="messages" /></h2>
      <Messages
        messages={state.openai_payload.messages.slice(1)}
        setMessages={setMessages}
        streaming={Boolean(openAIRequest)}
        stopReason={stopReason}
        onSubmit={submit}
        onCancel={cancel}
      />
    </div>

    <div className="app column knobs">
      <button className="open-api-key" onClick={() => setShowAPIKeyModal(true)} title="Set API Key">🔑</button>
      <button onClick={() => window.open("https://platform.openai.com/docs/api-reference/chat/create", "_blank")} className="docs" title="Show API reference">📄</button>

      <h2>Cost</h2>

      <p className="cost" title="Based on 30% character to token ratio estimate.">
        <span title="Usual # of completion API calls for current history.">
          Round Trips: <span>{roundTrips}</span></span><br />
        <b>1x = </b><span className="cost-item">{totalCost.toFixed(2)}</span>*<br />
        100x = <span className="cost-item">{(totalCost * 100).toFixed(2)}</span>*<br />
        <i title="Calculated as if you started with only system prompt and got to this point.">* comulative</i>
      </p>

      <h2>Settings
        <button
          style={{ float: "right" }}
          title="Save current settings as default"
          onClick={e => {
            setDefaultReplaceVar(JSON.stringify(state.replace_variables));
            setDefaultSettings(JSON.stringify({
              model: state.openai_payload.model,
              temperature: state.openai_payload.temperature,
              top_p: state.openai_payload.top_p,
              max_tokens: state.openai_payload.max_tokens,
              presence_penalty: state.openai_payload.presence_penalty,
              frequency_penalty: state.openai_payload.frequency_penalty,
              stop: state.openai_payload.stop,
            }));
            e.target.classList.add('done');
            setTimeout(() => e.target.classList.remove('done'), 1000);
          }}
        >💾</button>
      </h2>

      <label>Model<InfoLabel href="https://platform.openai.com/docs/models/overview" /></label>
      <OpenAI.ModelDropdown
        model={state.openai_payload.model}
        setModel={m => setPayloadKey('model', m)}
      />

      <label>Temperature<InfoLabel href="temperature" /></label>
      <NumberInput
        number={state.openai_payload.temperature}
        setNumber={v => setPayloadKey('temperature', v)}
      />

      <label>Top P<InfoLabel href="top_p" /></label>
      <NumberInput
        number={state.openai_payload.top_p}
        setNumber={v => setPayloadKey('top_p', v)}
      />

      <label>Max. Tokens<InfoLabel href="max_tokens" /></label>
      <NumberInput
        placeholder="Infinite"
        number={state.openai_payload.max_tokens}
        setNumber={v => setPayloadKey('max_tokens', v)}
      />

      <FunctionCallSelector
        functions={state.openai_payload.functions}
        functionCall={state.openai_payload.function_call}
        setFunctionCall={v => setPayloadKey('function_call', v)}
      />

      <label>Presence Penalty<InfoLabel href="presence_penalty" /></label>
      <NumberInput
        number={state.openai_payload.presence_penalty}
        setNumber={v => setPayloadKey('presence_penalty', v)}
      />

      <label>Frequency Penalty<InfoLabel href="frequency_penalty" /></label>
      <NumberInput
        number={state.openai_payload.frequency_penalty}
        setNumber={v => setPayloadKey('frequency_penalty', v)}
      />

      <label>Stop sequences<InfoLabel href="stop" /></label>
      <small>One per line. Max 4.</small>
      <StopSequences
        stopSequences={state.openai_payload.stop}
        setStopSequences={v => setPayloadKey('stop', v)}
      />

      <h3>Preload state</h3>
      <p>
        Preload the state by hex encoding the state JSON object in the URL
        fragment. Get an example of JSON state by clicking "Save to" button. You
        can optionally gzip the JSON before hex encoding it. Instead of 0-9a-f
        characters in hex encoding, you can use a-p.
      </p>
    </div >

    {showAPIKeyModal && <APIKeyModal
      apiKey={apiKey}
      onSave={v => {
        setAPIKey(v)
        setShowAPIKeyModal(false);
      }}
      onCancel={() => setShowAPIKeyModal(false)}
    />
    }

    <WindowHash state={state} defaultState={defaultState} loadState={loadState} />
  </>
}
