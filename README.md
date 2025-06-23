<br>
<div align="center" style="margin-bottom:1000px;">
  <img src="https://raw.githubusercontent.com/Lawrenceku/assets/refs/heads/main/images/grab-logo.png" alt="Logo" width="250" style="margin-bottom: 15px;"/>
  <p style="font-size: 16px; font-weight: bold; margin-bottom: 25px;">A lightweight, Promise-based HTTP client for browser and Nodejs environments with axios-like API.</p>
</div>

<div align="center">
  
[![npm version](https://img.shields.io/npm/v/grab-api.svg?style=flat-square)](https://www.npmjs.org/package/grab-api)
[![Build status](https://img.shields.io/github/actions/workflow/status/grab-api/grab-api/ci.yml?branch=v1.x&label=CI&logo=github&style=flat-square)](https://github.com/lawrenceku/grab/actions/workflows/ci.yml)
[![install size](https://img.shields.io/badge/dynamic/json?url=https://packagephobia.com/v2/api.json?p=grab-api&query=$.install.pretty&label=install%20size&style=flat-square)](https://packagephobia.now.sh/result?p=grab-api)
[![npm downloads](https://img.shields.io/npm/dm/grab-api.svg?style=flat-square)](https://npm-stat.com/charts.html?package=grab-api)
[![Known Vulnerabilities](https://snyk.io/test/npm/grab-api/badge.svg)](https://snyk.io/test/npm/grab-api)

</div>
<br><br>

## 🚀 Features

- **Axios-like API** - Familiar interface for easy migration
- **Instance-based configuration** - Create configured instances with defaults
- **Request/Response Interceptors** - Transform requests and responses globally
- **Cross-platform** - Works in both browser and Node.js environments
- **TypeScript support** - Full type definitions included
- **Request cancellation** - Support for AbortController
- **Progress tracking** - Upload and download progress callbacks
- **Automatic transforms** - JSON parsing and stringifying
- **Error handling** - Detailed error objects with request/response data
- **Lightweight** - Small bundle size with no external dependencies

## Installation

```bash
npm install grab-api
```

## Quick Start

### Basic Usage

```typescript
import { grab } from 'grab-api';

// Simple GET request
const response = await grab.get('https://api.example.com/data');
console.log(response.data);

// POST request with data
const response = await grab.post('https://api.example.com/users', {
  name: 'John Doe',
  email: 'john@example.com'
});
console.log(response.data);
```

### Instance-based API

```typescript
import { GrabInstance } from 'grab-api';

// Create a configured instance
const api = GrabInstance.create({
  baseURL: 'https://api.example.com',
  timeout: 5000,
  headers: {
    'Authorization': 'Bearer your-token',
    'Content-Type': 'application/json'
  }
});

// Use the instance
const users = await api.get('/users');
const newUser = await api.post('/users', { name: 'Jane' });
```

### Interceptors

```typescript
import { GrabInstance } from 'grab-api';

const api = GrabInstance.create();

// Request interceptor
api.interceptors.request.use((config) => {
  // Add auth token to all requests
  config.headers = config.headers || {};
  config.headers['Authorization'] = `Bearer ${getToken()}`;
  return config;
});

// Response interceptor
api.interceptors.response.use(
  (response) => {
    // Transform successful responses
    return response;
  },
  (error) => {
    // Handle errors globally
    if (error.status === 401) {
      // Redirect to login
      window.location.href = '/login';
    }
    return Promise.reject(error);
  }
);
```

### Request Cancellation

```typescript
import { grab } from 'grab-api';

const controller = new AbortController();

// Start the request
const request = grab.get('https://api.example.com/data', {
  signal: controller.signal
});

// Cancel the request
setTimeout(() => {
  controller.abort();
}, 5000);

try {
  const response = await request;
} catch (error) {
  if (GrabInstance.isCancel(error)) {
    console.log('Request was cancelled');
  }
}
```

### Progress Tracking

```typescript
import { grab } from 'grab-api';

const response = await grab.post('https://api.example.com/upload', formData, {
  onUploadProgress: (progressEvent) => {
    const percentCompleted = Math.round(
      (progressEvent.loaded * 100) / progressEvent.total
    );
    console.log(`Upload progress: ${percentCompleted}%`);
  },
  onDownloadProgress: (progressEvent) => {
    const percentCompleted = Math.round(
      (progressEvent.loaded * 100) / progressEvent.total
    );
    console.log(`Download progress: ${percentCompleted}%`);
  }
});
```

## API Reference

### Default Instance Methods

- `grab.get(url, config?)` - GET request
- `grab.post(url, data?, config?)` - POST request
- `grab.put(url, data?, config?)` - PUT request
- `grab.delete(url, config?)` - DELETE request
- `grab.patch(url, data?, config?)` - PATCH request
- `grab.request(config)` - Generic request method

### Instance Creation

```typescript
GrabInstance.create(config?: RequestConfig): GrabInstance
```

### Configuration Options

```typescript
interface RequestConfig {
  url?: string
  method?: HttpMethods
  baseURL?: string
  params?: Record<string, any>
  data?: any
  headers?: Record<string, string>
  timeout?: number
  responseType?: XMLHttpRequestResponseType
  signal?: AbortSignal
  onUploadProgress?: (progressEvent: ProgressEvent) => void
  onDownloadProgress?: (progressEvent: ProgressEvent) => void
  validateStatus?: (status: number) => boolean
  transformRequest?: ((data: any, headers: Record<string, string>) => any)[]
  transformResponse?: ((data: any) => any)[]
}
```

### Response Object

```typescript
interface Response<T = any> {
  data: T
  status: number
  statusText: string
  headers: Record<string, string>
  config: RequestConfig
  request?: any
}
```

### Error Object

```typescript
interface GrabError extends Error {
  config?: RequestConfig
  code?: string
  request?: any
  response?: Response
  status?: number
  isAxiosError?: boolean
}
```

## Migration from Axios

Grab is designed to be a drop-in replacement for axios in most cases:

```typescript
// Axios
import axios from 'axios';
const response = await axios.get('/api/data');

// Grab
import { grab } from 'grab-api';
const response = await grab.get('/api/data');
```

The main differences:
- `GrabInstance.create()` instead of `axios.create()`
- `GrabInstance.isCancel()` instead of `axios.isCancel()`
- Slightly different error object structure

## Browser Support

- Modern browsers with ES6+ support
- IE11+ (with polyfills)

## Node.js Support

- Node.js 12+

## License
MIT License
