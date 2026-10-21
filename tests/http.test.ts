import * as http from 'node:http';
import * as zlib from 'node:zlib';
import { AddressInfo } from 'node:net';
import { httpAdapter } from '../src/adapters/http';
import { AdapterRequest } from '../src/types';

describe('adapters/http', () => {
  let server: http.Server;
  let baseURL: string;

  beforeAll(done => {
    server = http.createServer((req, res) => {
      const url = new URL(req.url || '/', `http://${req.headers.host}`);

      if (url.pathname === '/json') {
        let body = '';
        req.on('data', chunk => {
          body += chunk;
        });
        req.on('end', () => {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ receivedMethod: req.method, receivedBody: body || null }));
        });
        return;
      }

      if (url.pathname === '/text') {
        res.writeHead(200, { 'Content-Type': 'text/plain' });
        res.end('hello plain text');
        return;
      }

      if (url.pathname === '/gzip') {
        const payload = JSON.stringify({ compressed: true });
        const gzipped = zlib.gzipSync(payload);
        res.writeHead(200, {
          'Content-Type': 'application/json',
          'Content-Encoding': 'gzip',
        });
        res.end(gzipped);
        return;
      }

      if (url.pathname === '/deflate') {
        const payload = JSON.stringify({ deflated: true });
        const deflated = zlib.deflateSync(payload);
        res.writeHead(200, {
          'Content-Type': 'application/json',
          'Content-Encoding': 'deflate',
        });
        res.end(deflated);
        return;
      }

      if (url.pathname === '/redirect-1') {
        res.writeHead(302, { Location: '/json' });
        res.end();
        return;
      }

      if (url.pathname === '/infinite-redirect') {
        res.writeHead(302, { Location: '/infinite-redirect' });
        res.end();
        return;
      }

      if (url.pathname === '/delay') {
        setTimeout(() => {
          res.writeHead(200);
          res.end('ok');
        }, 300);
        return;
      }

      if (url.pathname === '/corrupt-gzip') {
        res.writeHead(200, {
          'Content-Type': 'application/json',
          'Content-Encoding': 'gzip',
        });
        res.end(Buffer.from('corrupted gzip data'));
        return;
      }

      res.writeHead(404);
      res.end('not found');
    });

    server.listen(0, () => {
      const addr = server.address() as AddressInfo;
      baseURL = `http://127.0.0.1:${addr.port}`;
      done();
    });
  });

  afterAll(done => {
    server.close(done);
  });

  it('performs GET request and parses json response', async () => {
    const config: AdapterRequest = {
      url: `${baseURL}/json`,
      method: 'GET',
      headers: { 'X-Custom': 'yes' },
    };

    const res = await httpAdapter(config);
    expect(res.status).toBe(200);
    expect(res.data).toEqual({ receivedMethod: 'GET', receivedBody: null });
    expect(res.headers['content-type']).toBe('application/json');
  });

  it('performs POST request sending body data', async () => {
    const config: AdapterRequest = {
      url: `${baseURL}/json`,
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      data: '{"user":"alice"}',
    };

    const res = await httpAdapter(config);
    expect(res.status).toBe(200);
    expect(res.data).toEqual({
      receivedMethod: 'POST',
      receivedBody: '{"user":"alice"}',
    });
  });

  it('handles responseType text and arraybuffer', async () => {
    const textRes = await httpAdapter({
      url: `${baseURL}/text`,
      headers: {},
      responseType: 'text',
    });
    expect(textRes.data).toBe('hello plain text');

    const abRes = await httpAdapter({
      url: `${baseURL}/text`,
      headers: {},
      responseType: 'arraybuffer',
    });
    expect(abRes.data.byteLength).toBe(16);
    expect(
      abRes.data instanceof ArrayBuffer ||
        Object.prototype.toString.call(abRes.data) === '[object ArrayBuffer]'
    ).toBe(true);
  });

  it('decompresses gzip responses', async () => {
    const res = await httpAdapter({
      url: `${baseURL}/gzip`,
      headers: {},
      responseType: 'json',
    });
    expect(res.status).toBe(200);
    expect(res.data).toEqual({ compressed: true });
  });

  it('decompresses deflate responses', async () => {
    const res = await httpAdapter({
      url: `${baseURL}/deflate`,
      headers: {},
      responseType: 'json',
    });
    expect(res.status).toBe(200);
    expect(res.data).toEqual({ deflated: true });
  });

  it('follows redirects', async () => {
    const res = await httpAdapter({
      url: `${baseURL}/redirect-1`,
      headers: {},
    });
    expect(res.status).toBe(200);
    expect(res.data.receivedMethod).toBe('GET');
  });

  it('throws ERR_TOO_MANY_REDIRECTS when exceeding redirect limit', async () => {
    await expect(
      httpAdapter({
        url: `${baseURL}/infinite-redirect`,
        headers: {},
      })
    ).rejects.toMatchObject({
      code: 'ERR_TOO_MANY_REDIRECTS',
      message: 'Too many redirects',
    });
  });

  it('throws ETIMEDOUT on request timeout', async () => {
    await expect(
      httpAdapter({
        url: `${baseURL}/delay`,
        headers: {},
        timeout: 50,
      })
    ).rejects.toMatchObject({
      code: 'ETIMEDOUT',
    });
  });

  it('throws ERR_CANCELED when aborted via signal', async () => {
    const controller = new AbortController();
    const promise = httpAdapter({
      url: `${baseURL}/delay`,
      headers: {},
      signal: controller.signal,
    });

    setTimeout(() => controller.abort(), 20);

    await expect(promise).rejects.toMatchObject({
      code: 'ERR_CANCELED',
      message: 'Request aborted',
    });
  });

  it('throws ERR_NETWORK for invalid URL', async () => {
    await expect(
      httpAdapter({
        url: 'not-a-valid-url',
        headers: {},
      })
    ).rejects.toMatchObject({
      code: 'ERR_NETWORK',
    });
  });

  it('throws ERR_NETWORK when connection fails', async () => {
    await expect(
      httpAdapter({
        url: 'http://127.0.0.1:65530/unavailable',
        headers: {},
      })
    ).rejects.toMatchObject({
      code: 'ERR_NETWORK',
    });
  });

  it('throws ERR_BAD_RESPONSE on corrupted gzip stream', async () => {
    await expect(
      httpAdapter({
        url: `${baseURL}/corrupt-gzip`,
        headers: {},
      })
    ).rejects.toMatchObject({
      code: 'ERR_BAD_RESPONSE',
    });
  });

  it('throws ERR_CANCELED immediately if signal is already aborted', async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(
      httpAdapter({
        url: `${baseURL}/json`,
        headers: {},
        signal: controller.signal,
      })
    ).rejects.toMatchObject({
      code: 'ERR_CANCELED',
    });
  });

  it('handles Buffer and stream request data and blob responseType', async () => {
    const { Readable } = await import('node:stream');
    const stream = Readable.from(['stream data']);

    const streamRes = await httpAdapter({
      url: `${baseURL}/json`,
      method: 'POST',
      headers: {},
      data: stream,
    });
    expect(streamRes.data.receivedBody).toBe('stream data');

    const bufRes = await httpAdapter({
      url: `${baseURL}/json`,
      method: 'POST',
      headers: {},
      data: Buffer.from('buffer data'),
    });
    expect(bufRes.data.receivedBody).toBe('buffer data');

    const blobRes = await httpAdapter({
      url: `${baseURL}/text`,
      headers: {},
      responseType: 'blob',
    });
    expect(blobRes.data).toBeDefined();
  });

  it('triggers onDownloadProgress and falls back to raw text on invalid json in http', async () => {
    const progressEvents: any[] = [];
    const res = await httpAdapter({
      url: `${baseURL}/text`,
      headers: {},
      responseType: 'json', // server returns 'hello plain text', not json
      onDownloadProgress: e => progressEvents.push(e),
    });

    expect(progressEvents.length).toBeGreaterThan(0);
    expect(res.data).toBe('hello plain text');
  });

  it('handles number/boolean data by converting to string', async () => {
    const res = await httpAdapter({
      url: `${baseURL}/json`,
      method: 'POST',
      headers: {},
      data: 12345 as any,
    });
    expect(res.data.receivedBody).toBe('12345');
  });
});
