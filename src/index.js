import fs from 'fs'
import path from 'path'
import {spawn} from 'cross-spawn'
import commandConvert from './command'
import varValueConvert from './variable'

module.exports = crossEnv

const envSetterRegex = /(\w+)=('(.*)'|"(.*)"|(.*))/

function crossEnv(args, options = {}) {
  const [envSetters, command, commandArgs] = parseCommand(args)
  const env = getEnvVars(envSetters)
  if (command) {
    const proc = spawn(
      // run `path.normalize` for command(on windows)
      commandConvert(command, env, true),
      // by default normalize is `false`, so not run for cmd args
      commandArgs.map(arg => commandConvert(arg, env)),
      {
        stdio: 'inherit',
        shell: options.shell,
        env,
      },
    )
    process.on('SIGTERM', () => proc.kill('SIGTERM'))
    process.on('SIGINT', () => proc.kill('SIGINT'))
    process.on('SIGBREAK', () => proc.kill('SIGBREAK'))
    process.on('SIGHUP', () => proc.kill('SIGHUP'))
    proc.on('exit', (code, signal) => {
      let crossEnvExitCode = code
      // exit code could be null when OS kills the process(out of memory, etc) or due to node handling it
      // but if the signal is SIGINT the user exited the process so we want exit code 0
      if (crossEnvExitCode === null) {
        crossEnvExitCode = signal === 'SIGINT' ? 0 : 1
      }
      process.exit(crossEnvExitCode) //eslint-disable-line no-process-exit
    })
    return proc
  }
  return null
}

function parseCommand(args) {
  const envSetters = {}
  let command = null
  let commandArgs = []
  for (let i = 0; i < args.length; i++) {
    const match = envSetterRegex.exec(args[i])
    if (match) {
      let value

      if (typeof match[3] !== 'undefined') {
        value = match[3]
      } else if (typeof match[4] === 'undefined') {
        value = match[5]
      } else {
        value = match[4]
      }

      envSetters[match[1]] = value
    } else {
      // No more env setters, the rest of the line must be the command and args
      let cStart = []
      cStart = args
        .slice(i)
        // Regex:
        // match "\'" or "'"
        // or match "\" if followed by [$"\] (lookahead)
        .map(a => {
          const re = /\\\\|(\\)?'|([\\])(?=[$"\\])/g
          // Eliminate all matches except for "\'" => "'"
          return a.replace(re, m => {
            if (m === '\\\\') return '\\'
            if (m === "\\'") return "'"
            return ''
          })
        })
      command = cStart[0]
      commandArgs = cStart.slice(1)
      break
    }
  }

  return [envSetters, command, commandArgs]
}

function getEnvVars(envSetters) {
  const fileEnv = getFileEnvVars()
  Object.keys(fileEnv).forEach(key => {
    if (fileEnv[key] === null || fileEnv[key] === undefined) {
      fileEnv[key] = ''
    }
    fileEnv[key] = fileEnv[key].toString()
  })
  envSetters = Object.assign({}, fileEnv, envSetters)
  const envVars = Object.assign({}, process.env)
  if (process.env.APPDATA) {
    envVars.APPDATA = process.env.APPDATA
  }
  Object.keys(envSetters).forEach(varName => {
    envVars[varName] = varValueConvert(envSetters[varName], varName)
  })
  return envVars
}

function getFileEnvVars() {
  // Find the first file with a matching name in the CWD:
  const FILE_NAMES = ['.env', '.env.json', '.env.js']
  for (let i = 0; i < FILE_NAMES.length; i++) {
    const file = path.join(process.cwd(), FILE_NAMES[i])
    if (fs.existsSync(file)) {
      return loadEnvFile(file)
    }
  }

  return {}
}

function loadEnvFile(file) {
  const extname = path.extname(file)
  if (extname === '.json' || extname === '.js') {
    return require(file)
  }
  const content = fs.readFileSync(file).toString()
  return content
    // simply line endings
    .replace('\r', '')
    // convert file into lines
    .split('\n')
    // trim whitespace
    .map(line => line.trim())
    // remove comments
    .filter(line => line.charAt(0) !== '#')
    // remove empty lines
    .filter(line => line)
    // regex parse lines
    .map(line => envSetterRegex.exec(line))
    // filter missed matches
    .filter(match => match)
    // convert to hashtable
    .reduce((env, match) => {
      let value

      if (typeof match[3] !== 'undefined') {
        value = match[3]
      } else if (typeof match[4] === 'undefined') {
        value = match[5]
      } else {
        value = match[4]
      }

      env[match[1]] = value
      return env
    }, {})
}
