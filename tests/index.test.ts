import grab, {
  GrabInstance,
  isCancel,
  buildURL,
  dispatchRequest,
  defaultTransformRequest,
  defaultTransformResponse,
  InterceptorManagerImpl,
  registerAdapter,
  resolveAdapter,
  createError,
  fetchAdapter,
  xhrAdapter,
  getRegisteredAdapter,
} from '../src/index';

describe('index (browser entry)', () => {
  it('exports all expected public APIs and types', () => {
    expect(grab).toBeInstanceOf(GrabInstance);
    expect(typeof GrabInstance.create).toBe('function');
    expect(typeof isCancel).toBe('function');
    expect(typeof buildURL).toBe('function');
    expect(typeof dispatchRequest).toBe('function');
    expect(typeof defaultTransformRequest).toBe('function');
    expect(typeof defaultTransformResponse).toBe('function');
    expect(typeof InterceptorManagerImpl).toBe('function');
    expect(typeof registerAdapter).toBe('function');
    expect(typeof resolveAdapter).toBe('function');
    expect(typeof createError).toBe('function');
    expect(typeof fetchAdapter).toBe('function');
    expect(typeof xhrAdapter).toBe('function');
  });

  it('registers fetch and xhr adapters', () => {
    expect(getRegisteredAdapter('fetch')).toBe(fetchAdapter);
    expect(getRegisteredAdapter('xhr')).toBe(xhrAdapter);
  });
});

describe('index.node (node entry)', () => {
  it('registers http adapter and re-exports core APIs', async () => {
    const nodeEntry = await import('../src/index.node');
    expect(nodeEntry.default).toBe(grab);
    expect(typeof nodeEntry.httpAdapter).toBe('function');
    expect(getRegisteredAdapter('http')).toBe(nodeEntry.httpAdapter);
  });
});
