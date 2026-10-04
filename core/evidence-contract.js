/* Shared evidence structure only: no storage, transport or domain interpretation. */
(function registerEvidenceContract(root) {
  'use strict';

  const SCHEMA = 'hios.evidence.v1';
  const SCHEMA_VERSION = 1;
  const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  const text = value => typeof value === 'string' && value.trim().length > 0;
  const record = value => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
    const prototype = Object.getPrototypeOf(value);
    return prototype === null || prototype === Object.prototype;
  };

  // Require a real calendar date and explicit timezone; Date.parse alone rolls
  // invalid dates such as February 30 into the following month.
  function timestamp(value) {
    if (typeof value !== 'string') return false;
    const parts = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d+)?(?:Z|([+-])(\d{2}):(\d{2}))$/.exec(value);
    if (!parts) return false;
    const [, year, month, day, hour, minute, second, , offsetHour, offsetMinute] = parts;
    const y = Number(year), m = Number(month), d = Number(day);
    const leap = y % 4 === 0 && (y % 100 !== 0 || y % 400 === 0);
    const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
    return m >= 1 && m <= 12 && d >= 1 && d <= days[m - 1] &&
      Number(hour) < 24 && Number(minute) < 60 && Number(second) < 60 &&
      (!offsetHour || (Number(offsetHour) < 24 && Number(offsetMinute) < 60)) &&
      Number.isFinite(Date.parse(value));
  }

  // Reject values JSON would silently lose/change. Shared references are fine;
  // cycles, accessors and non-JSON objects are not evidence payloads.
  function jsonValue(value, ancestors = new Set()) {
    if (value === null || typeof value === 'string' || typeof value === 'boolean') return true;
    if (typeof value === 'number') return Number.isFinite(value);
    if (!Array.isArray(value) && !record(value)) return false;
    if (ancestors.has(value)) return false;
    ancestors.add(value);
    const keys = Reflect.ownKeys(value).filter(key => !(Array.isArray(value) && key === 'length'));
    if (Array.isArray(value) && (keys.length !== value.length ||
      keys.some((key, index) => key !== String(index)))) return false;
    const valid = keys.every(key => {
      if (typeof key !== 'string') return false;
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      return descriptor.enumerable && 'value' in descriptor && jsonValue(descriptor.value, ancestors);
    });
    ancestors.delete(value);
    return valid;
  }

  /** Validate shape only. A valid userId is NOT proof of identity/ownership. */
  function validateEvidence(evidence) {
    const errors = [];
    try {
      if (!record(evidence)) return { valid: false, errors: ['Evidence must be a plain object.'] };
      if (!jsonValue(evidence)) return { valid: false, errors: ['Evidence must contain only JSON data, without cycles or accessors.'] };
      if (evidence.schema !== SCHEMA) errors.push('Unsupported evidence schema.');
      for (const field of ['id', 'sourceProductId', 'domain', 'evidenceType']) {
        if (!text(evidence[field])) errors.push(field + ' must be a non-empty string.');
      }
      if (typeof evidence.userId !== 'string' || !UUID.test(evidence.userId)) {
        errors.push('userId must be the Supabase auth user UUID.');
      }
      if (!timestamp(evidence.observedAt)) errors.push('observedAt must be a valid ISO timestamp with timezone.');
      if (!record(evidence.subject) || !text(evidence.subject.type) || !text(evidence.subject.id)) {
        errors.push('subject must contain non-empty type and id strings.');
      }
      if (!record(evidence.observation)) errors.push('observation must be a plain object.');
      for (const field of ['evaluation', 'context']) {
        if (Object.hasOwn(evidence, field) && !record(evidence[field])) errors.push(field + ' must be a plain object when supplied.');
      }
      if (Object.hasOwn(evidence, 'model') && evidence.model !== null && !record(evidence.model)) {
        errors.push('model must be a plain object or null when supplied.');
      }
      for (const field of ['source', 'sourceProductName', 'evidenceFamily']) {
        if (Object.hasOwn(evidence, field) && !text(evidence[field])) errors.push(field + ' must be a non-empty string when supplied.');
      }
    } catch (error) {
      // Malformed input must not interrupt receipt of other evidence.
      errors.push('Evidence could not be validated as JSON data.');
    }
    return { valid: errors.length === 0, errors };
  }

  /** Supply identity and occurrence time explicitly; never infer them from storage. */
  function createEvidence(fields) {
    // Check JSON safety before spreading so input accessors are never executed.
    if (!record(fields) || !jsonValue(fields)) throw new TypeError('Evidence fields must be plain JSON data.');
    // Permit omission of schema for creation, but reject an explicit unsupported one.
    const evidence = { schema: SCHEMA, ...fields };
    const validation = validateEvidence(evidence);
    if (!validation.valid) throw new TypeError(validation.errors.join(' '));
    return JSON.parse(JSON.stringify(evidence));
  }

  const api = Object.freeze({ SCHEMA, SCHEMA_VERSION, validateEvidence, createEvidence });
  if (typeof module === 'object' && module.exports) module.exports = api;
  else if (!root.HIOSEvidenceContract) root.HIOSEvidenceContract = api;
})(typeof globalThis === 'object' ? globalThis : this);
