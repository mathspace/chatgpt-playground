import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
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
import LogitBiasSet from './LogitBias.jsx';
import { APIEndpointModal } from './APIEndpointModal.jsx';
import { ResponseFormatSelector } from './ResponseFormatSelector.jsx';
import { codeRunnerFuncDefined, mergeCodeRunnerFuncDef } from './CodeRunner.jsx';
import { applyResponseDelta } from './ResponseState.js';

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
const completionURLLocalStorageKey = "chatgpt-playground-completion-url";
const responsesURLLocalStorageKey = "chatgpt-playground-responses-url";
const defaultAPITypeLocalStorageKey = "chatgpt-playground-default-api-type";

const validateState = (() => {
  const validate = OpenAI.createValidator();
  return v => {
    if (typeof v.vars !== 'object' && v.vars !== undefined) {
      throw new Error("vars must be object/undefined.");
    }
    if (
      v.api_type != null &&
      v.api_type !== "" &&
      !OpenAI.apiTypes.includes(v.api_type)
    ) {
      throw new Error(`Unknown API type "${v.api_type}".`);
    }
    validate(v.openai_payload);
  };
})();

const baseDefaultSetting = {
  model: "gpt-4o",
  temperature: 0.7,
  top_p: 1,
  stream: true,
};

export default function App() {

  const [defaultSettings, setDefaultSettings] = useLocalStorage("chatgpt-playground-default-settings", JSON.stringify(baseDefaultSetting));
  const [defaultReplaceVar, setDefaultReplaceVar] = useLocalStorage("chatgpt-playground-default-replace-var", "true");
  const [defaultAPIType, setDefaultAPIType] = useLocalStorage(
    defaultAPITypeLocalStorageKey,
    OpenAI.chatCompletionsAPI
  );
  const defaultState = {
    api_type: OpenAI.apiTypes.includes(defaultAPIType)
      ? defaultAPIType
      : OpenAI.chatCompletionsAPI,
    openai_payload: {
      ...(() => {
        try {
          return JSON.parse(defaultSettings);
        } catch (e) {
          return baseDefaultSetting;
        }
      })(),
      messages: [{
        role: "system",
        content: "",
      }],
    },
    markdown: false,
    replace_variables: (() => {
      try {
        // There was a bug where we stored undefined for true value so we need
        // to treat this special.
        if (defaultReplaceVar === "undefined") {
          return true;
        }
        // We only want true to set replaceVar to true, not non-empty strings,
        // positive numbers, etc.
        return JSON.parse(defaultReplaceVar) === true;
      } catch (e) {
        return false;
      }
    })(),
    vars: {},
  };

  const [widescreen, setWidescreen] = useState(false);
  const [state, unvalidatedSetState] = useState(defaultState);
  state.openai_payload.stream = state.openai_payload.stream ?? true;

  let renderedPayload = useMemo(() => {
    let ret = state.openai_payload;
    if (state.replace_variables) {
      ret = Vars.sub(ret, state.vars);
    }
    return ret;
  }, [state.openai_payload, state.replace_variables, state.vars])

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
      if (s.replace_variables === undefined) {
        s.replace_variables = true;
      }
      if (s.vars === undefined) {
        s.vars = {};
      }
      const autorun = s.autorun || false;
      // Remove autorun from the state so that we don't save it.
      delete s.autorun;
      validateState(s);
      unvalidatedSetState(s);
      if (autorun) {
        setSubmitTriggered(true);
      }
      return true;
    } catch (e) {
      alert("Load failed: " + JSON.stringify(e));
      return false;
    }
  });

  const systemRef = useRef(null);
  useEffect(() => {
    systemRef.current.focus();
  }, []);

  const dataCallback = useCallback(async (data) => {
    if (!data) {
      setRequestStatus("completed");
      return;
    }
    if (data.usage) {
      setUsageStats(data.usage);
    }
    const delta = data.delta || data.message;
    if (delta) {
      setPayloadKey('messages', msgs => {
        return applyResponseDelta(msgs, delta);
      });
    }
    if (data.finish_reason && data.finish_reason != "stop" && data.finish_reason != "function_call") {
      setStopReason("stopped reason: " + data.finish_reason);
      return
    }
  });

  const [apiKey, setAPIKey] = useLocalStorage(apiKeyLocalStorageKey, "");
  const [completionURL, setCompletionURL] = useLocalStorage(completionURLLocalStorageKey, OpenAI.openAICompletionURL);
  const [responsesURL, setResponsesURL] = useLocalStorage(responsesURLLocalStorageKey, OpenAI.openAIResponsesURL);
  const [openAIRequest, setOpenAIRequest] = useState(null);
  const [requestStatus, setRequestStatus] = useState("idle");
  const [stopReason, setStopReason] = useState('');
  const [usageStats, setUsageStats] = useState(null);
  const apiType = OpenAI.normalizeAPIType(state.api_type);
  const showSamplingControls =
    apiType === OpenAI.chatCompletionsAPI ||
    OpenAI.supportsResponsesSamplingControls(
      state.openai_payload.model,
      state.openai_payload.reasoning_effort
    );
  const submit = useCallback(async () => {
    if (!apiKey) {
      setStopReason('set API key & try again');
      setShowAPIKeyModal(true);
      return;
    }
    setUsageStats(null);
    setStopReason('');
    setRequestStatus("pending");
    try {
      const req = OpenAI.createRequest({
        apiKey,
        payload: renderedPayload,
        dataCallback,
        apiType,
        completionURL,
        responsesURL,
      });
      setOpenAIRequest(req);
      await req.send();
    } catch (e) {
      if (e?.name === "AbortError") {
        setRequestStatus("cancelled");
      } else {
        setRequestStatus("failed");
        setStopReason(e + '');
      }
    } finally {
      setOpenAIRequest(null);
    }
  }, [apiKey, renderedPayload, apiType, completionURL, responsesURL, dataCallback]);

  const cancel = useCallback(() => {
    if (openAIRequest) {
      openAIRequest.cancel();
    }
  }, [openAIRequest]);

  const [submitTriggered, setSubmitTriggered] = useState(false);
  useEffect(() => {
    if (submitTriggered) {
      setSubmitTriggered(false);
      submit();
    }
  }, [submitTriggered, submit]);

  const [showAPIKeyModal, setShowAPIKeyModal] = useState(false);
  const [showAPIEndpointModal, setShowAPIEndpointModal] = useState(false);

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

  const codeRunnerActive = useMemo(() => codeRunnerFuncDefined(state.openai_payload.functions), [state.openai_payload.functions]);

  const streaming = Boolean(openAIRequest);

  const [autorun, setAutorun] = useState(false);

  return <div id="app-container" className={(widescreen ? 'widescreen' : '')}>
    <div className="app column system">

      <AutoExtendingTextarea
        rows="1"
        placeholder="Untitled ChatGPT Playground Session"
        className="titleBox"
        value={state.title || ''}
        onInput={setTitle}
      />
      <div className="saveBox">
        <button onClick={() => open(window.location.href.split('#')[0])}>New</button>
        &nbsp;|&nbsp;
        <LoadButton enabled={!streaming} setAppState={loadState}>Load from</LoadButton>
        &nbsp;/&nbsp;
        <SaveButton appState={{ ...state, autorun }}>Save to</SaveButton>
        &nbsp;/&nbsp;
        <CopyLinkButton appState={{ ...state, autorun }}>Copy link to</CopyLinkButton>
        &nbsp;clipboard.
        <span style={{ color: "#888", fontStyle: "italic" }} title="Tick to auto-submit the prompt after loading a saved document.">
          &nbsp;—&nbsp;
          <label htmlFor="autorun">with auto-run</label>
          <input
            id="autorun"
            type="checkbox"
            checked={autorun}
            onChange={e => setAutorun(e.target.checked)}
          />
        </span>
      </div>

      <h2>System Prompt<InfoLabel href="messages" apiType={apiType} /></h2>
      <div className="prompt">
        <AutoExtendingTextarea
          ref={systemRef}
          onInput={e => setSystemPrompt(e.target.value)}
          value={state.openai_payload.messages[0].content || ''}
        />
      </div>

      <h2>
        Functions<InfoLabel
          href="functions"
          apiType={apiType}
          responsesHref="https://developers.openai.com/api/docs/guides/function-calling"
        />
        <span style={{ float: "right", fontSize: "1rem", fontWeight: "normal" }}>
          <label htmlFor="enable-code-runner"> Code Runner</label>
          <input
            id="enable-code-runner"
            type="checkbox"
            title="Enable"
            onChange={e => setPayloadKey('functions', fs => mergeCodeRunnerFuncDef(fs, !e.target.checked))}
            checked={codeRunnerActive}
            style={{ marginLeft: "0.5em" }}
          /> <span style={{ color: "#ccc", marginLeft: "0.5em", marginRight: "0.5em" }}>|</span>
          <a
            onClick={() => alert("Defines a function to use python environment to run code on behalf of the LLM.")}
            style={{ cursor: "pointer", textDecoration: "none", verticalAlign: "middle" }}>ⓘ</a>
        </span>
      </h2>
      <p><i>Not all models support functions.</i></p>
      <div>
        <Functions
          functions={state.openai_payload.functions}
          setFunctions={fs => setPayloadKey('functions', fs)}
        />
      </div>

      <h2>
        <label htmlFor="enable-variables">Variables</label>
        <input
          id="enable-variables"
          type="checkbox"
          title="Enable"
          onChange={e => setState(s => ({ ...s, replace_variables: e.target.checked }))}
          checked={state.replace_variables}
          style={{ marginLeft: "1em", verticalAlign: "middle" }}
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
      <label htmlFor="wide-screen" title="Expand messages to fill the screen">
        <input id="wide-screen" type="checkbox" onChange={e => setWidescreen(e.target.checked)} />
      </label>
      <h2>
        Messages<InfoLabel href="messages" apiType={apiType} />
      </h2>
      <Messages
        messages={state.openai_payload.messages.slice(1)}
        setMessages={setMessages}
        streaming={streaming}
        stopReason={stopReason}
        onSubmit={submit}
        triggerSubmit={() => setSubmitTriggered(true)}
        onCancel={cancel}
        markdown={!!state.markdown}
        renderMath={!!state.render_math}
        renderDiagrams={!!state.render_diagrams}
        usageStats={usageStats}
        requestStatus={requestStatus}
      />
    </div>

    <div className="app column knobs">
      <button className="open-api-key" onClick={() => setShowAPIKeyModal(true)} title="Set API Key">🔑</button>
      <button className="open-completion-url" onClick={() => setShowAPIEndpointModal(true)} title="Set API Endpoints">🌐</button>

      <h2 style={{ paddingTop: "1em", clear: "both" }}>Settings
        <button
          style={{ float: "right" }}
          title="Save current settings as default"
          onClick={e => {
            setDefaultAPIType(apiType);
            setDefaultReplaceVar(JSON.stringify(state.replace_variables || false));
            setDefaultSettings(JSON.stringify({
              model: state.openai_payload.model,
              temperature: state.openai_payload.temperature,
              top_p: state.openai_payload.top_p,
              max_tokens: state.openai_payload.max_tokens,
              presence_penalty: state.openai_payload.presence_penalty,
              frequency_penalty: state.openai_payload.frequency_penalty,
              stream: state.openai_payload.stream,
              stop: state.openai_payload.stop,
              response_format: state.openai_payload.response_format,
              reasoning_effort: state.openai_payload.reasoning_effort,
            }));
            e.target.classList.add('done');
            setTimeout(() => e.target.classList.remove('done'), 1000);
          }}
        >💾</button>
      </h2>

      <label>API<InfoLabel href="https://developers.openai.com/api/docs/guides/migrate-to-responses" /></label>
      <OpenAI.APITypeDropdown
        apiType={apiType}
        setAPIType={v => setState(s => ({ ...s, api_type: v }))}
      />

      <label>Model<InfoLabel href="https://platform.openai.com/docs/models/overview" /></label>
      <OpenAI.ModelDropdown
        model={state.openai_payload.model}
        setModel={m => setPayloadKey('model', m)}
      />

      {showSamplingControls ? <>
        <label>Temperature<InfoLabel href="temperature" apiType={apiType} /></label>
        <NumberInput
          number={state.openai_payload.temperature}
          setNumber={v => setPayloadKey('temperature', v)}
        />

        <label>Top P<InfoLabel href="top_p" apiType={apiType} /></label>
        <NumberInput
          number={state.openai_payload.top_p}
          setNumber={v => setPayloadKey('top_p', v)}
        />
      </> : null}

      {apiType === OpenAI.chatCompletionsAPI ? <>
        <label>Seed<InfoLabel href="seed" /></label>
        <NumberInput
          number={state.openai_payload.seed}
          setNumber={v => setPayloadKey('seed', v)}
        />
      </> : null}

      <label>Max. Tokens<InfoLabel href="max_tokens" apiType={apiType} /></label>
      <NumberInput
        placeholder="Infinite"
        number={state.openai_payload.max_tokens}
        setNumber={v => setPayloadKey('max_tokens', v)}
      />

      <ResponseFormatSelector
        apiType={apiType}
        responseFormat={state.openai_payload.response_format}
        setResponseFormat={v => setPayloadKey('response_format', v)}
      />

      <FunctionCallSelector
        apiType={apiType}
        functions={state.openai_payload.functions}
        functionCall={state.openai_payload.function_call}
        setFunctionCall={v => setPayloadKey('function_call', v)}
      />

      {apiType === OpenAI.chatCompletionsAPI ? <>
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
      </> : null}

      <label>Reasoning Effort<InfoLabel href="reasoning_effort" apiType={apiType} /></label>
      <OpenAI.ReasoningEffortDropdown
        effort={state.openai_payload.reasoning_effort}
        setEffort={v => setPayloadKey('reasoning_effort', v)}
      />

      {apiType === OpenAI.chatCompletionsAPI ? <>
        <label>Stop sequences<InfoLabel href="stop" /></label>
        <small>One per line. Max 4.</small>
        <StopSequences
          stopSequences={state.openai_payload.stop}
          setStopSequences={v => setPayloadKey('stop', v)}
        />
      </> : null}

      <label htmlFor="stream" title="Stream the response">
        Stream
        <input id="stream" type="checkbox" style={{ float: "right" }}
          onChange={e => setPayloadKey('stream', e.target.checked)}
          checked={state.openai_payload.stream}
        />
      </label>

      <label htmlFor="render-markdown" title="Render assistant messages as markdown">
        Render Markdown
        <input id="render-markdown" type="checkbox" style={{ float: "right" }}
          onChange={e => setState(s => ({ ...s, markdown: e.target.checked }))}
          checked={!!state.markdown}
        />
      </label>

      {
        state.markdown &&
        <>
          <label htmlFor="render-math">
            Render Math
            <input id="render-math" type="checkbox" style={{ float: "right" }}
              onChange={e => setState(s => ({ ...s, render_math: e.target.checked }))}
              checked={!!state.render_math}
            />
          </label>
          <label htmlFor="render-diagrams" title="Render Mermaid code blocks as diagrams">
            Render Diagrams
            <input id="render-diagrams" type="checkbox" style={{ float: "right" }}
              onChange={e => setState(s => ({ ...s, render_diagrams: e.target.checked }))}
              checked={!!state.render_diagrams}
            />
          </label>
        </>
      }

      {apiType === OpenAI.chatCompletionsAPI ? <>
        <label>Logit Bias<InfoLabel href="logit_bias" /></label>
        <LogitBiasSet
          logitBiasSet={state.openai_payload.logit_bias}
          setLogitBiasSet={v => setPayloadKey('logit_bias', v)}
        />
      </> : null}

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

    {showAPIEndpointModal && <APIEndpointModal
      completionURL={completionURL}
      responsesURL={responsesURL}
      onSave={endpoints => {
        setCompletionURL(endpoints.completionURL);
        setResponsesURL(endpoints.responsesURL);
        setShowAPIEndpointModal(false);
      }}
      onCancel={() => setShowAPIEndpointModal(false)}
    />
    }

    <WindowHash state={state} setState={setState} defaultState={defaultState} loadState={loadState} />
  </div>
}
