import { ShapedData } from './types';

/**
 * Truncate response data to maxBytes. Works on strings and JSON objects.
 * Returns the (possibly truncated) data, whether truncation happened,
 * and the original byte size.
 */
export function truncateResponse(
  data: any,
  maxBytes: number
): ShapedData {
  if (data === null || data === undefined) {
    return { data, truncated: false, originalBytes: 0 };
  }

  let text: string;
  if (typeof data === 'string') {
    text = data;
  } else if (typeof data === 'object') {
    try {
      text = JSON.stringify(data);
    } catch {
      text = String(data);
    }
  } else {
    text = String(data);
  }

  const originalBytes = Buffer.byteLength(text, 'utf-8');

  if (originalBytes <= maxBytes) {
    return { data, truncated: false, originalBytes };
  }

  // Truncate the string to maxBytes (byte-safe via Buffer)
  const truncated = Buffer.from(text, 'utf-8').subarray(0, maxBytes).toString('utf-8');

  // Try to parse it back if original was an object
  if (typeof data === 'object') {
    return {
      data: truncated + `\n... [truncated: ${originalBytes} bytes → ${maxBytes} bytes]`,
      truncated: true,
      originalBytes,
    };
  }

  return {
    data: truncated + `\n... [truncated: ${originalBytes} bytes → ${maxBytes} bytes]`,
    truncated: true,
    originalBytes,
  };
}

/**
 * Select specific fields from a JSON response using dot-notation paths.
 *
 * Example:
 *   selectFields({ id: 1, name: 'Jo', addr: { city: 'NYC', zip: '10001' } }, ['id', 'addr.city'])
 *   → { id: 1, 'addr.city': 'NYC' }
 *
 * Works on arrays: applies the field selection to each element.
 */
export function selectFields(data: any, fields: string[]): any {
  if (data === null || data === undefined) return data;
  if (!fields || fields.length === 0) return data;

  if (Array.isArray(data)) {
    return data.map(item => selectFieldsFromObject(item, fields));
  }

  if (typeof data === 'object') {
    return selectFieldsFromObject(data, fields);
  }

  // Non-object, non-array data — return as-is
  return data;
}

function selectFieldsFromObject(obj: any, fields: string[]): any {
  if (typeof obj !== 'object' || obj === null) return obj;

  const result: Record<string, any> = {};
  for (const fieldPath of fields) {
    const value = getNestedValue(obj, fieldPath);
    if (value !== undefined) {
      result[fieldPath] = value;
    }
  }
  return result;
}

function getNestedValue(obj: any, path: string): any {
  const parts = path.split('.');
  let current = obj;
  for (const part of parts) {
    if (current === null || current === undefined || typeof current !== 'object') {
      return undefined;
    }
    current = current[part];
  }
  return current;
}

/**
 * Shape a response for agent consumption: truncate and/or select fields.
 * Field selection runs first (to reduce data before truncation).
 */
export function shapeResponse(
  data: any,
  options: { maxBytes?: number; fields?: string[] }
): ShapedData {
  let shaped = data;

  // 1. Field selection (reduces data first)
  if (options.fields && options.fields.length > 0) {
    shaped = selectFields(shaped, options.fields);
  }

  // 2. Truncation
  if (options.maxBytes && options.maxBytes > 0) {
    return truncateResponse(shaped, options.maxBytes);
  }

  // No truncation needed — calculate original size for metadata
  let originalBytes = 0;
  if (shaped !== null && shaped !== undefined) {
    try {
      const text = typeof shaped === 'string' ? shaped : JSON.stringify(shaped);
      originalBytes = Buffer.byteLength(text, 'utf-8');
    } catch {
      originalBytes = 0;
    }
  }

  return { data: shaped, truncated: false, originalBytes };
}
