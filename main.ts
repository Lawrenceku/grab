type HttpMethods = 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH' | 'OPTIONS' | 'HEAD' | 'CONNECT' | 'TRACE'

interface RequestData {
    url: string,
    param?: any,
    timed?:boolean
}

/**
 * The new and improvedd fetch API 
 * @param method: HttpMethods - The method to use for the request
 * @param data: RequestData - The data to send with the request
 * @returns Promise<T> - The response from the server
 * 
 */

function grab<T>(method: HttpMethods = 'GET', data: RequestData): Promise<T> {

    const {url, param, timed=true} = data

    const requestPromise = new Promise<T>((resolve, reject) => {
        const xhr = new XMLHttpRequest()
        xhr.open(method, data.url)
        
        if (data.param) {
            xhr.setRequestHeader('Content-Type', 'application/json')
            xhr.send(JSON.stringify(data.param))
        }else{
            xhr.send()
        }

        xhr.responseType = 'json'
        xhr.onload = () => {
            if (xhr.status >= 200 && xhr.status < 300) {
                resolve(xhr.response)
            } else {
                reject(`Request failed with status: ${xhr.status}`)
            }
        }

        xhr.onerror = () => {
            reject("Network error occured")
        }
    })

    if (timed){
        const timerPromise = new Promise<any>((reject)=>{
            setTimeout(()=>{
                reject('Request Timeout')
            },60000)
        })
        return Promise.race([timerPromise,requestPromise])
    }

    return requestPromise
}
