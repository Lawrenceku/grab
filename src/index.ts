import { request as httpsRequest } from 'https'
import { URL } from 'url'

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
 * A lightweight and improved alternative to fetch api and axios
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

    if (typeof window !== 'undefined' && window.XMLHttpRequest) {
        // Browser environment
        return grabBrowser<T>(method, finalUrl, body, headers, timeout, responseType)
    } else {
        // Node.js environment
        return grabNode<T>(method, finalUrl, body, headers, timeout)
    }
}

function grabBrowser<T>(method: HttpMethods, url: string, body: any, headers: Record<string, string>, timeout: number, responseType: XMLHttpRequestResponseType): Promise<T> {
    return new Promise<T>((resolve, reject) => {
        const xhr = new XMLHttpRequest()
        xhr.open(method, url)
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

        // Add timeout handling
        if (timeout) {
            setTimeout(() => {
                xhr.abort()
                reject(new Error(`Request timeout after ${timeout}ms`))
            }, timeout)
        }
    })
}

function grabNode<T>(method: HttpMethods, url: string, body: any, headers: Record<string, string>, timeout: number): Promise<T> {
    return new Promise<T>((resolve, reject) => {
        const urlObj = new URL(url)
        const options = {
            method,
            headers,
            timeout
        }

        const req = httpsRequest(urlObj, options, (res) => {
            let data = ''
            res.on('data', (chunk) => {
                data += chunk
            })

            res.on('end', () => {
                if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) {
                    resolve(JSON.parse(data))
                } else {
                    const error = new Error(`Request failed with status: ${res.statusCode}`) as GrabError
                    error.status = res.statusCode
                    error.response = data
                    reject(error)
                }
            })
        })

        req.on('error', (err) => {
            reject(new Error(`Network error occurred: ${err.message}`))
        })

        // Send the request
        if (body) {
            req.setHeader('Content-Type', 'application/json')
            req.write(JSON.stringify(body))
        }

        req.end()

        // Add timeout handling
        req.setTimeout(timeout, () => {
            req.destroy()
            reject(new Error(`Request timeout after ${timeout}ms`))
        })
    })
}

export { grab, type HttpMethods, type RequestConfig, type GrabError }