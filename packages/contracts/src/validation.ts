import Ajv, { type ErrorObject, type JSONSchemaType } from 'ajv';
import type { Result } from './result.ts';
import { failure, success } from './result.ts';

export interface ValidationIssue { readonly path: string; readonly keyword: string; readonly message: string; }
const ajv = new Ajv({ allErrors: true, strict: true, allowUnionTypes: true });
export function createParser<T>(schema: JSONSchemaType<T>): (input: unknown) => Result<T, readonly ValidationIssue[]> {
  const validate = ajv.compile(schema);
  return (input) => validate(input) ? success(input) : failure((validate.errors ?? []).map(issue));
}
function issue(error: ErrorObject): ValidationIssue { return { path: error.instancePath || '$', keyword: error.keyword, message: error.message ?? 'invalid' }; }
