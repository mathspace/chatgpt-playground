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
| browser worker | Python executor | completion function arguments -> runCode -> worker.postMessage -> runPythonAsync | ./pyodide-worker.js; runtime CDN https://cdn.jsdelivr.net/pyodide/v0.26.4/full/pyodide.js | Worker runtime and package/CDN recipients; returned stdout re-enters transcript | Worker termination/cancel; no repository network-denial policy | src/Messages.jsx:373; src/CodeRunner.jsx:54; pyodide-worker.js:1; pyodide-worker.js:20 |

## Threat Model, Trust Boundaries, and Assumptions

### Protected assets

- User API credential and paid API quota; local origin storage holds chatgpt-playground-api-key and endpoint preferences (src/App.jsx:46; src/App.jsx:214).
- Prompt/transcript, variables and exported/share-link state; browser origin integrity and generated Python execution (src/App.jsx:158; src/Messages.jsx:364).

### Security objectives

- Preserve credential-recipient selection independently of imported prompt data; protect browser origin and share/export confidentiality.
- Keep Python capability explicit and distinguish browser execution from server/OS authority; bound work and permit cancellation (src/CodeRunner.jsx:58).

### Actors and capabilities

- A link/file author can supply prompt state and autorun flags; model/provider can return content or Python arguments. They do not inherently own localStorage credentials or host filesystem authority (src/App.jsx:158; src/Messages.jsx:373).

### Trust boundaries

- Shared/imported state is schema-validated, may request autorun, and can specify messages/functions. It does not own separately stored endpoint/key preferences (src/App.jsx:158; src/App.jsx:174; src/App.jsx:214).
- Browser POST sends bearer credential and payload to chosen URL. HTTPS required except named loopback/development hosts; embedded URL credentials rejected. Any HTTPS recipient can be configured; UI explicitly warns the key is sent there (src/OpenAIRequest.js:34; src/OpenAIRequest.js:505; src/APIEndpointModal.jsx:58).
- run_python_code is a real execution capability: completion effect automatically runs returned code; ordinary function definitions are schemas/manual results, not arbitrary installed server tools. Worker loads CDN Pyodide, packages derived from imports, and runPythonAsync; browser worker isolation is not host process execution or a separate network-denial sandbox (src/Messages.jsx:364; src/CodeRunner.jsx:2; pyodide-worker.js:1; pyodide-worker.js:19).

### Assumptions and open questions

- Public-repository model uses own source and generic operator duties only. Actual hosting headers/access controls are external to this static build (package.json:4).
- Responses defaults store=false; this controls provider request behavior, not local/export retention (src/OpenAIRequest.js:431).
- Offline architecture mapping of the supplied revision; not completed vulnerability-audit coverage. No application execution or deployment verification.

## Attack Surface, Mitigations, and Attacker Stories

These are threat hypotheses, not validated vulnerabilities. Priority reflects plausible impact; deployment and attacker prerequisites must be established before assigning a finding severity.

| Priority | Scenario and capability gain | Prerequisites | Impact | Existing controls | Mitigation | Evidence |
| --- | --- | --- | --- | --- | --- | --- |
| P1 | Shared state induces generation and Python execution under an existing user configuration. | Victim imports/opens attacker-authored state with autorun and has a usable configured API key; returned Python call reaches completion effect. | Paid requests, unintended browser-worker execution or network activity. | State schema validation; endpoint/key held separately; cancel terminates worker. | Treat imported autorun and enabled Python as distinct capabilities; require deliberate execution consent or disable for untrusted state. | src/App.jsx:158; src/App.jsx:174; src/Messages.jsx:364; src/CodeRunner.jsx:58 |
| P1 | Configured API recipient obtains user credential and transcript. | Victim explicitly configures an untrustworthy HTTPS endpoint or an attacker first controls origin preferences. | Disclosure of bearer key and submitted content. | Endpoint validator disallows embedded credentials and most plain HTTP; UI warns about key recipient. | Keep endpoint provenance visible and validate the recipient before transferring credentials; protect origin/storage integrity. | src/APIEndpointModal.jsx:58; src/OpenAIRequest.js:34; src/OpenAIRequest.js:505 |
| P2 | Generated content crosses Markdown/Mermaid rendering boundary. | Provider or shared transcript contains hostile content and a renderer permits active content. | Browser-origin compromise could expose local key or alter subsequent requests. | React/renderer behavior; Mermaid owns SVG generation rather than a generic application eval. | Retain restrictive renderer configuration and treat generated SVG/links as untrusted; validate dependency guarantees before claiming execution. | src/Mermaid.jsx:78; src/App.jsx:214 |
| P2 | Python/import or shared-state workload consumes excessive client resources. | Victim chooses supplied state/code or receives executable function output. | Browser hangs, excess requests or package downloads; no demonstrated server-wide outage. | Share encoding/size validation and worker termination; Responses serializes tool calls. | Apply execution/time/package limits where feasible and preserve cancellation; do not equate a Web Worker with network isolation. | src/AppStateCodec.js:52; src/CodeRunner.jsx:58; pyodide-worker.js:19; src/OpenAIRequest.js:478 |

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
