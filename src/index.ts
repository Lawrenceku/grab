import { request as httpsRequest } from 'https'
import { URL } from 'url'

// Types
type HttpMethods = 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH' | 'OPTIONS' | 'HEAD' | 'CONNECT' | 'TRACE'

interface RequestConfig {
    url?: string
    method?: HttpMethods
    baseURL?: string
    params?: Record<string, any>
    data?: any
    body?: any // Alias for data
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

interface Response<T = any> {
    data: T
    status: number
    statusText: string
    headers: Record<string, string>
    config: RequestConfig
    request?: any
}

interface GrabError extends Error {
    config?: RequestConfig
    code?: string
    request?: any
    response?: Response
    status?: number
    isAxiosError?: boolean
}

interface Interceptor<V> {
    fulfilled?: (value: V) => V | Promise<V>
    rejected?: (error: any) => any
}

interface InterceptorManager<V> {
    use(fulfilled?: (value: V) => V | Promise<V>, rejected?: (error: any) => any): number
    eject(id: number): void
    forEach(fn: (interceptor: Interceptor<V>) => void): void
}

class InterceptorManagerImpl<V> implements InterceptorManager<V> {
    private handlers: Interceptor<V>[] = []

    use(fulfilled?: (value: V) => V | Promise<V>, rejected?: (error: any) => any): number {
        this.handlers.push({ fulfilled, rejected })
        return this.handlers.length - 1
    }

    eject(id: number): void {
        if (this.handlers[id]) {
            this.handlers[id] = {}
        }
    }

    forEach(fn: (interceptor: Interceptor<V>) => void): void {
        this.handlers.forEach(handler => {
            if (handler.fulfilled || handler.rejected) {
                fn(handler)
            }
        })
    }

    getHandlers(): Interceptor<V>[] {
        return this.handlers
    }
}

class GrabInstance {
    private config: RequestConfig
    private requestInterceptors: InterceptorManagerImpl<RequestConfig>
    private responseInterceptors: InterceptorManagerImpl<Response>

    constructor(config: RequestConfig = {}) {
        this.config = {
            timeout: 60000,
            responseType: 'json',
            validateStatus: (status: number) => status >= 200 && status < 300,
            transformRequest: [this.defaultTransformRequest],
            transformResponse: [this.defaultTransformResponse],
            ...config
        }
        this.requestInterceptors = new InterceptorManagerImpl<RequestConfig>()
        this.responseInterceptors = new InterceptorManagerImpl<Response>()
    }

    private defaultTransformRequest(data: any, headers: Record<string, string>): any {
        if (typeof data === 'object' && data !== null) {
            headers['Content-Type'] = headers['Content-Type'] || 'application/json'
            return JSON.stringify(data)
        }
        return data
    }

    private defaultTransformResponse(data: any): any {
        if (typeof data === 'string') {
            try {
                return JSON.parse(data)
            } catch {
                return data
            }
        }
        return data
    }

    private mergeConfig(config: RequestConfig): RequestConfig {
        return {
            ...this.config,
            ...config,
            headers: { ...this.config.headers, ...config.headers }
        }
    }

    private async executeRequest<T>(config: RequestConfig): Promise<Response<T>> {
        // Apply request interceptors
        let finalConfig = config
        for (const interceptor of this.requestInterceptors.getHandlers()) {
            if (interceptor.fulfilled) {
                finalConfig = await interceptor.fulfilled(finalConfig)
            }
        }

        const { url, method = 'GET', baseURL, params, data, body, headers = {}, timeout, responseType, signal, onUploadProgress, onDownloadProgress, validateStatus } = finalConfig

        // Construct final URL
        let finalUrl = url || ''
        if (baseURL) {
            finalUrl = baseURL.replace(/\/+$/, '') + '/' + finalUrl.replace(/^\/+/, '')
        }
        if (params) {
            finalUrl += `${finalUrl.includes('?') ? '&' : '?'}${new URLSearchParams(params)}`
        }

        // Use data or body
        const requestData = data || body

        // Apply request transforms
        let transformedData = requestData
        for (const transform of finalConfig.transformRequest || []) {
            transformedData = transform(transformedData, headers)
        }

        if (typeof window !== 'undefined' && window.XMLHttpRequest) {
            return this.executeBrowserRequest<T>(method, finalUrl, transformedData, headers, timeout, responseType || 'json', signal, onUploadProgress, onDownloadProgress, validateStatus, finalConfig)
        } else {
            return this.executeNodeRequest<T>(method, finalUrl, transformedData, headers, timeout, signal, validateStatus, finalConfig)
        }
    }

    private executeBrowserRequest<T>(
        method: HttpMethods,
        url: string,
        data: any,
        headers: Record<string, string>,
        timeout: number | undefined,
        responseType: XMLHttpRequestResponseType,
        signal: AbortSignal | undefined,
        onUploadProgress: ((progressEvent: ProgressEvent) => void) | undefined,
        onDownloadProgress: ((progressEvent: ProgressEvent) => void) | undefined,
        validateStatus: ((status: number) => boolean) | undefined,
        config: RequestConfig
    ): Promise<Response<T>> {
        return new Promise<Response<T>>((resolve, reject) => {
            const xhr = new XMLHttpRequest()
            xhr.open(method, url)
            xhr.responseType = responseType

            // Set default headers
            if (!headers['Accept']) {
                xhr.setRequestHeader('Accept', 'application/json')
            }
            
            // Set custom headers
            Object.entries(headers).forEach(([key, value]) => {
                xhr.setRequestHeader(key, value)
            })

            // Handle progress
            if (onUploadProgress) {
                xhr.upload.onprogress = onUploadProgress
            }
            if (onDownloadProgress) {
                xhr.onprogress = onDownloadProgress
            }

            // Handle abort signal
            if (signal) {
                signal.addEventListener('abort', () => {
                    xhr.abort()
                    const error = new Error('Request aborted') as GrabError
                    error.code = 'ABORTED'
                    error.config = config
                    reject(error)
                })
            }

            // Handle response
            xhr.onload = () => {
                const response: Response<T> = {
                    data: xhr.response,
                    status: xhr.status,
                    statusText: xhr.statusText,
                    headers: this.parseHeaders(xhr.getAllResponseHeaders()),
                    config
                }

                if (validateStatus ? validateStatus(xhr.status) : xhr.status >= 200 && xhr.status < 300) {
                    // Apply response transforms
                    let transformedData = response.data
                    for (const transform of config.transformResponse || []) {
                        transformedData = transform(transformedData)
                    }
                    response.data = transformedData

                    // Apply response interceptors
                    let finalResponse = response
                    for (const interceptor of this.responseInterceptors.getHandlers()) {
                        if (interceptor.fulfilled) {
                            finalResponse = interceptor.fulfilled(finalResponse) as Response<T>
                        }
                    }
                    resolve(finalResponse)
                } else {
                    const error = new Error(`Request failed with status: ${xhr.status}`) as GrabError
                    error.status = xhr.status
                    error.response = response
                    error.config = config
                    error.isAxiosError = true
                    reject(error)
                }
            }

            // Handle network errors
            xhr.onerror = () => {
                const error = new Error("Network error occurred") as GrabError
                error.config = config
                error.isAxiosError = true
                reject(error)
            }

            // Send the request
            xhr.send(data)

            // Add timeout handling
            if (timeout && timeout > 0) {
                setTimeout(() => {
                    xhr.abort()
                    const error = new Error(`Request timeout after ${timeout}ms`) as GrabError
                    error.code = 'TIMEOUT'
                    error.config = config
                    error.isAxiosError = true
                    reject(error)
                }, timeout)
            }
        })
    }

    private executeNodeRequest<T>(
        method: HttpMethods,
        url: string,
        data: any,
        headers: Record<string, string>,
        timeout: number | undefined,
        signal: AbortSignal | undefined,
        validateStatus: ((status: number) => boolean) | undefined,
        config: RequestConfig
    ): Promise<Response<T>> {
        return new Promise<Response<T>>((resolve, reject) => {
            const urlObj = new URL(url)
            const options = {
                method,
                headers,
                timeout: timeout || undefined
            }

            const req = httpsRequest(urlObj, options, (res) => {
                let responseData = ''
                res.on('data', (chunk) => {
                    responseData += chunk
                })

                res.on('end', () => {
                    const response: Response<T> = {
                        data: responseData as any,
                        status: res.statusCode || 0,
                        statusText: res.statusMessage || '',
                        headers: res.headers as Record<string, string>,
                        config
                    }

                    if (validateStatus ? validateStatus(response.status) : response.status >= 200 && response.status < 300) {
                        // Apply response transforms
                        let transformedData = response.data
                        for (const transform of config.transformResponse || []) {
                            transformedData = transform(transformedData)
                        }
                        response.data = transformedData

                        // Apply response interceptors
                        let finalResponse = response
                        for (const interceptor of this.responseInterceptors.getHandlers()) {
                            if (interceptor.fulfilled) {
                                finalResponse = interceptor.fulfilled(finalResponse) as Response<T>
                            }
                        }
                        resolve(finalResponse)
                    } else {
                        const error = new Error(`Request failed with status: ${response.status}`) as GrabError
                        error.status = response.status
                        error.response = response
                        error.config = config
                        error.isAxiosError = true
                        reject(error)
                    }
                })
            })

            req.on('error', (err) => {
                const error = new Error(`Network error occurred: ${err.message}`) as GrabError
                error.config = config
                error.isAxiosError = true
                reject(error)
            })

            // Handle abort signal
            if (signal) {
                signal.addEventListener('abort', () => {
                    req.destroy()
                    const error = new Error('Request aborted') as GrabError
                    error.code = 'ABORTED'
                    error.config = config
                    error.isAxiosError = true
                    reject(error)
                })
            }

            // Send the request
            if (data) {
                req.write(data)
            }
            req.end()

            // Add timeout handling
            if (timeout && timeout > 0) {
                req.setTimeout(timeout, () => {
                    req.destroy()
                    const error = new Error(`Request timeout after ${timeout}ms`) as GrabError
                    error.code = 'TIMEOUT'
                    error.config = config
                    error.isAxiosError = true
                    reject(error)
                })
            }
        })
    }

    private parseHeaders(headersString: string): Record<string, string> {
        const headers: Record<string, string> = {}
        const pairs = headersString.trim().split('\n')
        pairs.forEach(pair => {
            const [key, value] = pair.split(': ')
            if (key && value) {
                headers[key.toLowerCase()] = value
            }
        })
        return headers
    }

    // Public API methods
    request<T = any>(config: RequestConfig): Promise<Response<T>> {
        const mergedConfig = this.mergeConfig(config)
        return this.executeRequest<T>(mergedConfig)
    }

    get<T = any>(url: string, config?: Omit<RequestConfig, 'url' | 'method'>): Promise<Response<T>> {
        return this.request<T>({ ...config, url, method: 'GET' })
    }

    post<T = any>(url: string, data?: any, config?: Omit<RequestConfig, 'url' | 'method' | 'data'>): Promise<Response<T>> {
        return this.request<T>({ ...config, url, method: 'POST', data })
    }

    put<T = any>(url: string, data?: any, config?: Omit<RequestConfig, 'url' | 'method' | 'data'>): Promise<Response<T>> {
        return this.request<T>({ ...config, url, method: 'PUT', data })
    }

    delete<T = any>(url: string, config?: Omit<RequestConfig, 'url' | 'method'>): Promise<Response<T>> {
        return this.request<T>({ ...config, url, method: 'DELETE' })
    }

    patch<T = any>(url: string, data?: any, config?: Omit<RequestConfig, 'url' | 'method' | 'data'>): Promise<Response<T>> {
        return this.request<T>({ ...config, url, method: 'PATCH', data })
    }

    // Interceptors
    get interceptors() {
        return {
            request: this.requestInterceptors,
            response: this.responseInterceptors
        }
    }

    // Static methods
    static create(config?: RequestConfig): GrabInstance {
        return new GrabInstance(config)
    }

    static isCancel(value: any): boolean {
        return value && value.code === 'ABORTED'
    }
}

// Default instance
const grab = new GrabInstance()

// Export everything
export { 
    grab, 
    GrabInstance, 
    type HttpMethods, 
    type RequestConfig, 
    type Response, 
    type GrabError,
    type InterceptorManager
}

// Default export
export default grab 