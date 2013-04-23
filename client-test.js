var USE_INTERNAL_SERVER = true,
    assert = require('assert'),
    spdy = require('spdy'),
    keys = require('../spdy/test/fixtures/keys'),
    client = require('./client'),
    log4js = require('log4js'),
    querystring =  require('querystring'),
    url = require('url'),
    fs = require('fs'),
    Buffer = require('buffer').Buffer;

/* -----INIT----- */
var logger = log4js.getLogger('CLIENT-TEST');
    logger.setLevel('ERROR');
    
    client.setLogLevel('ERROR');
    
/*
 * mirror = 1 if we want to test mirror response ( add "-t 10000" in mocha
 * command line )
 */
var mirror = 1;
    



suite('A SPDY Client', function() {
    
 if(USE_INTERNAL_SERVER)
 {
    function logRequest(req,endCallback) {
        logger.debug("LOG request............."); 
        req.loggedObject.method = req.method;
        req.loggedObject.url = req.url;
        req.loggedObject.httpVersion = req.httpVersion;
        req.loggedObject.headers = req.headers;
        req.loggedObject.data = "";
        req.on('data', function (chunk) {
                logger.debug("Server::stream "+req.streamID+"  ON DATA");
                req.loggedObject.data += chunk;
        });
        req.on('end', function() {
            logger.debug("Server::stream "+req.streamID+"  ON END");
            endCallback();
        });

    }
    
    function createDefaultServer(name, keys) {
        return spdy.createServer(keys, function(req, response) {
     
          logger.info("---------------------------------------"+ name +": on request ");
          logger.info(name+ ":: streamID : "+req.streamID);
          req.loggedObject = {};
         
          /*
             * parse request URL, if in query string parameter named code, use
             * it within writeHead
             */
          var parsedUrl = url.parse(req.url,true);
          
          
          var headers = {}
          if(parsedUrl.query.headers)
          {
            headers = JSON.parse(parsedUrl.query.headers);
            headers["Content-Type"] = "application/json";
          }

          var statusCode = headers.statusCode || 200;
          response.writeHead(statusCode, headers);
          

          if( parsedUrl.query.mirror )
          {
            logRequest(req, function() {
                response.end(JSON.stringify(req.loggedObject)); 
            });
          }
          else
          {
             response.write('NO MIRROR');
             
             response.push('/testpush1.json',
                    {"Content-Type": "text/plain", statusCode : 200},
                    0, function(){
                        logger.info("SERVER PUSH CALLBACK");
                    });
                    
            response.push('/testpush2.json',
                    {"Content-Type": "text/plain", statusCode : 200},
                    1, function(){
                        logger.info("SERVER PUSH 2 CALLBACK");
                    });    
          }
          
        });
    }
    
        
    var server1 = createDefaultServer("Server 1 ", keys);
    server1.listen(3000);
    
    
    var server2 = createDefaultServer("Server 2 ", keys);
    server2.listen(4000);
    

    
 }/* endif : USE_INTERNAL */
 
 
 /* Headers to get back */
    var headersParam = {
        statusCode : 304,
        Location : '/test',
        Date : '20130412'
      };
  
  
  test('tls request, GET', function(done) {

    logger.info("------ test GET request ");
    var req = client.request(
            {
                method: 'GET',
                path : '/?headers='+encodeURIComponent(JSON.stringify(headersParam))+ (mirror?'&mirror=1':''),
                url : '/',
                port: 3000,
                host: 'localhost'
            },
            function(response){
                var self = req;    
                response.once('data', function (chunk) {
                    
                    var data = String.fromCharCode.apply(null, new Uint16Array(chunk));
                    logger.debug("response data : ",data);
                    if( ! mirror)
                        assert.strictEqual(data,"NO MIRROR", ' first data');
                    
                    
                    done();
                    
                });    
                                
                assert.equal(response.statusCode, headersParam.statusCode,'statusCode');
                assert.equal(response.headers.date, headersParam.Date,'Date');
                assert.equal(response.headers.location, headersParam.Location,'location');
                });    

    req.on('error', function(err){
        logger.error(err);
    });                
        
  });
 
 
  test('tls request, POST', function(done) {
  
    var req = client.request(
            {
                method: 'POST',
                path : '/?headers='+encodeURIComponent(JSON.stringify(headersParam))+ (mirror?'&mirror=1':''),
                port: 3000,
                host: 'localhost',
                headers: {
               
                            'Content-Type': 'text/plain',
                            'Content-Length': 22

                         }
            },
            function(response){
                var self = req;    
                response.once('data', function (chunk) {
                    
                    var data = String.fromCharCode.apply(null, new Uint16Array(chunk));
                    /* logger.debug("response data : ",data); */
                    if( ! mirror)
                        assert.strictEqual(data,"NO MIRROR", ' first data');
                    else
                    {
                        var jsonData = JSON.parse(data);
                        assert.equal(jsonData.data, "testtest2test3test4fin",'server data');
                    }                    
                    done();
                    
                    
                });    
                                
                assert.equal(response.statusCode, headersParam.statusCode,'statusCode');
                assert.equal(response.headers.date, headersParam.Date,'Date');
                assert.equal(response.headers.location, headersParam.Location,'location');
                
                
                
                });        

    req.write('test');
    req.write('test2');
    req.write('test3');
    req.write('test4');
    req.end('fin');
        
  });
  
  
  test('handling push request', function(done) {
       
    var req = client.request(
            {
                method: 'GET',
                path : '/?headers='+encodeURIComponent(JSON.stringify(headersParam)),
                url : '/',
                port: 4000,
                host: 'localhost',
                pushcb : function(opt, originreq)
                        {
                            return {
                                error : null,
                                success : function(res){
                                    logger.info("--- push response");
                                    logger.debug(res);
                                    assert.equal(res.frame.id % 2, 0, "even id from server");
                                    assert((res.frame.headers.path == '/testpush1.json'  || res.frame.headers.path == '/testpush2.json'), "resource path");
                                    
                                }
                            };
                        }
            },
            function(response){
                    done();
                });                                
        
  });

  test('ping', function(done) {

    /* first ping => id=1 */
    client.ping({
                port: 3000,
                host: 'localhost'
                },
                function(id){
                    logger.debug("ping response id = "+id);
                    /* id= 1 if ping succeed */
                    assert.equal(id, 1, "ping id received from server");
                    done();
                }
    );
            
  });
  
  test('content length, POST', function(done) {
  
    var req = client.request(
            {
                method: 'POST',
                path : '/?headers='+encodeURIComponent(JSON.stringify(headersParam))+ (mirror?'&mirror=1':''),
                port: 3000,
                host: 'localhost',
                headers: {
               
                            'Content-Type': 'text/plain',
                            /* 'Content-Length': 7 */

                         }
            },
            function(response){
                var self = req;    
                response.once('data', function (chunk) {
                    
                    var data = String.fromCharCode.apply(null, new Uint16Array(chunk));
                    var jsonData = JSON.parse(data);
                    assert.equal(Buffer.byteLength(jsonData.data), 7,'Content length ');
                    done();
                });    
                
            });        

    req.write('a');
    req.write('b');
    req.write('c');
    req.write('d');
    req.end('end');    
  });
  
  
  
  test('tls Multi requests, 3 GET and 2 post', function(done) {
    
    
    


    
    var post1 = client.request(
                          {
                                method: 'POST',
                                path : '/?headers='+encodeURIComponent(JSON.stringify(headersParam))+ (mirror?'&mirror=1':''),
                                port: 3000,
                                host: 'localhost',
                                headers: {       
                                    'Content-Type': 'text/plain',
                                    'Content-Length': 22
                                }
                          },
                          function(response){
                                  logger.info("-------------------- POST 1  RESPONSE ");
                                  response.on('data', function (chunk) {
                                        logger.info("***** POST 1 ondata ");
                                          var data = String.fromCharCode.apply(null, new Uint16Array(chunk));
                                          logger.debug(data);
                                          var jsonData = JSON.parse(data);
                                          assert.strictEqual(jsonData.data,"testtest2test3test4fin", 'data post1');
                                  });
                          }
    );  


    post1.write('test');
    post1.write('test2');
    
    var get1 = client.request(
            {
                method: 'GET',
                path : '/?headers='+encodeURIComponent(JSON.stringify(headersParam))+ (mirror?'&mirror=1':''),
                url : '/',
                port: 3000,
                host: 'localhost'
            },
        function(response){
                logger.info("-------------------- GET 1 RESPONSE ");
                response.once('data', function (chunk) {
                    
                    var data = String.fromCharCode.apply(null, new Uint16Array(chunk));
                    logger.info("GET 1 data : ");
                    if( ! mirror)
                        assert.strictEqual(data,"NO MIRROR", ' first data');
                    
                });    
                                
                assert.equal(response.statusCode, headersParam.statusCode,'statusCode');
                assert.equal(response.headers.date, headersParam.Date,'Date');
                assert.equal(response.headers.location, headersParam.Location,'location');
    });        

    
    var post2 = client.request(
                          {
                                method: 'POST',
                                path : '/?headers='+encodeURIComponent(JSON.stringify(headersParam))+ (mirror?'&mirror=1':''),
                                port: 3000,
                                host: 'localhost',
                                headers: {       
                                    'Content-Type': 'text/plain',
                                    'Content-Length': 8
                                }
                          },
                          function(response){
                                  logger.info("-------------------- POST 2  RESPONSE ");
                                  response.on('data', function (chunk) {
                                        logger.info("***** POST 2 ondata ");
                                          var data = String.fromCharCode.apply(null, new Uint16Array(chunk));
                                          logger.debug(data);
                                          var jsonData = JSON.parse(data);
                                          assert.strictEqual(jsonData.data,"abcdfinn", 'data post2');
                                          
                                          done();
                                  });
                          }
    );  
    

    post2.write('a');
    
    var get2 = client.request(
            {
                method: 'GET',
                path : '/?headers='+encodeURIComponent(JSON.stringify(headersParam)),
                url : '/',
                port: 3000,
                host: 'localhost'
            },
        function(response){
                logger.info("-------------------- GET 2 RESPONSE ");
                response.once('data', function (chunk) {
                    
                    var data = String.fromCharCode.apply(null, new Uint16Array(chunk));
                    logger.info("GET 2 data : ");
                    
                    assert.strictEqual(data,"NO MIRROR", ' first data');
                    
                });    
                                

    });    
    
    
    post2.write('b');    
    post1.write('test3');
    post2.write('c');
    post1.write('test4');
    
    

    var headersParam2 = {
        statusCode : 200,
        Date : '20130412'
    };
    var get3 = client.request(
            {
                method: 'GET',
                path : '/?headers='+encodeURIComponent(JSON.stringify(headersParam2))+ (mirror?'&mirror=1':''),
                url : '/',
                port: 3000,
                host: 'localhost'
            },
        function(response){
                logger.info("-------------------- GET 3 RESPONSE ");
                response.once('data', function (chunk) {
                    
                    var data = String.fromCharCode.apply(null, new Uint16Array(chunk));
                    logger.info("GET 3 data : ");
                    if( ! mirror)
                        assert.strictEqual(data,"NO MIRROR", ' first data');
                    
                });    
                                
                assert.equal(response.statusCode, headersParam2.statusCode,'statusCode');
                assert.equal(response.headers.date, headersParam2.Date,'Date');
    });    

    
    
    post1.end('fin');
    post2.write('d');
    post2.end('finn');
            
  });
  
  
  
  
  
  
  
  
  
  test('tls Multi Servers, 3 GET and 2 post', function(done) {
  

    /* Server 1 */
    var get1 = client.request(
            {
                method: 'GET',
                path : '/?headers='+encodeURIComponent(JSON.stringify(headersParam))+ (mirror?'&mirror=1':''),
                url : '/',
                port: 3000,
                host: 'localhost'
            },
        function(response){
                logger.info("-------------------- GET 1 RESPONSE ");
                response.once('data', function (chunk) {
                    
                    var data = String.fromCharCode.apply(null, new Uint16Array(chunk));
                    logger.info("GET 1 data : ");
                    if( ! mirror)
                        assert.strictEqual(data,"NO MIRROR", ' first data');
                    
                });    
                                
                assert.equal(response.statusCode, headersParam.statusCode,'statusCode');
                assert.equal(response.headers.date, headersParam.Date,'Date');
                assert.equal(response.headers.location, headersParam.Location,'location');
    });        



    
    



    /* Server 1 */
    var post1 = client.request(
                          {
                                method: 'POST',
                                path : '/?headers='+encodeURIComponent(JSON.stringify(headersParam))+ (mirror?'&mirror=1':''),
                                port: 3000,
                                host: 'localhost',
                                headers: {       
                                    'Content-Type': 'text/plain',
                                    'Content-Length': 22
                                }
                          },
                          function(response){
                                  logger.info("-------------------- POST 1  RESPONSE ");
                                  response.on('data', function (chunk) {
                                        logger.info("***** POST 1 ondata ");
                                          var data = String.fromCharCode.apply(null, new Uint16Array(chunk));
                                          logger.debug(data);
                                          var jsonData = JSON.parse(data);
                                          assert.strictEqual(jsonData.data,"testtest2test3test4fin", 'data post1');
                                  });
                          }
    );  


    post1.write('test');
    post1.write('test2');
    post1.write('test3');
    

    /* Server 2 */
    var post2 = client.request(
                          {
                                method: 'POST',
                                path : '/?headers='+encodeURIComponent(JSON.stringify(headersParam))+ (mirror?'&mirror=1':''),
                                port: 4000,
                                host: 'localhost',
                                headers: {       
                                    'Content-Type': 'text/plain',
                                    'Content-Length': 8
                                }
                          },
                          function(response){
                                  logger.info("-------------------- POST 2  RESPONSE ");
                                  response.on('data', function (chunk) {
                                        logger.info("***** POST 2 ondata ");
                                          var data = String.fromCharCode.apply(null, new Uint16Array(chunk));
                                          logger.debug(data);
                                          var jsonData = JSON.parse(data);
                                          assert.strictEqual(jsonData.data,"abcdfinn", 'data post2');
                                          
                                          done();
                                  });
                          }
    );  
    
    
    post2.write('a');
    post2.write('b');
    post1.write('test4');
    
        /* Server 2 */
    var get2 = client.request(
            {
                method: 'GET',
                path : '/?headers='+encodeURIComponent(JSON.stringify(headersParam)),
                url : '/',
                port: 4000,
                host: 'localhost'
            },
        function(response){
                logger.info("-------------------- GET 2 RESPONSE ");
                response.once('data', function (chunk) {
                    
                    var data = String.fromCharCode.apply(null, new Uint16Array(chunk));
                    logger.info("GET 2 data : ");
                    
                    assert.strictEqual(data,"NO MIRROR", ' first data');
                    
                });    
                                

    });    
    
    
    post2.write('c');
    post2.write('d');
    post2.end('finn');
    
    /* Server 1 */
    var headersParam2 = {
        statusCode : 200,
        Date : '20130412'
    };
    var get3 = client.request(
            {
                method: 'GET',
                path : '/?headers='+encodeURIComponent(JSON.stringify(headersParam2))+ (mirror?'&mirror=1':''),
                url : '/',
                port: 3000,
                host: 'localhost'
            },
        function(response){
                logger.info("-------------------- GET 3 RESPONSE ");
                response.once('data', function (chunk) {
                    
                    var data = String.fromCharCode.apply(null, new Uint16Array(chunk));
                    logger.info("GET 3 data : ");
                    if( ! mirror)
                        assert.strictEqual(data,"NO MIRROR", ' first data');
                    
                });    
                                
                assert.equal(response.statusCode, headersParam2.statusCode,'statusCode');
                assert.equal(response.headers.date, headersParam2.Date,'Date');
    });    
    
    
    post1.end('fin');
            
  });

});

