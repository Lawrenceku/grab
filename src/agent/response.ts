import { ShapedData } from './types';

/**
 * Truncate response data to maxBytes.
 * Truncates structurally for JSON objects and arrays:
 * - Keeps first N items of arrays
 * - Clips long string fields
 * - Ensures valid structure is preserved
 * - Returns truncated: true, originalBytes, and a hint to use fields
 * Handles non-JSON text, Buffers, and binary data cleanly.
 */
export function truncateResponse(
  data: any,
  maxBytes: number
): ShapedData {
  if (data === null || data === undefined) {
    return { data, truncated: false, originalBytes: 0 };
  }

  if (maxBytes <= 0) {
    return { data, truncated: false, originalBytes: calculateByteLength(data) };
  }

  // Handle binary Buffers
  if (Buffer.isBuffer(data)) {
    const originalBytes = data.length;
    if (originalBytes <= maxBytes) {
      return { data, truncated: false, originalBytes };
    }
    return {
      data: data.subarray(0, maxBytes),
      truncated: true,
      originalBytes,
      hint: "Binary Buffer truncated to fit maxBytes limit.",
    };
  }

  // Handle ArrayBuffer
  if (typeof ArrayBuffer !== 'undefined' && data instanceof ArrayBuffer) {
    const originalBytes = data.byteLength;
    if (originalBytes <= maxBytes) {
      return { data, truncated: false, originalBytes };
    }
    return {
      data: data.slice(0, maxBytes),
      truncated: true,
      originalBytes,
      hint: "Binary ArrayBuffer truncated to fit maxBytes limit.",
    };
  }

  // Handle strings (JSON or non-JSON text)
  if (typeof data === 'string') {
    const originalBytes = Buffer.byteLength(data, 'utf-8');
    if (originalBytes <= maxBytes) {
      return { data, truncated: false, originalBytes };
    }

    // Attempt to parse string as JSON to truncate structurally
    const trimmed = data.trim();
    if ((trimmed.startsWith('{') && trimmed.endsWith('}')) || (trimmed.startsWith('[') && trimmed.endsWith(']'))) {
      try {
        const parsed = JSON.parse(data);
        const result = truncateResponse(parsed, maxBytes);
        return {
          ...result,
          originalBytes,
        };
      } catch {
        // Not valid JSON, fall through to text truncation
      }
    }

    // Plain text truncation
    const clipped = Buffer.from(data, 'utf-8').subarray(0, maxBytes).toString('utf-8');
    return {
      data: clipped + `\n... [TRUNCATED: original size: ${originalBytes} bytes → ${maxBytes} bytes]`,
      truncated: true,
      originalBytes,
      hint: "Use fields parameter or smaller query to reduce response size.",
    };
  }

  // Handle Arrays
  if (Array.isArray(data)) {
    const originalBytes = calculateByteLength(data);
    if (originalBytes <= maxBytes) {
      return { data, truncated: false, originalBytes };
    }

    let low = 0;
    let high = data.length;
    let best = 0;

    while (low <= high) {
      const mid = Math.floor((low + high) / 2);
      const slice = data.slice(0, mid);
      const bytes = calculateByteLength(slice);
      if (bytes <= maxBytes) {
        best = mid;
        low = mid + 1;
      } else {
        high = mid - 1;
      }
    }

    let items = data.slice(0, Math.max(1, best));
    if (calculateByteLength(items) > maxBytes && items.length === 1) {
      items = [clipObjectStrings(items[0], maxBytes)];
    }

    return {
      data: items,
      truncated: true,
      originalBytes,
      hint: "Response array was structurally truncated to fit limits. Use the 'fields' parameter to request only the specific fields you need.",
    };
  }

  // Handle Objects
  if (typeof data === 'object') {
    const originalBytes = calculateByteLength(data);
    if (originalBytes <= maxBytes) {
      return { data, truncated: false, originalBytes };
    }

    const clipped = clipObjectStrings(data, maxBytes);
    return {
      data: clipped,
      truncated: true,
      originalBytes,
      hint: "Response object was structurally truncated to fit limits. Use the 'fields' parameter to request only the specific fields you need.",
    };
  }

  return { data, truncated: false, originalBytes: calculateByteLength(data) };
}

function calculateByteLength(val: any): number {
  if (val === null || val === undefined) return 0;
  if (Buffer.isBuffer(val)) return val.length;
  if (typeof ArrayBuffer !== 'undefined' && val instanceof ArrayBuffer) return val.byteLength;
  try {
    const str = typeof val === 'string' ? val : JSON.stringify(val);
    return Buffer.byteLength(str, 'utf-8');
  } catch {
    return 0;
  }
}

/**
 * Structurally clip long string properties and truncate nested arrays inside an object.
 */
function clipObjectStrings(obj: any, targetBytes: number): any {
  if (typeof obj !== 'object' || obj === null) return obj;

  if (Array.isArray(obj)) {
    return obj.slice(0, 3).map(item => clipObjectStrings(item, targetBytes));
  }

  const result: Record<string, any> = {};
  for (const [key, val] of Object.entries(obj)) {
    if (typeof val === 'string') {
      if (val.length > 50) {
        result[key] = val.slice(0, 40) + '... [clipped]';
      } else {
        result[key] = val;
      }
    } else if (Array.isArray(val)) {
      result[key] = val.slice(0, 3).map(item => clipObjectStrings(item, targetBytes));
    } else if (typeof val === 'object' && val !== null) {
      result[key] = clipObjectStrings(val, targetBytes);
    } else {
      result[key] = val;
    }
  }

  return result;
}

/**
 * Select specific fields from a JSON response using dot-notation paths.
 *
 * Example:
 *   selectFields({ id: 1, name: 'Jo', addr: { city: 'NYC', zip: '10001' } }, ['id', 'addr.city'])
 *   → { id: 1, addr: { city: 'NYC' } }
 *
 * Works on arrays (top-level or nested, e.g. 'items.sku'):
 *   selectFields({ items: [{ sku: 'A', price: 10 }] }, ['items.sku'])
 *   → { items: [{ sku: 'A' }] }
 */
export function selectFields(data: any, fields: string[]): any {
  if (data === null || data === undefined) return data;
  if (!fields || fields.length === 0) return data;

  if (Array.isArray(data)) {
    return data.map(item => selectFields(item, fields));
  }

  if (typeof data !== 'object') {
    return data;
  }

  const result: Record<string, any> = {};
  for (const fieldPath of fields) {
    const parts = fieldPath.split('.');
    applyField(result, data, parts, 0);
  }
  return result;
}

function applyField(target: any, source: any, parts: string[], partIdx: number): void {
  if (source === null || source === undefined || typeof source !== 'object') return;
  const part = parts[partIdx];
  const isLast = partIdx === parts.length - 1;

  if (isLast) {
    if (part in source) {
      target[part] = source[part];
    }
    return;
  }

  const val = source[part];
  if (val === null || val === undefined) return;

  if (Array.isArray(val)) {
    if (!target[part]) {
      target[part] = [];
    }
    const remainingParts = parts.slice(partIdx + 1);
    val.forEach((elem, idx) => {
      if (typeof elem === 'object' && elem !== null) {
        if (!target[part][idx]) {
          target[part][idx] = Array.isArray(elem) ? [] : {};
        }
        applyField(target[part][idx], elem, remainingParts, 0);
      } else {
        target[part][idx] = elem;
      }
    });
  } else if (typeof val === 'object') {
    if (!target[part]) {
      target[part] = {};
    }
    applyField(target[part], val, parts, partIdx + 1);
  }
}

/**
 * Shape a response for agent consumption: truncate and/or select fields.
 * Field selection runs first (to reduce data before truncation).
 */
export function shapeResponse(
  data: any,
  options: { maxBytes?: number; fields?: string[] } = {}
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

  const originalBytes = calculateByteLength(shaped);
  return { data: shaped, truncated: false, originalBytes };
}
