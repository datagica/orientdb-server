'use strict';

const chai = require('chai');
chai.use(require('chai-fuzzy'));
const expect = chai.expect;

const path = require("path");

const OrientdbServer = require("../lib/orientdb-server");

describe('@datagica/orientdb-server', function()  {

    this.timeout(20000);

    it('start and stop the server', function (done) {

      const orientdb = new OrientdbServer({
        debug: true,
        pipe: true,
        properties: {
          serverDatabasePath: './tmp-test'
        },
        users: {
          guest: {
            resources: "connect,server.listDatabases,server.dblist",
            password: "guest"
          },
          root: {
            password: 'termidor406',
            resources: '*'
          }
        }
      });
      orientdb.start().then(status => {
        console.log(`successfully started the server: ${status}`);
        orientdb.stop().then(status => {
          console.log(`successfully stopped the server: ${status}`);
          done();
        }).catch(err => {
          console.error(`couldn't stop server: ${err}`);
          done();
        })
      }).catch(err => {
        console.error(`couldn't start the server: ${err}`);
        done();
      })
    })

})
