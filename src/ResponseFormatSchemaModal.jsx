import { useRef, useEffect, useState } from 'react';
import './APIKeyModal.css';
import { Modal } from './Modal';

const EXAMPLE_NAME = "grade_result";
const EXAMPLE_SCHEMA = {
  "type": "object",
  "additionalProperties": false,
  "properties": {
    "score": {"type": "number", "enum": [0, 0.5, 1]},
    "reason": {"type": "string", "minLength": 1, "maxLength": 350}
  },
  "required": ["score", "reason"]
};

export function ResponseFormatSchemaModal({ jsonSchema, onSave, onCancel }) {
  const nameRef = useRef(null);
  const schemaRef = useRef(null);
  const [strict, setStrict] = useState(jsonSchema?.strict ?? true);
  const [error, setError] = useState("");
  const [showExample, setShowExample] = useState(false);

  useEffect(() => {
    if (nameRef.current) {
      nameRef.current.focus();
    }
  }, []);

  const useExample = () => {
    if (nameRef.current) {
      nameRef.current.value = EXAMPLE_NAME;
    }
    if (schemaRef.current) {
      schemaRef.current.value = JSON.stringify(EXAMPLE_SCHEMA, null, 2);
    }
    setStrict(true);
    setError("");
    setShowExample(false);
  };


  const handleSave = () => {
    const name = nameRef.current.value.trim();
    const schemaText = schemaRef.current.value.trim();

    if (!name) {
      setError("Schema name is required");
      return;
    }

    if (!schemaText) {
      setError("JSON Schema is required");
      return;
    }

    let parsedSchema;
    try {
      parsedSchema = JSON.parse(schemaText);
    } catch (e) {
      setError("Invalid JSON: " + e.message);
      return;
    }

    setError("");
    onSave({
      name: name,
      schema: parsedSchema,
      strict: strict
    });
  };

  return (
    <Modal onCancel={onCancel} width="600px" contentClassName="api-key-modal">
      <h2>Configure JSON Schema</h2>
      <p>
        Define a JSON schema to enforce structured output from the model.{" "}
        <a 
          href="https://platform.openai.com/docs/guides/structured-outputs" 
          target="_blank" 
          rel="noopener"
        >
          Learn more
        </a>
      </p>

      {/* Example Section */}
      <div style={{ 
        marginTop: "16px", 
        marginBottom: "16px",
        border: "1px solid #ddd",
        borderRadius: "4px",
        backgroundColor: "#f9f9f9"
      }}>
        <button
          onClick={() => setShowExample(!showExample)}
          style={{
            width: "100%",
            textAlign: "left",
            padding: "10px 12px",
            background: "transparent",
            border: "none",
            cursor: "pointer",
            fontSize: "14px",
            fontWeight: "500"
          }}
        >
          {showExample ? "▼" : "▶"} 📖 Show Example
        </button>
        
        {showExample && (
          <div style={{ padding: "0 12px 12px 12px" }}>
            <p style={{ fontSize: "13px", marginBottom: "12px" }}>
              Example: A grading schema that returns a score and reason
            </p>
            
            <div style={{ marginBottom: "8px" }}>
              <strong style={{ fontSize: "13px" }}>Schema Name:</strong>
              <div style={{ 
                fontFamily: "monospace", 
                fontSize: "12px", 
                padding: "6px",
                backgroundColor: "#fff",
                border: "1px solid #ddd",
                borderRadius: "3px",
                marginTop: "4px"
              }}>
                {EXAMPLE_NAME}
              </div>
            </div>

            <div style={{ marginBottom: "8px" }}>
              <strong style={{ fontSize: "13px" }}>JSON Schema:</strong>
              <pre style={{ 
                fontFamily: "monospace", 
                fontSize: "12px", 
                padding: "8px",
                backgroundColor: "#fff",
                border: "1px solid #ddd",
                borderRadius: "3px",
                marginTop: "4px",
                overflow: "auto",
                maxHeight: "200px"
              }}>
                {JSON.stringify(EXAMPLE_SCHEMA, null, 2)}
              </pre>
            </div>

            <div style={{ marginBottom: "12px" }}>
              <strong style={{ fontSize: "13px" }}>Strict Mode:</strong> ✓ Enabled
            </div>

            <button 
              onClick={useExample}
              style={{
                padding: "6px 12px",
                fontSize: "13px",
                backgroundColor: "#0066cc",
                color: "white",
                border: "none",
                borderRadius: "4px",
                cursor: "pointer"
              }}
            >
              ✨ Use This Example
            </button>
          </div>
        )}
      </div>

      <label style={{ display: "block", marginTop: "16px", marginBottom: "4px" }}>
        Schema Name:
      </label>

      <input
        ref={nameRef}
        type="text"
        placeholder="my_schema"
        defaultValue={jsonSchema?.name || ""}
        style={{ width: "100%", padding: "8px", fontSize: "14px" }}
      />

      <label style={{ display: "block", marginTop: "16px", marginBottom: "4px" }}>
        JSON Schema:
      </label>
      <textarea
        ref={schemaRef}
        placeholder={'{\n  "type": "object",\n  "properties": {\n    "name": { "type": "string" }\n  },\n  "required": ["name"],\n  "additionalProperties": false\n}'}
        defaultValue={jsonSchema?.schema ? JSON.stringify(jsonSchema.schema, null, 2) : ""}
        rows="15"
        style={{
          width: "100%",
          fontFamily: "monospace",
          fontSize: "13px",
          padding: "8px",
          resize: "vertical"
        }}
      />

      <label style={{ display: "block", marginTop: "12px", marginBottom: "12px" }}>
        <input
          type="checkbox"
          checked={strict}
          onChange={(e) => setStrict(e.target.checked)}
          style={{ marginRight: "8px" }}
        />
        Strict Mode (recommended - ensures the output matches the schema exactly)
      </label>

      {error && (
        <div
          style={{
            color: "#c00",
            fontSize: "14px",
            marginTop: "8px",
            marginBottom: "8px",
            padding: "8px",
            backgroundColor: "#fee",
            borderRadius: "4px"
          }}
        >
          {error}
        </div>
      )}

      <div style={{ marginTop: "16px" }}>
        <button onClick={handleSave}>Save</button>
        &nbsp;
        <button onClick={onCancel}>Cancel</button>
      </div>
    </Modal>
  );
}
