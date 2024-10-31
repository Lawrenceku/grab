// Types
type HttpMethods = 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH' | 'OPTIONS' | 'HEAD' | 'CONNECT' | 'TRACE'

interface RequestConfig {
    url: string
    params?: Record<string, any>
    body?: any
    headers?: Record<string, string>
    timeout?: number
    responseType?: XMLHttpRequestResponseType
}

interface GrabError extends Error {
    status?: number
    response?: any
}

/**
 * A lightweight and improved alternative to traditional promise-based HTTP clients
 * @param method The HTTP method to use
 * @param config Request configuration
 * @returns Promise that resolves with the response data
 * @throws {GrabError} When request fails or times out
 */
function grab<T>(method: HttpMethods = 'GET', config: RequestConfig): Promise<T> {
    const {
        url,
        params,
        body,
        headers = {},
        timeout = 60000,
        responseType = 'json'
    } = config

    // Construct URL with query parameters
    const finalUrl = params 
        ? `${url}${url.includes('?') ? '&' : '?'}${new URLSearchParams(params)}`
        : url

    const requestPromise = new Promise<T>((resolve, reject) => {
        const xhr = new XMLHttpRequest()
        xhr.open(method, finalUrl)
        xhr.responseType = responseType

        // Set default headers
        xhr.setRequestHeader('Accept', 'application/json')
        
        // Set custom headers
        Object.entries(headers).forEach(([key, value]) => {
            xhr.setRequestHeader(key, value)
        })

        // Handle successful response
        xhr.onload = () => {
            if (xhr.status >= 200 && xhr.status < 300) {
                resolve(xhr.response)
            } else {
                const error = new Error(`Request failed with status: ${xhr.status}`) as GrabError
                error.status = xhr.status
                error.response = xhr.response
                reject(error)
            }
        }

        // Handle network errors
        xhr.onerror = () => {
            reject(new Error("Network error occurred"))
        }

        // Send the request
        if (body) {
            xhr.setRequestHeader('Content-Type', 'application/json')
            xhr.send(JSON.stringify(body))
        } else {
            xhr.send()
        }
    })

    // Add timeout handling
    if (timeout) {
        const timeoutPromise = new Promise<never>((_, reject) => {
            setTimeout(() => {
                reject(new Error(`Request timeout after ${timeout}ms`))
            }, timeout)
        })

        return Promise.race([requestPromise, timeoutPromise])
    }

    return requestPromise
}

export { grab, type HttpMethods, type RequestConfig, type GrabError }