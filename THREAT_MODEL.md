# chatgpt-playground threat model

## Overview

Public browser-only React playground builds into out/ or runs esbuild development serving; browser sends edited/shared prompts directly to OpenAI Chat Completions or Responses, or locally configured compatible endpoints. Optional Python function calls execute through a browser Pyodide worker (package.json:4; src/OpenAIRequest.js:505; src/CodeRunner.jsx:46).

| Component / resource | Source |
| --- | --- |
| API POST | src/App.jsx:214; src/OpenAIRequest.js:5; src/OpenAIRequest.js:34; src/OpenAIRequest.js:505 |
| Python executor | src/Messages.jsx:373; src/CodeRunner.jsx:54; pyodide-worker.js:1; pyodide-worker.js:20 |

| Deployment or workflow | Resource or capability | Configuration and precedence | Safe effective value or location | Readers, writers, or recipients | Enforcing control | Evidence or unknowns |
| --- | --- | --- | --- | --- | --- | --- |
| static and development browser | API POST | LocalStorage preferences -> API-type selection -> URL validation -> fetch | https://api.openai.com/v1/chat/completions or https://api.openai.com/v1/responses by default; configured validated URL otherwise | Chosen API host receives bearer key and prompts | URL validation plus explicit endpoint setting; browser transport/origin controls | src/App.jsx:214; src/OpenAIRequest.js:5; src/OpenAIRequest.js:34; src/OpenAIRequest.js:505 |
| every browser page session; optional later Python calls | Executable runtime supply and Python executor | App imports CodeRunner -> module-level worker construction -> importScripts/loadPyodide immediately; later function arguments -> worker.postMessage -> runPythonAsync | ./pyodide-worker.js; runtime CDN https://cdn.jsdelivr.net/pyodide/v0.26.4/full/pyodide.js | jsDelivr supplies executable worker code and receives startup requests even when Code Runner is disabled; later Python and package activity enter that runtime; stdout re-enters transcript | HTTPS and versioned URL; worker cancellation, but no integrity check or repository network-denial policy | src/App.jsx:19; src/CodeRunner.jsx:44-47; pyodide-worker.js:1-9; pyodide-worker.js:19-20 |
| npm install/build and deployed page | Executable package/build supply | package.json dependencies plus package-lock.json; npm run build invokes npx esbuild and bundles imported packages into out/main.js | React, react-markdown, Mermaid and transitive code; esbuild build tool; built out/ files delivered by the hosting workflow | Package/build suppliers execute with build-host authority; bundled code executes in page origin and can access localStorage API key and prompts | Lockfile resolved versions/integrity constrain selected package bytes when honored, not supplier trust; preserve the lock with reproducible installation, review updates and bind deployed bytes to the reviewed build. Live build/deployment enforcement is external | package.json:4; package.json:8; package.json:20; package-lock.json; src/App.jsx:46 |

## Threat Model, Trust Boundaries, and Assumptions

### Protected assets

- User API credential and paid API quota; local origin storage holds chatgpt-playground-api-key and endpoint preferences (src/App.jsx:46; src/App.jsx:214).
- Prompt/transcript, variables and exported/share-link state; browser origin integrity and generated Python execution (src/App.jsx:158; src/Messages.jsx:364).

### Security objectives

- Require informed credential-recipient selection, including imported API-type changes; protect browser origin and share/export confidentiality. Endpoint URLs and key are stored separately, but imported state currently selects between those recipients (src/App.jsx:214-245; src/OpenAIRequest.js:969-998).
- Keep Python capability explicit and distinguish browser execution from server/OS authority; bound work and permit cancellation (src/CodeRunner.jsx:58).

### Actors and capabilities

- A link/file author can supply prompt state and autorun flags; model/provider can return content or Python arguments. They do not inherently own localStorage credentials or host filesystem authority (src/App.jsx:158; src/Messages.jsx:373).

### Trust boundaries

- Shared/imported state receives limited invariant checks, may request autorun, and can specify messages/functions and api_type. Checks cover vars/API type, system-message placement, duplicate function names, logit-bias keys and one response-format case; they do not enforce a complete message/function/state schema (src/App.jsx:51-65; src/OpenAI.jsx:271-306). State cannot supply endpoint URLs or the key directly, but api_type selects the separately stored Completions or Responses URL; autorun can send to that recipient without reopening the endpoint warning (src/App.jsx:158-180; src/App.jsx:214-245; src/OpenAIRequest.js:969-998).
- Browser POST sends bearer credential and payload to chosen URL. HTTPS required except named loopback/development hosts; embedded URL credentials rejected. Any HTTPS recipient can be configured; UI explicitly warns the key is sent there (src/OpenAIRequest.js:34; src/OpenAIRequest.js:505; src/APIEndpointModal.jsx:58).
- run_python_code is a real execution capability: the completion effect automatically runs a final returned call with parseable, nonempty code after successful request completion, without checking the Code Runner checkbox. Imported Responses state can omit legacy functions and supply tools in the supported nested function shape plus tool_choice naming run_python_code; the translator forwards these while the checkbox checks only functions, so Python can execute with the checkbox unchecked. Supplying both functions and tools is rejected, and function_call takes precedence over tool_choice (src/App.jsx:299; src/App.jsx:357-358; src/OpenAIRequest.js:272-300; src/OpenAIRequest.js:468-489; src/OpenAIRequest.js:640-650; src/Messages.jsx:364-375; src/CodeRunner.jsx:31-38); ordinary function definitions are schemas/manual results, not arbitrary installed server tools. Worker construction and CDN Pyodide initialization happen at module load in every page session even with Code Runner disabled; later execution loads packages derived from imports and calls runPythonAsync; browser worker isolation is not host process execution or a separate network-denial sandbox (src/Messages.jsx:364; src/CodeRunner.jsx:2; pyodide-worker.js:1; pyodide-worker.js:19).

### Assumptions and open questions

- Public-repository model uses own source and generic operator duties only. Actual hosting headers/access controls are external to this static build (package.json:4).
- Responses defaults store=false, but imported openai_payload.store=true passes the limited validation and overrides that default in the transmitted request. An autorunning import with a usable key and a provider that honors this setting can therefore request provider storage of submitted content; actual retention remains provider-controlled. Require deliberate consent for imported storage changes to meet the confidentiality objective. This setting does not control local/export retention (src/App.jsx:51-65; src/App.jsx:174-180; src/OpenAI.jsx:271-306; src/OpenAIRequest.js:390; src/OpenAIRequest.js:411-415; src/OpenAIRequest.js:431; src/OpenAIRequest.js:769-780).
- Offline architecture mapping of the supplied revision; not completed vulnerability-audit coverage. No application execution or deployment verification.

## Attack Surface, Mitigations, and Attacker Stories

These are threat hypotheses, not validated vulnerabilities. Priority reflects plausible impact; deployment and attacker prerequisites must be established before assigning a finding severity.

| Priority | Scenario and capability gain | Prerequisites | Impact | Existing controls | Mitigation | Evidence |
| --- | --- | --- | --- | --- | --- | --- |
| P1 | Shared state induces generation and Python execution, including Responses tools hidden from the Code Runner checkbox. | Victim imports/opens attacker-authored autorun state with a usable API key; Responses tools define run_python_code without legacy functions, optional tool_choice requests it, and the provider successfully returns it as the last message with parseable, nonempty code; Pyodide initializes. | Paid requests, unintended browser-worker execution or network activity, even with Code Runner unchecked. | Limited invariant checks; URL/key held separately but imported api_type selects the URL; functions/tools conflict rejected; checkbox reflects functions only and does not authorize execution; cancel terminates worker. | Require deliberate Python execution consent at the executor independently of autorun and imported function/tool definitions; make effective tools visible. | src/App.jsx:174-180; src/App.jsx:230-245; src/App.jsx:299; src/OpenAIRequest.js:272-300; src/OpenAIRequest.js:468-489; src/OpenAIRequest.js:640-650; src/Messages.jsx:335-375; src/CodeRunner.jsx:31-54; pyodide-worker.js:11-20 |
| P1 | Configured API recipient obtains user credential and transcript. | Victim has configured an untrustworthy endpoint, or an attacker controls origin preferences; an imported autorunning api_type can select either previously configured endpoint without changing its URL. | Disclosure of bearer key and submitted content. | Endpoint validator disallows embedded credentials and most plain HTTP; UI warns about key recipient. | Keep the selected endpoint visible and require informed recipient confirmation for imported API-type/autorun changes before transferring credentials; protect origin/storage integrity. | src/APIEndpointModal.jsx:58; src/OpenAIRequest.js:34; src/OpenAIRequest.js:505 |
| P1 (conditional) | A compromised jsDelivr runtime supplies hostile worker code; an unavailable runtime prevents Python initialization. | Every page session initializes the worker; impact beyond initialization depends on supplier compromise and later execution. | Runtime supplier can observe or alter later Python inputs/results and use worker network capabilities; unavailability disrupts Python features, not a demonstrated whole-app outage. | HTTPS, versioned runtime URL, worker boundary and cancellation; no integrity check. | Load runtime only when requested and consider reviewed self-hosted assets or integrity verification; keep supplier authority distinct from optional Python consent. | src/App.jsx:19; src/CodeRunner.jsx:44-47; pyodide-worker.js:1-9 |
| P2 | Generated content crosses Markdown/Mermaid rendering boundary. | Provider or shared transcript contains hostile content and a renderer permits active content. | Browser-origin compromise could expose local key or alter subsequent requests. | React/renderer behavior; Mermaid owns SVG generation rather than a generic application eval. | Retain restrictive renderer configuration and treat generated SVG/links as untrusted; validate dependency guarantees before claiming execution. | src/Mermaid.jsx:78; src/App.jsx:214 |
| P2 | Python/import or shared-state workload consumes excessive client resources. | Victim chooses supplied state/code or receives executable function output. | Browser hangs, excess requests or package downloads; no demonstrated server-wide outage. | URL-share encoding/size validation only; clipboard JSON is parsed and passed to loadState without an application byte/character limit; worker termination; Responses serializes tool calls. | Apply execution/time/package limits where feasible and preserve cancellation; do not equate a Web Worker with network isolation. | src/AppStateCodec.js:52; src/Clipboard.jsx:32-36; src/Clipboard.jsx:58-65; src/App.jsx:318; src/CodeRunner.jsx:58; pyodide-worker.js:19; src/OpenAIRequest.js:478 |

The npm/build boundary is separate from the runtime CDN: a compromised accepted dependency or esbuild tool can contaminate the static bundle before publication; deployed package code then executes with page-origin access to the stored credential and prompt data. This requires malicious supplier/update/build input reaching an operator build, not mere model content. Preserve and verify locked package integrity, review dependency/tool changes, and bind published assets to the reviewed source/build; a lockfile does not prove the locked code is trustworthy (package.json:4, package.json:8, package.json:20, package-lock.json, src/App.jsx:46).

## Severity Calibration (Critical, High, Medium, Low)

| Level | Example | Counterexample or limiting prerequisite |
| --- | --- | --- |
| Critical | Only if a demonstrated browser or runtime escape reaches broad high-value authority. | No such escape or server/OS executor is established; ordinary worker Python is not Critical. |
| High | A rendering/execution boundary failure exposes another user’s API credential or private transcripts. | Configuring one’s own endpoint intentionally or running one’s own Python is authorized behavior. |
| Medium | Untrusted imported state causes meaningful unauthorized paid generation or persistent client disruption. | Impact requires import/open and configured key; tiny self-only requests may be Low. |
| Low | Recoverable local rendering or format failure with no confidentiality or authority gain. | A proven credential disclosure must not be reduced to cosmetic UI impact. |

Confidence in source-established architecture is separate from confidence in live deployment or exploitability. This model incorporates an independent source architecture pass and direct reconciliation of material consumers. No application execution or live service/security configuration validation was performed. Revisit the model when the documented entry points, data recipients, permissions or deployment paths change.

Repository: github.com/mathspace/chatgpt-playground
Version: f82422b8ab6d0e9593e6a079e4a190e7ae6588eb
