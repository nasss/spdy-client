var spdy = require('spdy'), 
    util = require('util'),
    stream = require('stream'),
    log4js = require('log4js');

// ----------------------------INIT-----------------------------
var logger = log4js.getLogger('REQUEST');
logger.setLevel('DEBUG');

var request = exports;
request.logger = logger;

//
// ### function ClientSpdyRequest (options, callback, conn)
// #### @options {Object} request options
// #### @callback {Function} request callback
// #### @conn {ClientSpdyConnection} TCP connection
// TCP connection @constructor
//
function ClientSpdyRequest(options, callback, conn) {
    stream.Duplex.call(this);
    var self = this;
    this.options = options;
    this.callback = callback;
    this.id = -1;
    this.priority = 0;
    this.connection = conn;
    this.socket = conn.socket;
    this.pendingData = [];
    this.isPendingData = true;
    this.isPendingRequest = true;
    this.contentLgh = 0;

    /* TODO : How much data can be sent TO client before next WINDOW_UPDATE */
    this._sinkSize = conn.sinkSize;
    this._initialSinkSize = conn.sinkSize;
    this._sinkBuffer = [];

    this.halfclosed = {
        client : false,
        server : false
    };
    this.pushedStreams = [];
    this.onpush = onPushDefaultCB;

    this.on('socket', function(s) {
        this.socket = s;
    });
    this.on('push', this.onpush);

    this.on('flushdata', this.flushPendingData);

    this.on('error', function(e) {
        logger.error(e);
    })

    return self;
}
util.inherits(ClientSpdyRequest, stream.Duplex);

request.ClientSpdyRequest = ClientSpdyRequest;

// 
// ### function onPushDefaultCB (frame)
// #### @frame {Object} frame generated
// default callback for push event
//
function onPushDefaultCB(frame) {
    logger.info("THIS IS A STUB CALLBACK FOR PUSHED STREAMS -  frame = "
            + frame);
}

//
// ### function halfClose ()
// Set the request on half-closed state (client side)
//
ClientSpdyRequest.prototype.halfClose = function halfClose() {
    this.halfclosed.client = true;
}

//
// ### function write (data, encoding, callback)
// #### @data {String|Buffer} data
// #### @encoding {String} (optional) encoding
// #### @callback {Function} (optional) write callback
// Writes data to socket
//
ClientSpdyRequest.prototype.write = function write(data, encoding, callback) {
    // Do not send data to new connections after GOAWAY
    if (this.isGoaway())
        return;

    this._write(data, encoding, callback);
}

//
// ### function write (data, encoding, callback)
// #### @data {String|Buffer} data
// #### @encoding {String} (optional) encoding
// #### @callback {Function} (optional) write callback
// Writes data to socket
//
ClientSpdyRequest.prototype._write = function _write(data, encoding, callback) {
    /* TODO : handle goaway */
    /* TODO sinkSize handler */

    /* This client will NOT send further frames on that stream */
    if (this.halfclosed.client) {
        this.emit('error', '_write : is on half closed state for stream :'
                + this.id);
        logger.error(data);
        return;
    }
    /* verify content-length */
    this.contentLgh += Buffer.byteLength(data, encoding);
    this._writeData(data, encoding, false, callback);

}

//
// ### function write (data, encoding, callback)
// #### @data {String|Buffer} data
// #### @encoding {String} (optional) encoding
// #### @callback {Function} (optional) write callback
// Internal - Writes data to socket
//
ClientSpdyRequest.prototype._writeData = function _writeData(data, encoding,
        pfin, callback) {

    if (this.isPendingData) {

        this.pendingData.push({
            data : data,
            encoding : encoding,
            fin : pfin,
            callback : callback
        });

        return;
    }

    if (pfin) {
        var contentLghHeader = this.options.headers['Content-Length'];
        if (contentLghHeader == null) {
            /* TODO write HEADERS frame ? */
            /*
             * This case is handled now within "end" and "contentLengthHandler"
             * functions
             */
        } else {
            /* Content-Length header exists but its value is not as expected : */

            var expected = this.options.headers['Content-Length'];
            if (expected != this.contentLgh) {
                this.connection._rstCode = 6; // Internal_error
                this.connection.closeRequest(this.id, new Error(
                        "Invalid Content-Length"));
                return;
            }
        }
    }

    var _dataBuffer = data;
    if (!Buffer.isBuffer(data)) {
        _dataBuffer = new Buffer(data, encoding);
    }
    var _conn = this.connection;
    var _self = this;
    _conn._lock(function() {
        var frame = _conn.framer.dataFrame(_self.id, pfin, _dataBuffer);
        _conn.write(frame);
        /* close client side */
        if (pfin) {
            _self.halfClose();
        }
        _conn._unlock();

        if (callback)
            callback();
    });
}

//
// ### function write (data, encoding, callback)
// #### @data {String|Buffer} data
// #### @encoding {String} (optional) encoding
// #### @callback {Function} (optional) write callback
// Send FIN data frame
//
ClientSpdyRequest.prototype.end = function end(data, encoding, callback) {

    // Do not send data to new connections after GOAWAY
    if (this.isGoaway())
        return;

    /* This client will NOT send further frames on that stream */
    if (this.halfclosed.client) {
        logger.error('end : is on half closed state');
        return;
    }

    /* verify content-length */
    this.contentLgh += Buffer.byteLength(data, encoding);
    this.contentLengthHandler(this.contentLgh);
    this._writeData(data, encoding, true, callback);

}

//
// ### function flushPendingData (callback)
// #### @callback {Function} (optional) function callback
// Writes data to socket
//
ClientSpdyRequest.prototype.flushPendingData = function flushPendingData(
        callback) {

    var _self = this;
    this.isPendingData = false;
    var p;
    this.pendingData.forEach(function(p) {
        try {
            _self._writeData(p.data, p.encoding, p.fin, p.callback);
        } catch (e) {
        }
    });
    this.pendingData = [];

    if (callback)
        callback();
}

ClientSpdyRequest.prototype.activePendingData = function activePendingData() {
    this.isPendingData = true;
}

ClientSpdyRequest.prototype.deactivePendingData = function deactivePendingData() {
    this.isPendingData = false;
}

//
// ### function writeHeader (headers, callback)
// #### @headers {Object} new headers
// #### @callback {Function} (optional) function callback
// Writes "HEADERS" frame to socket
//
ClientSpdyRequest.prototype.writeHeader = function writeHeader(headers,
        callback) {

    if (!this.options.headers) {
        this.options.headers = {};
    }
    for ( var newH in headers) {
        this.options.headers[newH] = newH;
    }
    ;

    /* write HEADERS frame */
    var _conn = this.connection;
    _conn.framer.headersFrame(headers, this.id, function(err, frame) {
        _conn._lock(function() {
            _conn.write(frame);
            _conn._unlock();
            if (callback)
                callback();
        });
    });
}

//
// ### function isReady ()
// Returns TRUE if the "Content-Length" header exists
//
ClientSpdyRequest.prototype.isReady = function isReady() {
    if (this.options.method == 'POST' || this.options.method == 'PUT') {
        var contentLghHeader = this.options.headers['Content-Length'];
        if (contentLghHeader == undefined) {
            // NOT ready for a post request : Content-Length header needed
            return false;
        }
    }

    return true;
}

//
// ### function contentLengthHandler (lgh)
// #### @lgh {Integer} content length
// Creates "Content-Length" header if necessary
//
ClientSpdyRequest.prototype.contentLengthHandler = function contentLengthHandler(
        lgh) {
    var contentLghHeader = this.options.headers['Content-Length'];
    if (contentLghHeader == undefined) {
        this.options.headers['Content-Length'] = lgh;
        this.connection.doPendingRequest(this);
    }

}

//
// ### function abort (cb)
// #### @cb {Function} abort callback
// Abort the request
//
ClientSpdyRequest.prototype.abort = function abort(cb) {
    this.emit('abort');
    if (this.isPendingRequest) {
        /* remove from pending */
        for ( var i = 0; i < this.connection.pendingRequests.length; i++) {
            if (this.connection.pendingRequests[i].id == this.id) {
                this.connection.pendingRequests.splice(i, 1);
            }
        }
    } else {
        this.connection._rstCode = 5;
        this.connection.closeRequest(this.id, new Error("Request Aborted"));
    }

    if (cb)
        cb();

}

//
// ### function isGoaway ()
// Returns true if any writes to that stream should be ignored
//
ClientSpdyRequest.prototype.isGoaway = function isGoaway() {
    return this.connection.goAway && this.id > this.connection.goAway;
};
