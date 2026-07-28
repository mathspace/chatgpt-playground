import { useCallback, useState } from "react";
import InfoLabel from "./InfoLabel.jsx";
import { ResponseFormatSchemaModal } from "./ResponseFormatSchemaModal.jsx";

export function ResponseFormatSelector({ apiType, responseFormat, setResponseFormat }) {
  const [showSchemaModal, setShowSchemaModal] = useState(false);

  let value = responseFormat;
  if (value === undefined) {
    value = "default";
  } else {
    value = value.type;
  }

  const setType = useCallback(e => {
    const v = e.target.value;
    if (v === 'default') {
      setResponseFormat(undefined);
    } else if (v === 'json_schema') {
      if (responseFormat?.json_schema?.name) {
        setResponseFormat({
          type: v,
          json_schema: responseFormat.json_schema
        });
      } else {
        setShowSchemaModal(true);
      }
    } else {
      setResponseFormat({ type: v });
    }
  }, [setResponseFormat, responseFormat]);

  const handleSchemaSave = useCallback((jsonSchema) => {
    setResponseFormat({
      type: "json_schema",
      json_schema: jsonSchema
    });
    setShowSchemaModal(false);
  }, [setResponseFormat]);

  const handleSchemaCancel = useCallback(() => {
    setShowSchemaModal(false);
  }, []);

  const schemaConfigured = responseFormat?.json_schema?.name;

  return <>
    <label>Response Format<InfoLabel href="response_format" apiType={apiType} /></label>
    <select onChange={setType} value={value}>
      <option value="default">
        Default (Text)
      </option>
      <option value="text">Text</option>
      <option value="json_object">JSON</option>
      <option value="json_schema">JSON Schema</option>
    </select>

    {value === 'json_schema' && (
      <button
        onClick={() => setShowSchemaModal(true)}
        style={{
          marginTop: "4px",
          width: "100%",
          fontSize: "0.9em"
        }}
        title={schemaConfigured ? `Schema: ${responseFormat.json_schema.name}` : "Configure JSON Schema"}
      >
        ⚙️ {schemaConfigured ? `Schema: ${responseFormat.json_schema.name}` : 'Configure Schema'}
      </button>
    )}

    {showSchemaModal && (
      <ResponseFormatSchemaModal
        jsonSchema={responseFormat?.json_schema}
        onSave={handleSchemaSave}
        onCancel={handleSchemaCancel}
      />
    )}
  </>;
}
