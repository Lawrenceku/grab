import { grab } from '../src/index';

describe('grab', () => {
  it('should perform a GET request and return data', async () => {
    const data = await grab('GET', { url: 'https://jsonplaceholder.typicode.com/posts/1' });
    expect(data).toHaveProperty('id', 1);
  });

  it('should perform a POST request and return created data', async () => {
    const postData = { title: 'foo', body: 'bar', userId: 1 };
    const data = await grab('POST', {
      url: 'https://jsonplaceholder.typicode.com/posts',
      body: postData,
      headers: { 'Content-type': 'application/json; charset=UTF-8' }
    });
    expect(data).toHaveProperty('title', 'foo');
    expect(data).toHaveProperty('body', 'bar');
    expect(data).toHaveProperty('userId', 1);
  });
});