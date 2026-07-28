import "./Vars.css";
import AutoExtendingTextarea from "./AutoExtendingTextarea";
import { sub } from "./VariableSubstitution.js";

export { sub } from "./VariableSubstitution.js";

export function Vars({ openai_payload, appVars, setAppVars }) {
  const vars = new Set();
  sub(openai_payload, v => vars.add(v));

  return <div>
    {[...vars].sort().map(v =>
      <div key={v}>
        <label className="var-name">{v}</label>
        <AutoExtendingTextarea
          className="var-value"
          onInput={(e) => setAppVars({ ...appVars, [v]: e.target.value })}
          value={appVars[v] || ''}
        />
      </div>
    )}
  </div >
}
