# Grab API

A new and improved wrapper for making HTTP requests, built to simplify request handling in JavaScript. `grab` enhances error handling, provides timeout support, and automatically manages JSON data, making it a powerful alternative to the Fetch API and XMLHttpRequest.

## Features

- **Flexible HTTP Methods**: Supports all common HTTP methods (`GET`, `POST`, `PUT`, `DELETE`, etc.) with strong typing to ensure valid requests.
- **Automatic JSON Handling**: Automatically handles JSON response parsing, so you don’t need to handle JSON parsing on the receiving end.
- **Timeout Support**: Includes a built-in timeout feature (default: 60 seconds), which can be disabled if not needed.
- **Enhanced Error Management**: Differentiates between network errors and server responses, making debugging more straightforward.

## Table of Contents

1. [Installation](#installation)
2. [Usage](#usage)
3. [Parameters](#parameters)
4. [Improvements Over Fetch API](#improvements-over-fetch-api)
5. [Contribution](#contribution)

---

### Installation

Clone the repository and include the `grab.ts` file in your project:

```bash
git clone <repository-url>
cd <repository-name>
```

Or install it as a dependency if you’ve published it on a package manager:

```bash
npm install grab
```

---

### Usage

The `grab` function allows you to make HTTP requests with just a few parameters. Here’s a quick example to get you started.

```typescript
import grab from './grab';

// Example usage of a GET request
grab('GET', { url: 'https://api.example.com/data' })
  .then(response => console.log(response))
  .catch(error => console.error(error));

// Example usage of a POST request with data and custom timeout
grab('POST', {
    url: 'https://api.example.com/data',
    param: { name: 'Lawrence', age: 25 },
    timed: true,
})
  .then(response => console.log(response))
  .catch(error => console.error(error));
```

---

### Parameters

#### `grab<T>(method: HttpMethods, data: RequestData): Promise<T>`

- **`method`** (required):  
  Type: `HttpMethods`  
  The HTTP method for the request, e.g., `GET`, `POST`, `PUT`, `DELETE`, etc.

- **`data`** (required):  
  Type: `RequestData`  
  An object containing the following properties:
  
  - **`url`** (string): The URL for the request.
  - **`param`** (optional, any): The data to send with the request (e.g., for POST requests). Automatically stringified if provided.
  - **`timed`** (optional, boolean): Enables timeout if set to `true`. Defaults to `true`, with a 60-second timeout duration.

---

### Improvements Over Fetch API

The `grab` function enhances the Fetch API and XMLHttpRequest in the following ways:

1. **Timeout Handling**: Unlike the Fetch API, which lacks native timeout support, `grab` provides built-in timeout functionality that defaults to 60 seconds, preventing requests from hanging indefinitely.
  
2. **Automatic JSON Parsing**: `grab` automatically parses JSON responses, saving you the need to manually parse `JSON.parse` in your code. This is similar to Axios and makes the API easier to work with.
  
3. **Simplified Error Management**: `grab` distinguishes between network errors and non-2xx HTTP status codes, providing clear error messages. This makes it easier to debug both network and server issues.
  
4. **Strongly Typed HTTP Methods**: Enforces type safety on HTTP methods, reducing potential errors due to typos and unsupported HTTP verbs.

---

### Contribution

We welcome contributions! To contribute:

1. **Fork the Repository**:  
   Fork the repository to your GitHub account.

2. **Clone the Repository**:  
   Clone your fork to your local machine.
   ```bash
   git clone https://github.com/your-username/grab.git
   cd grab
   ```

3. **Create a New Branch**:  
   Create a new branch for your feature or bug fix.
   ```bash
   git checkout -b feature-or-bugfix-branch
   ```

4. **Make Changes**:  
   Implement your feature or fix.

5. **Run Tests** (if applicable):  
   Ensure your changes pass all tests and do not break any existing functionality.

6. **Commit and Push**:  
   ```bash
   git add .
   git commit -m "Describe your changes"
   git push origin feature-or-bugfix-branch
   ```

7. **Create a Pull Request**:  
   Submit a pull request to the main repository. Please include a description of your changes and reference any relevant issues.

---

### License

This project is licensed under the MIT License.

---

### Author

Lawrence

---
