# @datagica/orientdb-server

## Purpose

This package provides an embedded OrientDB server as a NPM dependency, together
with a simple asynchronous api to start and stop the instance.

Version of OrientDB used: OrientDB Server v2.2.2 (community edition)

## Usage

### Installation

    $ npm i --save git@github.com:datagica/orientdb-server.git

### Quickstart

```javascript
var OrientDB = require('@datagica/orientdb-server');

var orientdb = new OrientDB({
  pipe: true, // if true it pipes stderr and stdout, if false it will be silent
  properties: {
    // write properties as camelCase!
    serverDatabasePath: '/path/to/my/database'
  },
  users: {
    guest: {
      resources: "connect,server.listDatabases,server.dblist",
      password: "guest"
    },
    root: {
      password: 'weakpassword',
      resources: '*'
    }
  }
})
orientdb.start(function() => {
  server.log('orientdb is now running');
}).catch(function(err) => {
  console.error("orientdb couldn't be started: "+err);
});
```

Later, you can stop the server as well:

```javascript
server.stop(function() => {
  console.log('orientdb is now stopped')
}).catch(function(err) => {
  console.error("orientdb couldn't be stopped: "+err)
})
```
