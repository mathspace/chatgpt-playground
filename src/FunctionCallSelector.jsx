import { useCallback } from "react";
import InfoLabel from "./InfoLabel.jsx";

export function FunctionCallSelector({ apiType, functions, functionCall, setFunctionCall }) {

  let value = functionCall;
  if (value === undefined) {
    value = "default";
  } else if (value.name !== undefined) {
    value = `custom-${value.name}`;
  }

  const setType = useCallback(e => {
    const v = e.target.value;
    if (v === 'default') {
      setFunctionCall(undefined);
    } else if (v.startsWith('custom-')) {
      setFunctionCall({ name: v.replace(/^custom-/, '') });
    } else {
      setFunctionCall(v);
    }
  }, [setFunctionCall]);

  return <><label>Function Call<InfoLabel href="function_call" apiType={apiType} /></label>
    <select onChange={setType} value={value}>
      <option value="default">
        Default ({functions ? "Auto" : "None"})
      </option>
      <option value="none">None</option>
      <option value="auto">Auto</option>
      {functions && <>
        <option disabled>Custom</option>
        {functions.map(f => f.name).sort().map(f => <option key={`custom-${f}`} value={`custom-${f}`}>{f}</option>)}
      </>
      }
    </select>
  </>;
}
