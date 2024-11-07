<div align="center">
  <img src="https://raw.githubusercontent.com/Lawrenceku/assets/refs/heads/main/images/grab-logo.png" alt="Logo" width="400" style="margin-bottom: 15px;"/>
  <p style="font-size: 16px; font-weight: bold; margin-bottom: 25px;">A lightweight, Promise-based HTTP client for browser environments.</p>
</div>


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

## License
MIT License
