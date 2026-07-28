
export const codeRunnerFunctionName = 'run_python_code';

export function mergeCodeRunnerFuncDef(func_defs, remove) {
  func_defs = func_defs || [];
  func_defs = func_defs.filter(f => f.name !== codeRunnerFunctionName);
  if (!remove) {
    func_defs.push({
      name: codeRunnerFunctionName,
      description: "Runs python code. Uses Pyodide runtime. Following libs are installed: scipy, requests, matplotlib, numpy. Use aggressively.",
      parameters: {
        type: "object",
        required: ["code"],
        properties: {
          code: {
            type: "string",
            description: "Module body. MUST print the result to standard output using print."
          }
        },
        additionalProperties: false
      }
    })
  }
  return func_defs.length == 0 ? undefined : func_defs;
}

export function codeRunnerFuncDefined(func_defs) {
  return !!func_defs?.some(f => f.name === codeRunnerFunctionName);
}

export function getCodeRunnerFunctionCallCode(msg) {
  const fnCall = msg.function_call;
  if (fnCall?.name !== codeRunnerFunctionName) return;
  try {
    return JSON.parse(fnCall.arguments).code;
  } catch (e) {
    return;
  }
}

// Maintain a single worker for all python runs.
// If a run is interrupted, terminate the worker and create a new one.

let pyodideWorker = newPyodideWorker();

function newPyodideWorker() {
  const worker = new Worker("./pyodide-worker.js");
  let callbacks = [];

  const w = {
    terminated: false,
    add: ({ script, onDone }) => {
      callbacks.push(onDone);
      worker.postMessage({ script });
    }
  };

  w.terminate = (error, notify = true) => {
    if (w.terminated) return;
    w.terminated = true;
    worker.terminate();
    if (notify) {
      callbacks.forEach(c => c(`TERMINATED${error ? ' - ' + error : ''}`));
    }
    callbacks = [];
  };

  worker.onmessage = (event) => {
    if (w.terminated) return;
    if (callbacks.length === 0) {
      // This should not happen.
      w.terminate();
      return;
    }
    callbacks.shift()(event.data.output);
  };

  worker.onerror = (e) => { w.terminate(new String(e)); };

  return w;
}

export function runPython(script, onDone) {
  if (pyodideWorker.terminated) {
    pyodideWorker = newPyodideWorker();
  }
  pyodideWorker.add({ script, onDone });
  return {
    terminate: () => {
      pyodideWorker.terminate(undefined, false);
    },
  }
}
