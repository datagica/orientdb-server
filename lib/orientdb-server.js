'use strict'

const spawn      = require('cross-spawn')
const path       = require('path')
const os         = require('os')
const fs         = require('fs')
const xml2js     = require('xml2js')
const decamelize = require('decamelize')

function isString(input) {
  return typeof input === 'string'
}

function isNumber(input) {
  return !isNaN(input) && isFinite(input)
}

function isDefined(input) {
  return typeof input !== 'undefined' && input !== null
}

function isBoolean(input) {
  return typeof input === 'boolean'
}

const OS_SHELL = os.platform() === 'win32' ? 'bat' : 'sh'

class Server {

  constructor(opts) {

    opts = isDefined(opts) ? opts : {}

    this.debug = isBoolean(opts.debug) ? opts.debug : false

    const rootPath =
      isString(opts.rootPath)
        ? opts.rootPath
        : path.resolve(__dirname, '..')

    if (this.debug) console.log(`OrientdbServer: root path: ${rootPath}`)

    const runtimePath =
      isString(opts.runtimePath)
        ? opts.runtimePath
        : path.join(rootPath, 'orientdb')

    this.runtimePath = runtimePath

    if (this.debug) console.log(`OrientdbServer: runtime path: ${runtimePath}`)

    this.initTimeout = isNumber(opts.initTimeout) ? opts.initTimeout : 3000

    const inputConfigPath =
      isString(opts.inputConfigPath)
        ? opts.inputConfigPath
        : path.join(rootPath, 'config')

    this.inputConfigPath = inputConfigPath

    if (this.debug) console.log(`OrientdbServer: inputConfigPath: ${inputConfigPath}`)

    const outputConfigPath =
      isString(opts.outputConfigPath)
        ? opts.outputConfigPath
        : path.join(rootPath, 'orientdb', 'config')

    this.outputConfigPath = outputConfigPath

    if (this.debug) console.log(`OrientdbServer: outputConfigPath: ${outputConfigPath}`)


    const databasePath =
      isString(opts.databasePath)
        ? opts.databasePath
        : path.join(rootPath, 'orientdb', 'databases')

    this.databasePath = databasePath

    if (this.debug) console.log(`OrientdbServer: databasePath: ${databasePath}`)

    this.pipe  = isBoolean(opts.pipe)  ? opts.pipe  : false

    this.properties = isDefined(opts.properties) ? opts.properties : {}
    this.users      = isDefined(opts.users)     ?  opts.users      : {}

    this.execPath                  = path.join(runtimePath, 'bin', `server.${OS_SHELL}`)

    this.inputHazelcastConfigPath  = path.join(inputConfigPath,  'hazelcast.xml')
    this.outputHazelcastConfigPath = path.join(outputConfigPath, 'hazelcast.xml')

    this.inputOrientdbConfigPath   = path.join(inputConfigPath,  'orientdb-server-config.xml')
    this.outputOrientdbConfigPath  = path.join(outputConfigPath, 'orientdb-server-config.xml')

    if (this.debug) console.log(`OrientdbServer: executable path: ${this.execPath}`)

    this.errors = []

    this.isStarting     = false
    this.isRunning      = false
    this.isClosed       = false
    this.closeRequested = false

    //do something when app is closing
    process.on('exit', () => {
      if (this.debug) console.log("parent is exiting")
      this.stop()
    })

    //catches ctrl+c event
    process.on('SIGINT', () => {
      if (this.debug) console.log("parent received SIGINT")
      this.stop()
    })
  }

  start() {

    if (this.mock === 'success') {
      return Promise.resolve(true)
    } else if (this.mock === 'failure') {
      return Promise.reject(new Error(`mock test: failure`))
    }

    if (this.isStarting || this.isRunning) {
      if (this.debug) console.log('OrientdbServer: server is already running')
      return Promise.resolve(true)
    }

    if (this.closeRequested) {
      return Promise.reject(new Error(`close has been requested`))
    }

    this.isStarting = true

    return this.configure().then(done => {
      if (this.debug) console.log("OrientdbServer: successfully configured!")
      return Promise.resolve(true)
    }).catch(err => {
      if (this.debug) console.log("OrientdbServer: failed to configure, falling back to default config")
      return Promise.resolve(false)
    }).then(status =>
      new Promise((resolve, reject) => {

        // unfortunately I am not this trick is multiplatform:
        // http://azimi.me/2014/12/31/kill-child_process-node-js.html
        this.process = spawn(this.execPath, [])

        this.process.on('error', err => {
          if (this.debug) console.log(`OrientdbServer: child process error: ${err}`)
          this.errors.push(err)
        })

        this.process.stdout.on('data', (data) => {
          if (this.pipe) console.log(`${data}`)
        })

        this.process.stderr.on('data', (data) => {
          if (this.pipe) console.error(`${data}`)
          const activationPattern = /OrientDB Server is active/i
          const str = `${data}`
          if (this.isStarting && !this.isRunning && !this.closeRequested && str.match(activationPattern)) {
            this.isRunning  = true
            this.isStarting = false
            this.isClosed   = false
            resolve(true)
          }
        })

        this.process.on('message', (message) => {
          //console.log(`OrientdbServer: child process message: ${message}`)
        })

        this.process.on('close', (code, signal) => {
          if (this.debug) console.log(`OrientdbServer: child process close: code=${code}, signal=${signal}`)
        })

        this.process.on('exit', (code, signal) => {
          if (this.debug) console.log(`OrientdbServer: child process exit: code=${code}, signal=${signal}`)
          this.isStarting = false
          this.isRunning  = false
          this.manually   = false
          this.isClosed   = true
        })

        // timeout check to be sure we are not stuck somewhere in the process
        setTimeout(() => {
          if (this.isStarting && !this.isRunning && !this.closeRequested) {
            const errors = (this.errors.length) ? this.errors.join('\n') : 'timeout'
            const error = `couldn't start the server in time: ${errors}`
            reject(new Error(error))
          }
        }, this.initTimeout)
      })
    )
  }

  stop() {
    if (!this.process) return;
    this.process.kill('SIGHUP')
    return new Promise((resolve, reject) => {
      setTimeout(() => {
        if (!this.isRunning) {
          resolve(true)
        } else {
          reject(new Error(`couldn't stop the server`))
        }
      }, 1000)
    })
  }

  configure() {
    return new Promise((resolve, reject) => {
      fs.readFile(this.inputOrientdbConfigPath, 'utf8', (err, configStr) => {
        if (err) {
          reject(new Error(`couldn't open config file: ${err}`))
          return
        }

        xml2js.parseString(configStr, (err, config) => {
          if (err) {
            reject(err)
            return
          }

          Server.setUsers(config, this.users)
          Server.setProperties(config, this.properties)
          fs.writeFile(
            this.outputOrientdbConfigPath,
            new xml2js.Builder().buildObject(config),
            'utf8',
            (err) =>  {
              if (err) {
                reject(err)
              } else {
                resolve(true)
              }
            })
        })
      })
    })
  }

  static setUsers(config, users) {
    config['orient-server'].users = [{
      user: Object.keys(users).map(user => ({
        "$": {
          name     : user,
          password : users[user].password,
          resources: users[user].resources
        }
      }))
    }]
  }

  static setProperties(config, properties) {

    // not very optimized, ad we filter for each property, but this function
    // is probably only called once - at app startup - so maybe no need to optimize
    Object.keys(properties).forEach(camelKey => {
      const value  = properties[camelKey]
      const dotKey = decamelize(camelKey, '.')
      config['orient-server'].properties[0].entry = config['orient-server'].properties[0].entry
        .filter(name => `${name}`.toLowerCase() !== `${dotKey}`.toLowerCase())
        .concat([{
          "$": {
            name : dotKey,
            value: value
          }
        }])
    })
  }

  /**
   * Set an OrientDB property
   */
  static setProperty(config, camelKey, value) {

    const dotKey = decamelize(camelKey, '.')

    config['orient-server'].properties[0].entry =
      config['orient-server'].properties[0].entry
        .filter(name => `${name}`.toLowerCase() !== `${dotKey}`.toLowerCase())
        .concat([{
          "$": {
            name : dotKey,
            value: value
          }
        }]
      )
  }
}

module.exports         = Server
module.exports.default = Server
module.exports.Server  = Server
