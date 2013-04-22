var spdy = require('spdy'),
    https = require('https'),
    http = require('http'), 
    stream = require('stream'),
    events = require('events'), 
    util = require('util'),
    net = require('net'),
    tls = require('tls'), 
    utils = require('./utils'),
    connection = require('./connection'),
    request = require('./request'),
    log4js = require('log4js'),
    Buffer = require('buffer').Buffer;

/* ----INIT---- */
var logger = log4js.getLogger('CLIENT');
logger.setLevel('ERROR');

var client = exports;
client.connections = {};
client.logger = logger;

client.setLogLevel = function(level) {
    this.logger.setLevel(level);
    connection.logger.setLevel(level);
    request.logger.setLevel(level);
}


client.protocolSpdyVersion = 3;

//
// ### function get (options, callback)
// #### @options {Object} request options
// #### @callback {Function} (optional) request callback
// do request - GET method
//
client.get = function(options, callback) {
    var _options = options;
    _options.method = 'GET';
    return client.request(_options, callback);
}

// -------------------------------- Get TCP connection-----
// return ClientSpdyConnection
//
// ### function getConnection (host, port, plain)
// #### @host {String} server host
// #### @port {Integer} server port
// #### @plain {Boolean} (optional) plain or tls connection
// Get the TCP connection
//
client.getConnection = function(host, port, plain) {
    var key = (plain ? "http" : "https") + "://" + host + ":" + port;
    var conn = this.connections[key];
    if (conn == null) {
        /* create a connection */
        var conn = new connection.ClientSpdyConnection(host, port, plain, client.protocolSpdyVersion);
        /* add it to the stack */
        this.connections[key] = conn;
    }
    return conn;
}

//
// ### function request (options, callback)
// #### @options {Object} request options
// #### @callback {Function} (optional) request callback
// send a request
//
client.request = function(options, callback) {
    /*
     * first thing to do is to get an existing spdy connection with the given
     * host
     */
    var spdyConnection = this.getConnection(options.host, options.port,
            options.plain);
    /* second, push the request to the spdy connection */
    return spdyConnection.startRequest(options, callback);
}

//
// ### function ping (options, callback)
// #### @options {Object} request options
// #### @callback {Function} (optional) request callback
// Ping the server
//
client.ping = function(options, callback) {
    var conn = this.getConnection(options.host, options.port, options.plain);
    if (callback) {
        conn.addListener('ping', callback);
    }
    return conn.ping();
}

//
// ### function post (options, callback)
// #### @options {Object} request options
// #### @callback {Function} (optional) request callback
// do request - POST method
//
client.post = function(options, callback) {
    var _options = options;
    _options.method = 'POST';
    return client.request(_options, callback);
}

//
// ### function put (options, callback)
// #### @options {Object} request options
// #### @callback {Function} (optional) request callback
// do request - PUT method
//
client.put = function(options, callback) {
    var _options = options;
    _options.method = 'PUT';
    return client.request(_options, callback);
}

//
// ### function optionsMethod (options, callback)
// #### @options {Object} request options
// #### @callback {Function} (optional) request callback
// do request - OPTIONS method
//
client.optionsMethod = function(options, callback) {
    var _options = options;
    _options.method = 'OPTIONS';
    return client.request(_options, callback);
}

//
// ### function head (options, callback)
// #### @options {Object} request options
// #### @callback {Function} (optional) request callback
// do request - HEAD method
//
client.head = function(options, callback) {
    var _options = options;
    _options.method = 'HEAD';
    return client.request(_options, callback);
}

//
// ### function connectMethod (options, callback)
// #### @options {Object} request options
// #### @callback {Function} (optional) request callback
// do request - CONNECT method
//
client.connectMethod = function(options, callback) {
    var _options = options;
    _options.method = 'CONNECT';
    return client.request(_options, callback);
}

//
// ### function deleteMethod (options, callback)
// #### @options {Object} request options
// #### @callback {Function} (optional) request callback
// do request - DELETE method
//
client.deletetMethod = function(options, callback) {
    var _options = options;
    _options.method = 'DELETE';
    return client.request(_options, callback);
}

//
// ### function trace (options, callback)
// #### @options {Object} request options
// #### @callback {Function} (optional) request callback
// do request - TRACE method
//
client.traceMethod = function(options, callback) {
    var _options = options;
    _options.method = 'TRACE';
    return client.request(_options, callback);
}
