import { grab, GrabInstance } from '../src/index';

describe('grab', () => {
  it('should perform a GET request and return response object', async () => {
    const response = await grab.get('https://jsonplaceholder.typicode.com/posts/1');
    expect(response.data).toHaveProperty('id', 1);
    expect(response.status).toBe(200);
    expect(response.headers).toBeDefined();
  });

  it('should perform a POST request and return response object', async () => {
    const postData = { title: 'foo', body: 'bar', userId: 1 };
    const response = await grab.post('https://jsonplaceholder.typicode.com/posts', postData, {
      headers: { 'Content-type': 'application/json; charset=UTF-8' }
    });
    expect(response.data).toHaveProperty('title', 'foo');
    expect(response.data).toHaveProperty('body', 'bar');
    expect(response.data).toHaveProperty('userId', 1);
    expect(response.status).toBe(201);
  });

  it('should work with instance-based API', async () => {
    const api = GrabInstance.create({
      baseURL: 'https://jsonplaceholder.typicode.com',
      timeout: 10000
    });
    
    const response = await api.get('/posts/1');
    expect(response.data).toHaveProperty('id', 1);
    expect(response.config.baseURL).toBe('https://jsonplaceholder.typicode.com');
  });

  it('should handle interceptors', async () => {
    const api = GrabInstance.create();
    
    // Add request interceptor
    api.interceptors.request.use((config: any) => {
      config.headers = config.headers || {};
      config.headers['X-Custom-Header'] = 'test';
      return config;
    });

    // Add response interceptor
    api.interceptors.response.use((response: any) => {
      response.data.intercepted = true;
      return response;
    });

    const response = await api.get('https://jsonplaceholder.typicode.com/posts/1');
    expect(response.data.intercepted).toBe(true);
  });
});