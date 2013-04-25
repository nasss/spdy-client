spdy-client
===========

With this module, you can create SPDY clients in node.js. You can send requests to the SPDY server and add listeners for response or data events.

You need node-spdy module : https://github.com/indutny/node-spdy

Usage
===========

POST request example :
```javascript
var client = require('client');

var req = client.post(
                      {
      	                path : '/',
                       	port: 4000,
                        host: 'localhost',
                        //plain : true // USE plain tcp connection, TLS otherwise
                        headers: {
			                      'Content-Type': 'text/plain',
			                      'Content-Length': 9
                               }
                      },
                      function(response){
                        response.on('data', function (chunk) {
                            	var data = String.fromCharCode.apply(null, new Uint16Array(chunk));
                        	logger.info(data);
                      		});					 
                    	}
);  
req.write('Hello');
req.end('World');
```


GET request example :
```javascript
var req = client.get(
            {
                path : '/',
                url : '/',
                port: 3000,
                host: 'localhost'
            },
        	function(response){
                	logger.info("--- GET  RESPONSE --");
                	response.once('data', function (chunk) {
                    		var data = String.fromCharCode.apply(null, new Uint16Array(chunk));
                    		logger.info(data);          
                });    
                                
    }); 
    
req.on('error', function(err){
      logger.error(err);
 });    
    
```

PING example :

```javascript
client.ping({
                port: 3000,
                host: 'localhost'
                },
                function(id){
           		// success callback
                }
    );
```

PUSH handler example :

```javascript
var req = client.request(
            {
                method: 'GET',
                path : '/',
                url : '/',
                port: 4000,
                host: 'localhost',
                pushcb : function(opt, originreq)
                        {
                           // application handling    
                           // The client accepts the pushed data or not
                            return {
                                error : null,
                                success : function(res){
                                   //...
                                }
                            };
                        }
            },
            function(response){
                    //....
                });   
                
```
