<br>
<div align="center" style="margin-bottom:1000px;">
  <img src="https://raw.githubusercontent.com/Lawrenceku/assets/refs/heads/main/images/grab-logo.png" alt="Logo" width="400" style="margin-bottom: 15px;"/>
  <p style="font-size: 16px; font-weight: bold; margin-bottom: 25px;">A lightweight, Promise-based HTTP client for browser and Nodejs environments.</p>
</div>

<div align="center">
  
[![npm version](https://img.shields.io/npm/v/grab-api.svg?style=flat-square)](https://www.npmjs.org/package/grab-api)
[![Build status](https://img.shields.io/github/actions/workflow/status/grab-api/grab-api/ci.yml?branch=v1.x&label=CI&logo=github&style=flat-square)](https://github.com/lawrenceku/grab/actions/workflows/ci.yml)
[![install size](https://img.shields.io/badge/dynamic/json?url=https://packagephobia.com/v2/api.json?p=grab-api&query=$.install.pretty&label=install%20size&style=flat-square)](https://packagephobia.now.sh/result?p=grab-api)
[![npm downloads](https://img.shields.io/npm/dm/grab-api.svg?style=flat-square)](https://npm-stat.com/charts.html?package=grab-api)
[![Known Vulnerabilities](https://snyk.io/test/npm/grab-api/badge.svg)](https://snyk.io/test/npm/grab-api)

</div>
<br><br>


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
