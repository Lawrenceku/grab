/**
 * The new and improvedd fetch API
 * @param method: HttpMethods - The method to use for the request
 * @param data: RequestData - The data to send with the request
 * @returns Promise<T> - The response from the server
 *
 */
function grab(method, data) {
    if (method === void 0) { method = 'GET'; }
    var url = data.url, param = data.param, _a = data.timed, timed = _a === void 0 ? true : _a;
    var requestPromise = new Promise(function (resolve, reject) {
        var xhr = new XMLHttpRequest();
        xhr.open(method, data.url);
        if (data.param) {
            xhr.setRequestHeader('Content-Type', 'application/json');
            xhr.send(JSON.stringify(data.param));
        }
        else {
            xhr.send();
        }
        xhr.responseType = 'json';
        xhr.onload = function () {
            if (xhr.status >= 200 && xhr.status < 300) {
                resolve(xhr.response);
            }
            else {
                reject("Request failed with status: ".concat(xhr.status));
            }
        };
        xhr.onerror = function () {
            reject("Network error occured");
        };
    });
    if (timed) {
        var timerPromise = new Promise(function (reject) {
            setTimeout(function () {
                reject('Request Timeout');
            }, 60000);
        });
        return Promise.race([timerPromise, requestPromise]);
    }
    return requestPromise;
}
