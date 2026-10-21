import { truncateResponse, selectFields, shapeResponse } from '../../src/agent/response';

describe('agent/response', () => {
  describe('truncateResponse', () => {
    it('returns original string when size is within limit', () => {
      const data = 'Hello, world!';
      const result = truncateResponse(data, 100);
      expect(result.data).toBe(data);
      expect(result.truncated).toBe(false);
      expect(result.originalBytes).toBe(Buffer.byteLength(data, 'utf8'));
    });

    it('truncates string data exceeding maxBytes', () => {
      const data = 'a'.repeat(200);
      const result = truncateResponse(data, 50);
      expect(result.truncated).toBe(true);
      expect(result.originalBytes).toBe(200);
      expect(result.data).toContain('[TRUNCATED:');
      expect(result.data).toContain('original size: 200 bytes');
    });

    it('truncates buffer data exceeding maxBytes', () => {
      const buf = Buffer.alloc(100, 1);
      const result = truncateResponse(buf, 30);
      expect(result.truncated).toBe(true);
      expect(result.originalBytes).toBe(100);
      expect(Buffer.isBuffer(result.data)).toBe(true);
      expect((result.data as Buffer).length).toBe(30);
    });

    it('truncates JSON objects when serialized representation exceeds limit', () => {
      const obj = { message: 'long message '.repeat(50) };
      const result = truncateResponse(obj, 100);
      expect(result.truncated).toBe(true);
      expect(typeof result.data).toBe('string');
      expect((result.data as string)).toContain('[TRUNCATED');
    });

    it('returns unmodified data if maxBytes <= 0 or not exceeded', () => {
      const obj = { hello: 'world' };
      const result = truncateResponse(obj, 0);
      expect(result.truncated).toBe(false);
      expect(result.data).toEqual(obj);
    });
  });

  describe('selectFields', () => {
    it('returns original data if data is not an object or array', () => {
      expect(selectFields('text', ['field'])).toBe('text');
      expect(selectFields(123, ['field'])).toBe(123);
      expect(selectFields(null, ['field'])).toBe(null);
    });

    it('returns original data if field list is empty', () => {
      const obj = { a: 1, b: 2 };
      expect(selectFields(obj, [])).toEqual(obj);
    });

    it('selects simple fields from an object', () => {
      const obj = { id: 'cust_123', email: 'test@example.com', secret: 'hide' };
      const result = selectFields(obj, ['id', 'email']);
      expect(result).toEqual({ id: 'cust_123', email: 'test@example.com' });
    });

    it('selects nested fields using dot notation', () => {
      const obj = {
        id: 1,
        profile: {
          name: 'Alice',
          address: { city: 'Wonderland', zip: '12345' },
        },
        ignored: true,
      };
      const result = selectFields(obj, ['id', 'profile.name', 'profile.address.city']);
      expect(result).toEqual({
        id: 1,
        profile: {
          name: 'Alice',
          address: { city: 'Wonderland' },
        },
      });
    });

    it('projects fields across array of objects', () => {
      const list = [
        { id: 1, name: 'Item 1', internal: 'x' },
        { id: 2, name: 'Item 2', internal: 'y' },
      ];
      const result = selectFields(list, ['id', 'name']);
      expect(result).toEqual([
        { id: 1, name: 'Item 1' },
        { id: 2, name: 'Item 2' },
      ]);
    });

    it('handles nested array navigation (items.id)', () => {
      const obj = {
        orderId: 999,
        items: [
          { sku: 'A', price: 10, detail: 'omit' },
          { sku: 'B', price: 20, detail: 'omit' },
        ],
      };
      const result = selectFields(obj, ['orderId', 'items.sku']);
      expect(result).toEqual({
        orderId: 999,
        items: [{ sku: 'A' }, { sku: 'B' }],
      });
    });

    it('ignores missing nested paths gracefully', () => {
      const obj = { id: 1 };
      const result = selectFields(obj, ['id', 'nonexistent.subfield']);
      expect(result).toEqual({ id: 1 });
    });
  });

  describe('shapeResponse', () => {
    it('applies field selection then truncation', () => {
      const obj = {
        id: '123',
        description: 'a'.repeat(200),
        secret: 'shh',
      };
      const result = shapeResponse(obj, { fields: ['id', 'description'], maxBytes: 50 });
      expect(result.truncated).toBe(true);
      expect(typeof result.data).toBe('string');
      expect((result.data as string)).toContain('[TRUNCATED');
    });

    it('passes through if no shaping options provided', () => {
      const obj = { a: 1 };
      const result = shapeResponse(obj);
      expect(result.data).toEqual(obj);
      expect(result.truncated).toBe(false);
    });
  });
});
