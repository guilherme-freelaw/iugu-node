'use strict';

var http = require('http');
var https = require('https');
var path = require('path');
var when = require('when');

var utils = require('./utils');
var Error = require('./Error');

var hasOwn = {}.hasOwnProperty;

// Provide extension mechanism for Iugu Resource Sub-Classes
IuguResource.extend = utils.protoExtend;

// Expose method-creator & prepared (basic) methods
IuguResource.method = require('./IuguMethod');
IuguResource.BASIC_METHODS = require('./IuguMethod.basic');

/**
 * Encapsulates request logic for a Iugu Resource
 */
function IuguResource(iugu, urlData) {
  this._iugu = iugu;
  this._urlData = urlData || {};

  this.basePath = utils.makeURLInterpolator(iugu.getApiField('basePath'));
  this.path = utils.makeURLInterpolator(this.path);

  if (this.includeBasic) {
    this.includeBasic.forEach(function (methodName) {
      this[methodName] = IuguResource.BASIC_METHODS[methodName];
    }, this);
  }

  this.initialize.apply(this, arguments);
}

IuguResource.prototype = {
  path: '',

  initialize: function () {},

  createFullPath: function (commandPath, urlData) {
    return path
      .join(
        this.basePath(urlData),
        this.path(urlData),
        typeof commandPath == 'function' ? commandPath(urlData) : commandPath
      )
      .replace(/\\/g, '/'); // ugly workaround for Windows
  },

  createUrlData: function () {
    var urlData = {};
    // Merge in baseData
    for (var i in this._urlData) {
      if (hasOwn.call(this._urlData, i)) {
        urlData[i] = this._urlData[i];
      }
    }
    return urlData;
  },

  createDeferred: function (callback) {
    var deferred = when.defer();

    if (callback) {
      // Callback, if provided, is a simply translated to Promise'esque:
      // (Ensure callback is called outside of promise stack)
      deferred.promise.then(
        function (res) {
          setTimeout(function () {
            callback(null, res);
          }, 0);
        },
        function (err) {
          setTimeout(function () {
            callback(err, null);
          }, 0);
        }
      );
    }

    return deferred;
  },

  _timeoutHandler: function (timeout, req, callback) {
    var self = this;
    return function () {
      var timeoutErr = new Error('ETIMEDOUT');
      timeoutErr.code = 'ETIMEDOUT';

      req._isAborted = true;
      req.abort();

      callback.call(
        self,
        new Error.IuguConnectionError({
          message: 'Request aborted due to timeout being reached (' + timeout + 'ms)',
          detail: timeoutErr,
        }),
        null
      );
    };
  },

  _responseHandler: function (req, callback) {
    var self = this;
    return function (res) {
      var response = '';

      res.setEncoding('utf8');
      res.on('data', function (chunk) {
        response += chunk;
      });
      res.on('end', function () {
        try {
          response = JSON.parse(response);
          if (response.error) {
            var err;
            if (res.statusCode === 401) {
              err = new Error.IuguAuthenticationError(response.error);
            } else {
              err = Error.IuguError.generate(response.error);
            }
            return callback.call(self, err, null);
          }
        } catch (e) {
          return callback.call(
            self,
            new Error.IuguAPIError({
              message: 'Invalid JSON received from the Iugu API',
              response: response,
              exception: e,
            }),
            null
          );
        }
        callback.call(self, null, response);
      });
    };
  },

  _errorHandler: function (req, callback) {
    var self = this;
    return function (error) {
      if (req._isAborted) return; // already handled
      callback.call(
        self,
        new Error.IuguConnectionError({
          message: 'An error occurred with our connection to Iugu',
          detail: error,
        }),
        null
      );
    };
  },

  _request: function (method, path, data, auth, callback) {
    var requestMethod = (method || 'GET').toUpperCase();
    var isGet = requestMethod === 'GET';

    // For GET requests, serialize params into query string and avoid sending a body
    var serializedForBody = data || {};
    var requestData;
    if (isGet) {
      // Shallow clone to avoid mutating caller data
      var qsData = {};
      for (var key in data || {}) {
        if (Object.prototype.hasOwnProperty.call(data, key)) qsData[key] = data[key];
      }
      // Map legacy parameter names to current API where applicable
      if (qsData.hasOwnProperty('count') && !qsData.hasOwnProperty('limit')) {
        qsData.limit = qsData.count;
        delete qsData.count;
      }
      requestData = utils.stringifyRequestData(qsData);
      if (requestData && requestData.length > 0) {
        path = path + (path.indexOf('?') === -1 ? '?' : '&') + requestData;
      }
    } else {
      requestData = utils.stringifyRequestData(serializedForBody);
    }
    var self = this;
    var apiVersion = this._iugu.getApiField('version');
    var headers = {
      // Use specified auth token or use default from this stripe instance:
      Authorization: auth
        ? 'Basic ' + Buffer.from(auth + ':').toString('base64')
        : this._iugu.getApiField('auth'),
      Accept: 'application/json',
      'User-Agent': 'Iugu/v1 NodeBindings/' + this._iugu.getConstant('PACKAGE_VERSION'),
    };
    // Only set content headers when sending a body
    if (!isGet) {
      headers['Content-Type'] = 'application/x-www-form-urlencoded';
      headers['Content-Length'] = Buffer.byteLength(requestData);
    }

    if (apiVersion) {
      headers['Iugu-Version'] = apiVersion;
    }

    // Grab client-user-agent before making the request:
    this._iugu.getClientUserAgent(function (cua) {
      headers['X-Iugu-Client-User-Agent'] = cua;
      makeRequest();
    });

    function makeRequest() {
      var timeout = self._iugu.getApiField('timeout');

      var isHttp = self._iugu.getApiField('protocol') === 'http';
      var req = (isHttp ? http : https).request({
        host: self._iugu.getApiField('host'),
        port: self._iugu.getApiField('port'),
        path: path,
        method: requestMethod,
        headers: headers,
      });

      req.setTimeout(timeout, self._timeoutHandler(timeout, req, callback));
      req.on('response', self._responseHandler(req, callback));
      req.on('error', self._errorHandler(req, callback));

      req.on('socket', function (socket) {
        function send() {
          if (!isGet) {
            req.write(requestData);
          }
          req.end();
        }
        if (isHttp) {
          // For plain HTTP, use 'connect'
          socket.on('connect', send);
        } else {
          // For HTTPS, wait for TLS handshake
          socket.on('secureConnect', send);
        }
      });
    }
  },
};

module.exports = IuguResource;
