// OpenAI strict output requires every property to be required and objects closed.
// Represent domain-optional properties as nullable, then omit null object fields
// before applying the existing domain validators. Array nulls remain invalid.
export function strictOutputSchema(schema: Record<string, unknown>): Record<string, unknown> {
  const result = { ...schema };
  delete result.$schema;
  if (result.properties && typeof result.properties === "object") {
    const required = new Set(Array.isArray(schema.required) ? schema.required : []);
    result.properties = Object.fromEntries(Object.entries(result.properties).map(([key, value]) => {
      const child = strictOutputSchema(value as Record<string, unknown>);
      return [key, required.has(key) ? child : { anyOf: [child, { type: "null" }] }];
    }));
    result.required = Object.keys(result.properties as object);
    result.additionalProperties = false;
  } else if (result.type === "object") {
    result.properties = {};
    result.required = [];
    result.additionalProperties = false;
  }
  if (result.items && typeof result.items === "object") result.items = strictOutputSchema(result.items as Record<string, unknown>);
  if (Array.isArray(result.anyOf)) result.anyOf = result.anyOf.map(item => strictOutputSchema(item as Record<string, unknown>));
  if (result.$defs && typeof result.$defs === "object") result.$defs = Object.fromEntries(Object.entries(result.$defs).map(([key, value]) => [key, strictOutputSchema(value as Record<string, unknown>)]));
  return result;
}

export function omitNullFields(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(omitNullFields);
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== null).map(([key, item]) => [key, omitNullFields(item)]));
  return value;
}
