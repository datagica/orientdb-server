'use strict';

const spawn = require('cross-spawn');
const path = require('path');
const os = require('os');
const fs = require('fs');
const xml2js = require('xml2js');
const decamelize = require('decamelize');


class Server {

  constructor(opts) {

    opts = (typeof opts === 'undefined') ? {} : opts;

    const runtimePath = (typeof opts.runtimePath === 'string') ?
      opts.runtimePath :
      path.resolve(__dirname,
        '..' + ((os.platform() == 'win32') ? '\\orientdb' : '/orientdb')
      );
    this.runtimePath = runtimePath;

    if (this.debug) console.log(`OrientdbServer: runtime path: ${runtimePath}`);

    this.initTimeout = (typeof opts.initTimeout === 'number') ? opts.initTimeout : 2000;

    const inputConfigPath = (typeof opts.inputConfigPath === 'string') ?
      opts.inputConfigPath :
      path.resolve(__dirname,
        '..' + ((os.platform() == 'win32') ? '\\config' : '/config')
      );
    this.inputConfigPath = inputConfigPath;

    if (this.debug) console.log(`OrientdbServer: inputConfigPath: ${inputConfigPath}`);

    const outputConfigPath = (typeof opts.outputConfigPath === 'string') ?
      opts.outputConfigPath :
      path.resolve(__dirname,
        '..' + ((os.platform() == 'win32') ?
          '\\orientdb\\config' :
          '/orientdb/config')
      );
    this.outputConfigPath = outputConfigPath;

    if (this.debug) console.log(`OrientdbServer: outputConfigPath: ${outputConfigPath}`);


    const databasePath = (typeof opts.databasePath === 'string') ?
      opts.databasePath :
      path.resolve(__dirname,
        '..' + ((os.platform() == 'win32') ?
          '\\orientdb\\databases' :
          '/orientdb/databases')
      );
    this.databasePath = databasePath;

    if (this.debug) console.log(`OrientdbServer: databasePath: ${databasePath}`);

    this.debug = (typeof opts.debug === 'boolean') ? opts.debug : false;
    this.pipe = (typeof opts.pipe === 'boolean') ? opts.pipe : false;

    this.properties = (typeof opts.properties !== 'undefined') ? opts.properties : {};

    this.users = (typeof opts.users !== 'undefined') ? opts.users : {};

    switch (os.platform()) {
      case 'win32':
        this.execPath = `${runtimePath}\\bin\\server.bat`;
        this.inputHazelcastConfigPath = `${inputConfigPath}\\hazelcast.xml`;
        this.inputOrientdbConfigPath = `${inputConfigPath}\\orientdb-server-config.xml`;
        this.outputHazelcastConfigPath = `${outputConfigPath}\\hazelcast.xml`;
        this.outputOrientdbConfigPath = `${outputConfigPath}\\orientdb-server-config.xml`;
        break;

      default:
        this.execPath = `${runtimePath}/bin/server.sh`;
        this.inputHazelcastConfigPath = `${inputConfigPath}/hazelcast.xml`;
        this.inputOrientdbConfigPath = `${inputConfigPath}/orientdb-server-config.xml`;
        this.outputHazelcastConfigPath = `${outputConfigPath}/hazelcast.xml`;
        this.outputOrientdbConfigPath = `${outputConfigPath}/orientdb-server-config.xml`;
        break;
    }
    if (this.debug) console.log(`OrientdbServer: executable path: ${this.execPath}`);

    this.errors = [];

    this.isStarting = false;
    this.isRunning = false;
    this.isClosed = false;

    this.closeRequested = false;
  }

  start() {

    if (this.mock === 'success') {
      return Promise.resolve(true);
    } else if (this.mock === 'failure') {
      return Promise.reject(new Error(`mock test: failure`));
    }

    if (this.isStarting || this.isRunning) {
      if (this.debug) console.log('OrientdbServer: server is already running');
      return Promise.resolve(true);
    }

    if (this.closeRequested) {
      return Promise.reject(new Error(`close has been requested`));
    }

    this.isStarting = true;

    return this.configure().then(done => {
      if (this.debug) console.log("OrientdbServer: successfully configured!");
      return Promise.resolve(true);
    }).catch(err => {
      if (this.debug) console.log("OrientdbServer: failed to configure, falling back to default config");
      return Promise.resolve(false);
    }).then(status =>
      new Promise((resolve, reject) => {

        this.process = spawn(this.execPath, []);

        this.process.on('error', err => {
          if (this.debug) console.log(`OrientdbServer: child process error: ${err}`);
          this.errors.push(err);
        });

        this.process.stdout.on('data', (data) => {
          if (this.pipe) console.log(`${data}`);
        });

        this.process.stderr.on('data', (data) => {
          if (this.pipe) console.error(`${data}`);
          const activationPattern = /OrientDB Server is active/i;
          const str = `${data}`;
          if (this.isStarting && !this.isRunning && !this.closeRequested && str.match(activationPattern)) {
            this.isRunning = true;
            this.isStarting = false;
            this.isClosed = false;
            resolve(true);
          }
        });

        this.process.on('message', (message) => {
          //console.log(`OrientdbServer: child process message: ${message}`)
        })

        this.process.on('close', (code, signal) => {
          if (this.debug) console.log(`OrientdbServer: child process close: code=${code}, signal=${signal}`);
        });
        this.process.on('exit', (code, signal) => {
          if (this.debug) console.log(`OrientdbServer: child process exit: code=${code}, signal=${signal}`);
          this.isStarting = false;
          this.isRunning = false;
          this.manually = false;
          this.isClosed = true;
        })

        // timeout check to be sure we are not stuck somewhere in the process
        setTimeout(() => {
          if (this.isStarting && !this.isRunning && !this.closeRequested) {

            const errors = (this.errors.length) ? this.errors.join('\n') : 'timeout';
            const error = `couldn't start the server in time: ${errors}`;
            reject(new Error(error));
          }
        }, this.initTimeout);
      })
    )
  }

  stop() {
    if (!this.process) return;
    this.process.kill('SIGHUP');
    return new Promise((resolve, reject) => {
      setTimeout(() => {
        if (!this.isRunning) {
          resolve(true);
        } else {
          reject(new Error(`couldn't stop the server`))
        }
      }, 500);
    });
  }

  configure() {
    return new Promise((resolve, reject) => {
      fs.readFile(this.inputOrientdbConfigPath, 'utf8', (err, configStr) => {
        if (err) {
          reject(new Error(`couldn't open config file: ${err}`));
          return;
        }

        xml2js.parseString(configStr, (err, config) => {
          if (err) {
            reject(err);
            return;
          }

          Server.setUsers(config, this.users);
          Server.setProperties(config, this.properties);

          fs.writeFile(
            this.outputOrientdbConfigPath,
            new xml2js.Builder().buildObject(config),
            'utf8',
            (err) =>  {
              if (err) {
                reject(err);
              } else {
                resolve(true);
              }
            })
        });
      });
    })
  }

  static setUsers(config, users) {
    config['orient-server'].users = [{
      user: Object.keys(users).map(user => {
        return {
          "$": {
            name: user,
            password: users[user].password,
            resources: users[user].resources
          }
        }
      })
    }];
  }


  static setProperties(config, properties) {

    // not very optimized, ad we filter for each property, but this function
    // is probably only called once - at app startup - so maybe no need to optimize
    Object.keys(properties).forEach(camelKey => {
      const value = properties[camelKey];
      const dotKey = decamelize(camelKey, '.');
      config['orient-server'].properties[0].entry = config['orient-server'].properties[0].entry
        .filter(name => `${name}`.toLowerCase() !== `${dotKey}`.toLowerCase())
        .concat([{
          "$": {
            name: dotKey,
            value: value
          }
        }]);
    })
  }

  /**
   * Set an OrientDB property
   */
  static setProperty(config, camelKey, value) {

    const dotKey = decamelize(camelKey, '.');

    config['orient-server'].properties[0].entry = config['orient-server'].properties[0].entry
      .filter(name => `${name}`.toLowerCase() !== `${dotKey}`.toLowerCase())
      .concat([{
        "$": {
          name: dotKey,
          value: value
        }
      }]);
  }
}

module.exports = Server
module.exports.default = Server
module.exports.Server = Server
