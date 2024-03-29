#!/usr/bin/env node

const SwaggerParser = require("@apidevtools/swagger-parser");
const fs = require('fs').promises;
const util = require('util');
const Ajv = require('ajv');
const standaloneCode = require('ajv/dist/standalone').default;

// 1. Download the OpenAI's OpenAPI spec from their official
// repository, optionally at the specified revision.
// 2. Extract chat completion payload schema of OpenAI's official
// OpenAPI spec in YAML format to JSON format.
// 3. Compile the schema.

// HACK patch the incorrect schema
function patchSchema(s) {

  // Restrict logit_bias values.

  s.properties.logit_bias.additionalProperties = {
    ...s.properties.logit_bias.additionalProperties,
    type: "number",
    minimum: -100,
    maximum: 100
  };

  // Remove invalid nullable qualifier.

  s.properties.messages.items.oneOf[1].properties.content.nullable = undefined;
}

(async function ({ revision = 'master' }) {
  const url = `https://raw.githubusercontent.com/openai/openai-openapi/${revision}/openapi.yaml`;
  const api = await SwaggerParser.validate(url);
  const schema = api.paths['/chat/completions'].post.requestBody.content['application/json'].schema;
  const ajv = new Ajv({
    code: { source: true },
    strict: false,
  });
  patchSchema(schema);

  const validate = ajv.compile(schema);
  const moduleCode = standaloneCode(ajv, validate);
  await fs.writeFile('src/openai-payload-validate.js', moduleCode);
})({ revision: process.argv.slice(2)[0] });
