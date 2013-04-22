var spdy = require('spdy'),
    stream = require('stream'),
    events = require('events'), 
    util = require('util'),
    net = require('net'),
    tls = require('tls'), 
    utils = require('./utils'),
    fs = require('fs'),
    client = require('./client'),
    requestMod = require('./request'),
    log4js = require('log4js'),
    Buffer = require('buffer').Buffer;

/* -----INIT----- */
var logger = log4js.getLogger('CONNECTION');
logger.setLevel('ERROR');

var connection = exports;
connection.logger = logger;

//
// ### function ClientSpdyResponse (frame)
// #### @frame {Object} frame generated
// SPDY Response @constructor
//
function ClientSpdyResponse(frame) {
    var self = this;
    self.frame = frame;
    self.headers = frame.headers;
    self.httpVersion = frame.headers.version;
    self.statusCode = parseInt(frame.headers.status.slice(0, 3));
    return self;
}
util.inherits(ClientSpdyResponse, stream);

//
// ### function ClientSpdyConnection (host, port, plain)
// #### @host {String} server host
// #### @port {Integer} server port
// #### @plain {Boolean} (optional) plain or tls connection
// #### @version {Integer} (optional) SPDY version
// TCP connection @constructor
//
function ClientSpdyConnection(host, port, plain, version) {
    process.EventEmitter.call(this);
    var self = this;
    /* init connection fields */
    this.opened = false;
    this.version = version || 3;
    /* code mostly copied from server.js:Connection(socket, pool, options) */
    this.deflate = this._deflate = spdy.utils.createDeflate(this.version);
    this.inflate = this._inflate = spdy.utils.createInflate(this.version);
    /* deflate and inflate fields may be only visible at framer level? */
    this.framer = new spdy.protocol[''+this.version].Framer(spdy.utils.zwrap(this.deflate),
            spdy.utils.zwrap(this.inflate));

    this.streams = {};
    this.streamsCount = 0;
    this.streamId = -1;
    this.pushId = 0;
    this.pingId = -1;
    this.goaway = 0;
    this.pendingRequests = [];
    this._rstCode = 1;
    this.maxStreams = 100;

    /* Lock data */
    this._locked = false;
    this._lockBuffer = [];

    this.on('close', function() {
        this.closeConnection();
    });

    this.on('ping', function(id) {
        logger.info('PING RECEIVED ID=', id, '-- for connection: (', host,
                port, (plain ? "plain)" : "tls)"));
    });

    this.on('error', function(err) {
        this.socket.emit('error', err);
    });

    /* create socket */
    if (!plain) {
        logger.info("/* trying tls connection */");
        this.socket = tls.connect(port, host,
        /* can be parameterized correctly */
        {
            NPNProtocols : [ 'spdy/'+this.version ],
            rejectUnauthorized : false
        }, function() {
            /* ready to start interacting with server */
            self.startConnection();
            self.socket.on('close', function() {
                logger.error('Socket closed');
            });
        });
        this.socket.on('error', function(err) {
            logger.error("connection socket error : ", err.message);
        });
    } else {
        logger.info("trying plain connection");
        this.socket = net.connect(port, host, function() {
            /* ready to start interacting with server */
            self.startConnection();
            self.socket.on('close', function() {
                logger.error('Socket closed');
            });
        });
        this.socket.on('error', function(err) {
            logger.error("connection socket error : ", err.message);
        });
    }

    /*
     * create parser that will be responsible of receiving the data from the
     * server
     */
    this.parser = spdy.parser.create(this, this.deflate, this.inflate);
    this.parser
            .on(
                    'frame',
                    function(frame) {
                        if (!this.connection.opened)
                            return;
                        logger.trace("client parser, on frame : ", frame);

                        /*
                         * process the frame, typical case will be a SYN_REPLY
                         * or a DATA frame
                         */
                        if (frame.type === 'SYN_REPLY') {
                            var request = self.streams[frame.id];

                            if (request == null) {
                                /* send rst-stream with error INVALID_STREAM */
                                self.write(self.framer.rstFrame(frame.id, 2));

                                /* close connection */
                                self.opened = false;
                                self.emit('close');
                                return;
                            } else {

                                /* If we reached stream limit */
                                if (self.streamsCount > self.maxStreams) {
                                    request.once('error', function onerror() {
                                    });
                                    /* REFUSED_STREAM */
                                    self._rstCode = 3;
                                    self.closeRequest(request.id);
                                    return;
                                }
                                /* set headers, status and so on within response */
                                request.response = new ClientSpdyResponse(frame);
                                request.response.method = request.options.method;
                                request.emit("method_"
                                        + request.response.method);

                                if (request.response.statusCode == 100) {
                                    request.emit("continue");
                                }
                                request.response.url = request.options.path
                                        || request.options.url;

                                request.callback(request.response);
                                /*
                                 * send 'data' event if there is some data
                                 * available
                                 */
                                if (frame.data != null) {
                                    request.response.emit('data', frame.data,
                                            frame.priority, frame.data.length);

                                }
                            }
                        } else if (frame.type == 'DATA') {
                            var request = self.streams[frame.id];

                            if (request == null) {
                                /* send rst-stream with error INVALID_STREAM */
                                self.write(this.connection.framer.rstFrame(
                                        frame.id, 2));

                                /* close connection */
                                self.opened = false;
                                self.emit('close');
                                return;
                            } else {
                                /*
                                 * response should send 'data' event if there is
                                 * some data available
                                 */
                                if (frame.data.length > 0) {

                                    if (request.halfclosed.server) {
                                        /*
                                         * should not reveive data from half
                                         * closed server
                                         */
                                        self.write(self.framer.rstFrame(
                                                frame.id, 9));
                                        return;
                                    }

                                    request.response.emit('data', frame.data,
                                            0, frame.data.length);
                                }
                            }

                        } else if (frame.type === "SYN_STREAM") {
                            /* Get original stream */
                            var originalReq = self.streams[frame.associated];

                            /* Verify headers */
                            if (!(frame.headers.path && frame.headers.scheme && frame.headers.host)
                                    || originalReq == null) {
                                /* send rst */
                                if (frame.assoc == 0) {
                                    /* protocol error = 1 */
                                    self.write(this.connection.framer.rstFrame(
                                            frame.id, 1));
                                } else {
                                    /* http_protocol_error id = ??? */
                                    self.write(this.connection.framer.rstFrame(
                                            frame.id, 1));
                                }
                                return;
                            } else if (frame.headers.host != originalReq.options.host) {
                                /* different hosts */
                                return;
                            }
                            /*
                             * pushed document, send push event and call a
                             * specific push callback
                             */
                            originalReq.emit('push', frame); // just for log

                            var opt = {
                                method : 'GET',
                                url : frame.headers.path,
                                host : frame.headers.host,
                                // Needed
                                scheme : frame.headers.scheme,
                                headers : originalReq.options.headers
                            }

                            if (originalReq.port)
                                opt.port = originalReq.port;

                            var pushReqObj = new requestMod.ClientSpdyRequest(
                                    opt, null, this);
                            pushReqObj.id = frame.id

                            /*
                             * unidirectionnal : the client will not send this
                             * request
                             */
                            pushReqObj.halfclosed.client = true;
                            originalReq.pushedStreams.push(pushReqObj);

                            /* callback for pushed streams */
                            var cb = originalReq.options.pushcb;

                            if (cb) {
                                /* call push callback */
                                var accept = cb(opt, originalReq);

                                if (accept.error) {
                                    /* cancel the original stream */
                                    self.write(this.connection.framer.rstFrame(
                                            frame.associated, 5));
                                    accept.error();
                                } else {
                                    /*
                                     * Create a response and call the received
                                     * callback
                                     */
                                    pushReqObj.response = new ClientSpdyResponse(
                                            frame);
                                    pushReqObj.response.method = pushReqObj.options.method;
                                    pushReqObj.response.url = pushReqObj.options.path
                                            || pushReqObj.options.url;
                                    accept.success(pushReqObj.response);

                                }
                            } else {
                                /* cancel the original stream */
                                self.write(this.connection.framer.rstFrame(
                                        frame.associated, 5));
                            }

                        }

                        else if (frame.type === 'RST_STREAM') {
                            logger.info("GET RST_STREAM from server status= "+ frame.status);
                            self._rstCode = 0;
                            self.closeRequest(frame.id);
                        } else if (frame.type === 'PING') {
                            if (frame.pingId % 2 == 0) {
                                /* OK : valid even id from the server */
                                self.write(self.framer.pingFrame(frame.pingId));
                            }
                            /* else it's ping response or bad id */
                            logger.debug("ping response : ", frame);
                            self.emit('ping', frame.pingId
                                    .readUInt32BE(0, true) & 0x7fffffff);

                        } else if (frame.type === 'SETTINGS') {
                            /* TODO later */
                        } else if (frame.type === 'GOAWAY') {
                            self.goaway = frame.lastId;
                            /* TODO later */
                        } else if (frame.type === 'WINDOW_UPDATE') {
                            /* TODO later */
                        } else {
                            logger.error('Unknown type: ', frame.type);
                        }
                        /* TODO headers frame? */

                        /* Handle half-closed */
                        if (frame.fin) {
                            var request = self.streams[frame.id];
                            /*
                             * response should send 'end' event Emitted exactly
                             * once for each response. After that, no more
                             * 'data' events will be emitted on the response.
                             */
                            request.response.emit('end');
                            /* half close state */
                            request.halfclosed.server = true;
                        }

                    });
    /* pipe socket with parser */
    this.socket.pipe(this.parser);

}
util.inherits(ClientSpdyConnection, process.EventEmitter);

//
// ### function _lock (callback)
// #### @callback {Function} continuation callback
// Acquire lock
//
ClientSpdyConnection.prototype._lock = function lock(callback) {
    if (!callback)
        return;

    if (this._locked) {
        this._lockBuffer.push(callback);
    } else {
        this._locked = true;
        callback.call(this, null);
    }
};

//
// ### function _unlock ()
// Release lock and call all buffered callbacks
//
ClientSpdyConnection.prototype._unlock = function unlock() {
    if (this._locked) {
        this._locked = false;
        this._lock(this._lockBuffer.shift());
    }
};

//
// ### function write (data, encoding)
// #### @data {String|Buffer} data
// #### @encoding {String} (optional) encoding
// Writes data to socket
//
ClientSpdyConnection.prototype.write = function write(data, encoding) {
    if (this.socket.writable) {
        return this.socket.write(data, encoding);
    }
};

//
// ### function startConnection ()
// Callback for the TCP connection
//
ClientSpdyConnection.prototype.startConnection = function startConnection() {
    logger.info("/* started connection */");
    this.opened = true;
    this.socket.setTimeout(2 * 60 * 1000);
    this.socket.once('timeout', function ontimeout() {
        logger.error('connection timeout');
        this.destroy();
    });
    for ( var cptr = 0; cptr < this.pendingRequests.length; cptr++) {
        this.doRequest(this.pendingRequests[cptr]);
    }
    this.pendingRequests = [];
}

//
// ### function startRequest (options, callback)
// #### @options {Object} request options
// #### @callback {Function} (optional) request callback
// Sends request or store it for later
//
ClientSpdyConnection.prototype.startRequest = function startRequest(options,
        callback) {
    var req = new requestMod.ClientSpdyRequest(options, callback, this);

    if (this.opened && req.isReady()) {
        /* do the request immediatly */
        this.doRequest(req);
    } else {
        /* check error cases as well */
        this.pendingRequests.push(req);
    }
    return req;
}

//
// ### function doRequest (ClientSpdyRequest)
// #### @request {ClientSpdyRequest} Client request
// Do the request immediatly
//
ClientSpdyConnection.prototype.doRequest = function doRequest(request) {
    if (!request.isReady())
        return;

    request.isPendingRequest = false;
    var self = this;
    var dict = utils.headersToDict(request.options.headers, function(headers) {
        headers[':version'] = 'HTTP/1.1';
        headers[':method'] = request.options.method;
        headers[':url'] = request.options.url;
        headers[':path'] = request.options.path;
        headers[':port'] = request.options.port;
        headers[':host'] = request.options.host;
    });
    var callback = request.callback;
    /* Create a new stream, reuse framer for that */
    this._lock(function() {
        this.streamId += 2;
        this.framer._synFrame('SYN_STREAM', this.streamId, null, 0, dict,
                function(err, frame) {
                    if (err) {
                        request.emit('error', err);
                        return;
                    }
                    /* store the request with the frame id */
                    self.streams[self.streamId] = request;
                    self.streamsCount++;
                    request.id = self.streamId;
                    /* write frame within socket */
                    self.write(frame);
                    request.emit('socket', self.socket);
                    self._unlock();
                    request.flushPendingData(function() {
                        logger.debug("DATA FLUNSHED");
                    });
                });
    });
}

//
// ### function doPendingRequest (ClientSpdyRequest)
// #### @req {ClientSpdyRequest} Client request
// Do the pending request
//
ClientSpdyConnection.prototype.doPendingRequest = function doPendingRequest(req) {
    if (this.opened && req.isReady()) {
        /* do the request immediatly */
        this.doRequest(req);

        /* remove from pending */
        for ( var i = 0; i < this.pendingRequests.length; i++) {
            if (this.pendingRequests[i].id == req.id) {
                this.pendingRequests.splice(i, 1);
            }
        }
    }
    return req;
}

connection.ClientSpdyConnection = ClientSpdyConnection;

//
// ### function ping ()
// Writes ping frame
//
ClientSpdyConnection.prototype.ping = function() {
    // It is a priority
    var id = new Buffer(4);
    id.writeUInt32BE((this.pingId += 2) & 0x7fffffff, 0, true); // -ID
    return this.write(this.framer.pingFrame(id));

}

//
// ### function closeConnection()
// Close connection
ClientSpdyConnection.prototype.closeConnection = function closeConnection() {
    if (this.socket)
        this.socket.destroy();
}

//
// ### function closeRequest (id,error)
// #### @id {Integer} stream ID
// #### @error {Error} (optional) error
// Destroys stream
//
ClientSpdyConnection.prototype.closeRequest = function closeRequest(id, error) {
    var _stream = this.streams[id];

    if (error) {
        if (this._rstCode) {
            this.write(this.framer.rstFrame(id, this._rstCode));
        }
    }
    if (error) {
        _stream.emit('error', error);
        this.emit('error', error);
    }

    if (id % 2 === 1) {
        this.streamsCount--;
    }

    delete this.streams[id];
};
