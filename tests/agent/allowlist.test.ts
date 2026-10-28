import { matchPath, checkAllowlist, checkRedirectHost, resolveAndValidatePath, checkRedirectHop } from '../../src/agent/allowlist';

describe('agent/allowlist', () => {
  describe('matchPath', () => {
    it('matches exact paths', () => {
      expect(matchPath('/customers', '/customers')).toBe(true);
      expect(matchPath('/customers', '/users')).toBe(false);
    });

    it('matches with single wildcard *', () => {
      expect(matchPath('/customers/*', '/customers/123')).toBe(true);
      expect(matchPath('/customers/*', '/customers/abc')).toBe(true);
      expect(matchPath('/customers/*', '/customers')).toBe(false);
      expect(matchPath('/customers/*', '/customers/123/orders')).toBe(false);
    });

    it('matches with double wildcard **', () => {
      expect(matchPath('/v1/**', '/v1/customers')).toBe(true);
      expect(matchPath('/v1/**', '/v1/customers/123')).toBe(true);
      expect(matchPath('/v1/**', '/v1/customers/123/orders')).toBe(true);
      expect(matchPath('/v1/**', '/v1')).toBe(true);
      expect(matchPath('/v2/**', '/v1/customers')).toBe(false);
    });

    it('handles mixed wildcards', () => {
      expect(matchPath('/v1/*/orders/**', '/v1/customers/orders')).toBe(true);
      expect(matchPath('/v1/*/orders/**', '/v1/customers/orders/123')).toBe(true);
      expect(matchPath('/v1/*/orders/**', '/v1/customers/orders/123/items')).toBe(true);
      expect(matchPath('/v1/*/orders/**', '/v1/customers')).toBe(false);
    });

    it('is case-insensitive', () => {
      expect(matchPath('/Customers', '/customers')).toBe(true);
      expect(matchPath('/customers', '/CUSTOMERS')).toBe(true);
    });

    it('normalizes leading slashes', () => {
      expect(matchPath('customers/*', '/customers/123')).toBe(true);
      expect(matchPath('/customers/*', 'customers/123')).toBe(true);
    });

    it('strips trailing slashes', () => {
      expect(matchPath('/customers/', '/customers')).toBe(true);
      expect(matchPath('/customers', '/customers/')).toBe(true);
    });

    it('strips query strings and fragments', () => {
      expect(matchPath('/customers/*', '/customers/123?page=1')).toBe(true);
      expect(matchPath('/customers/*', '/customers/123#section')).toBe(true);
    });

    it('matches root path', () => {
      expect(matchPath('/**', '/')).toBe(true);
      expect(matchPath('/**', '/anything')).toBe(true);
    });
  });

  describe('checkAllowlist', () => {
    it('allows everything when no allowlist is configured', () => {
      expect(() => checkAllowlist(
        { baseURL: 'https://api.example.com' },
        'DELETE',
        '/anything',
        'test'
      )).not.toThrow();
    });

    it('allows permitted methods', () => {
      expect(() => checkAllowlist(
        { baseURL: 'https://api.example.com', allow: { methods: ['GET', 'POST'] } },
        'GET',
        '/test',
        'test'
      )).not.toThrow();
    });

    it('blocks forbidden methods', () => {
      expect(() => checkAllowlist(
        { baseURL: 'https://api.example.com', allow: { methods: ['GET'] } },
        'DELETE',
        '/test',
        'test'
      )).toThrow('Method DELETE is not allowed');
    });

    it('method check is case-insensitive', () => {
      expect(() => checkAllowlist(
        { baseURL: 'https://api.example.com', allow: { methods: ['GET'] } },
        'get',
        '/test',
        'test'
      )).not.toThrow();
    });

    it('allows matching paths', () => {
      expect(() => checkAllowlist(
        { baseURL: 'https://api.example.com', allow: { paths: ['/customers/*'] } },
        'GET',
        '/customers/123',
        'test'
      )).not.toThrow();
    });

    it('blocks non-matching paths', () => {
      expect(() => checkAllowlist(
        { baseURL: 'https://api.example.com', allow: { paths: ['/customers/*'] } },
        'GET',
        '/users/123',
        'test'
      )).toThrow('Path "/users/123" is not allowed');
    });

    it('extracts path from full URL', () => {
      expect(() => checkAllowlist(
        { baseURL: 'https://api.example.com', allow: { paths: ['/customers/*'] } },
        'GET',
        'https://api.example.com/customers/123',
        'test'
      )).not.toThrow();
    });

    it('checks method and path together', () => {
      const config = {
        baseURL: 'https://api.example.com',
        allow: { methods: ['GET'] as any, paths: ['/customers/*'] },
      };
      // Method allowed, path allowed
      expect(() => checkAllowlist(config, 'GET', '/customers/123', 'test')).not.toThrow();
      // Method blocked
      expect(() => checkAllowlist(config, 'DELETE', '/customers/123', 'test')).toThrow('Method DELETE');
    });

    it('error includes instance name', () => {
      expect(() => checkAllowlist(
        { baseURL: 'https://x.com', allow: { methods: ['GET'] } },
        'POST',
        '/test',
        'my-api'
      )).toThrow('instance "my-api"');
    });
  });

  describe('checkRedirectHost', () => {
    it('allows same-host redirects', () => {
      expect(() => checkRedirectHost(
        { baseURL: 'https://api.stripe.com' },
        'https://api.stripe.com/v1/customers',
        'https://api.stripe.com/v1/customers/123',
        'stripe'
      )).not.toThrow();
    });

    it('blocks cross-host redirects when no hosts are configured', () => {
      expect(() => checkRedirectHost(
        { baseURL: 'https://api.stripe.com' },
        'https://api.stripe.com/v1/customers',
        'https://evil.com/steal',
        'stripe'
      )).toThrow('Redirect to host "evil.com" is not allowed');
    });

    it('allows cross-host redirects when host is in allowlist', () => {
      expect(() => checkRedirectHost(
        { baseURL: 'https://api.stripe.com', allow: { hosts: ['cdn.stripe.com'] } },
        'https://api.stripe.com/v1/files',
        'https://cdn.stripe.com/file.pdf',
        'stripe'
      )).not.toThrow();
    });

    it('host check is case-insensitive', () => {
      expect(() => checkRedirectHost(
        { baseURL: 'https://api.stripe.com', allow: { hosts: ['CDN.Stripe.com'] } },
        'https://api.stripe.com/v1/files',
        'https://cdn.stripe.com/file.pdf',
        'stripe'
      )).not.toThrow();
    });
  });
});
