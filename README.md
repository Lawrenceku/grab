# Grab API

A lightweight, Promise-based HTTP client for browser environments.

## Installation

```bash
npm install grab-api
```

## Usage

### Basic GET Request

```typescript
import { grab } from 'grab-api';

// Simple GET request
grab('GET', { 
  url: 'https://api.example.com/data' 
})
  .then(data => console.log(data))
  .catch(error => console.error(error));

// GET request with parameters
grab('GET', { 
  url: 'https://api.example.com/search',
  params: { q: 'search term' }
})
  .then(data => console.log(data));

// POST request with body
grab('POST', { 
  url: 'https://api.example.com/users',
  body: { name: 'John Doe', email: 'john@example.com' }
})
  .then(data => console.log(data));
```

## API Reference

### `grab<T>(method: HttpMethods, config: RequestConfig): Promise<T>`

#### Parameters
- `method`: HTTP method (GET, POST, PUT, DELETE, etc.)
- `config`: Request configuration object
  - `url`: Target URL (required)
  - `params`: Query parameters (optional)
  - `body`: Request body (optional)
  - `headers`: Custom headers (optional)
  - `timeout`: Request timeout in ms (default: 60000)
  - `responseType`: XMLHttpRequest response type (default: 'json')

## Contribution

Contributions are welcome! Here are some steps to help you get started:

1. **Fork the repository**: Click the "Fork" button at the top right of the repository page.
   
2. **Clone your fork**: Use the following command to clone your fork to your local machine:

   ```bash
   git clone https://github.com/your-username/grab-api.git
   ```

3. **Create a new branch**: It's a good practice to create a new branch for your changes. Use the command below to create a new branch:

   ```bash
   git checkout -b your-feature-branch
   ```

4. **Make your changes**: Implement your feature or fix the issue you want to address.

5. **Run tests**: If applicable, make sure all tests pass. You can run tests with:

   ```bash
   npm test
   ```

6. **Commit your changes**: Use the following commands to stage and commit your changes:

   ```bash
   git add .
   git commit -m "Description of your changes"
   ```

7. **Push to your fork**: Push your changes back to your fork on GitHub:

   ```bash
   git push origin your-feature-branch
   ```

8. **Create a pull request**: Go to the original repository and click on "New Pull Request." Select your branch and submit the pull request for review.

9. **Discuss and update**: If feedback is provided, feel free to make additional changes to your branch and push them. The pull request will automatically update.

## License

MIT License
