spdy-client
===========

With this module, you can create SPDY clients in node.js. You can send requests to the SPDY server and add listeners for response or data events.

Usage
===========

<pre><code>
var client = require('client');

var req = client.post(
                      {
      	                path : '',
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


</code></pre>
