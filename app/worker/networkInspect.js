/* eslint-disable no-unused-vars */
/* eslint-disable prefer-rest-params */
/* eslint-disable func-names */
/* eslint-disable prefer-arrow-callback */
import getRNDebuggerFetchPolyfills from './polyfills/fetch'

const isWorkerMethod = (fn) => String(fn).indexOf('[native code]') > -1
/* eslint-disable no-underscore-dangle */
let networkInspect

export const toggleNetworkInspect = (enabled) => {
  if (!enabled && networkInspect) {
    self.fetch = networkInspect.fetch
    self.XMLHttpRequest = networkInspect.XMLHttpRequest
    self.FormData = networkInspect.FormData
    self.Headers = networkInspect.Headers
    self.Response = networkInspect.Response
    self.Request = networkInspect.Request
    networkInspect = null
    return
  }
  if (!enabled) return
  if (enabled && networkInspect) return
  if (isWorkerMethod(self.XMLHttpRequest) || isWorkerMethod(self.FormData)) {
    console.warn(
      '[RNDebugger] ' +
        'I tried to enable Network Inspect but XHR ' +
        "have been replaced by worker's XHR. " +
        'You can disable Network Inspect (documentation: https://goo.gl/BVvEkJ) ' +
        'or tracking your app code if you have called ' +
        '`global.XMLHttpRequest = global.originalXMLHttpRequest`.',
    )
    return
  }

  networkInspect = {
    fetch: self.fetch,
    XMLHttpRequest: self.XMLHttpRequest,
    FormData: self.FormData,
    Headers: self.Headers,
    Request: self.Request,
    Response: self.Response,
  }

  self.XMLHttpRequest = self.originalXMLHttpRequest
    ? self.originalXMLHttpRequest
    : self.XMLHttpRequest

  const OriginalXMLHttpRequest = self.XMLHttpRequest

  function CustomXMLHttpRequest() {
    const xhr = new OriginalXMLHttpRequest()
    let requestBody = null

    // Intercept the 'open' method if you need the URL and method
    const originalOpen = xhr.open
    xhr.open = function (method, url, _async, _user, _password) {
      xhr._method = method
      xhr._url = url
      return originalOpen.apply(this, arguments)
    }

    // Intercept the 'send' method to capture the request body
    const originalSend = xhr.send
    // eslint-disable-next-line func-names
    xhr.send = function (body, ...args) {
      requestBody = body // Capture the request body here

      // If the request body is a FormData object, convert it to a readable format
      if (body instanceof FormData) {
        const formData = {}
        body.forEach((value, key) => {
          formData[key] = value
        })
        requestBody = JSON.stringify(formData)
      }

      return originalSend.apply(this, arguments)
    }

    xhr.addEventListener('readystatechange', function () {
      if (xhr.readyState === 4) {
        const requestDetail = {
          url: xhr._url,
          method: xhr._method,
          requestBody,
          response: xhr.response,
        }
        window.postMessage({
          requestDetail,
          source: 'networkInspect',
        })
      }
    })

    return xhr
  }

  self.XMLHttpRequest = CustomXMLHttpRequest

  self.FormData = self.originalFormData ? self.originalFormData : self.FormData
  const { fetch, Headers, Request, Response } = getRNDebuggerFetchPolyfills()

  self.fetch = fetch
  self.Headers = Headers
  self.Request = Request
  self.Response = Response

  console.log(
    '[RNDebugger]',
    'Network Inspect is enabled,',
    'see the documentation (https://goo.gl/yEcRrU) for more information.',
  )
}

/*
 * `originalXMLHttpRequest` haven't permission to set forbidden header name
 * (https://developer.mozilla.org/en-US/docs/Glossary/Forbidden_header_name)
 * We have to use Electron session to solve this problem (See electron/main.js)
 */
const forbiddenHeaderNames = [
  'Accept-Charset',
  'Accept-Encoding',
  'Access-Control-Request-Headers',
  'Access-Control-Request-Method',
  'Connection',
  'Content-Length',
  'Cookie',
  'Cookie2',
  'Date',
  'DNT',
  'Expect',
  'Host',
  'Keep-Alive',
  'Origin',
  'Referer',
  'TE',
  'Trailer',
  'Transfer-Encoding',
  'Upgrade',
  'Via',
  // Actually it still blocked on Chrome
  'User-Agent',
]
forbiddenHeaderNames.forEach((name) =>
  forbiddenHeaderNames.push(name.toLowerCase()),
)

const isForbiddenHeaderName = (header) =>
  forbiddenHeaderNames.includes(header) ||
  header.startsWith('Proxy-') ||
  header.startsWith('proxy-') ||
  header.startsWith('Sec-') ||
  header.startsWith('sec-')

export const replaceForbiddenHeadersForWorkerXHR = () => {
  if (!isWorkerMethod(self.XMLHttpRequest)) return
  const originalSetRequestHeader =
    self.XMLHttpRequest.prototype.setRequestHeader
  self.XMLHttpRequest.prototype.setRequestHeader = function setRequestHeader(
    header,
    value,
  ) {
    let replacedHeader = header
    if (isForbiddenHeaderName(header)) {
      replacedHeader = `__RN_DEBUGGER_SET_HEADER_REQUEST_${header}`
    }
    return originalSetRequestHeader.call(this, replacedHeader, value)
  }
}

export const addURIWarningForWorkerFormData = () => {
  if (!isWorkerMethod(self.FormData)) return
  const originAppend = FormData.prototype.append
  self.FormData.prototype.append = function append(key, value) {
    if (value && value.uri) {
      console.warn(
        '[RNDebugger] ' +
          "Detected you're enabled Network Inspect and using `uri` in FormData, " +
          'it will be a problem if you use it for upload, ' +
          'please see the documentation (https://goo.gl/yEcRrU) for more information.',
      )
    }
    return originAppend.call(this, key, value)
  }
}
