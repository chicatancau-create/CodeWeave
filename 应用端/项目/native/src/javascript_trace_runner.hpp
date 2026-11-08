#pragma once

#include <string_view>

namespace codeweave::execution {

inline constexpr std::string_view kJavaScriptTraceRunner = R"JS(
const fs = require('node:fs');
const inspector = require('node:inspector');
const vm = require('node:vm');
const Module = require('node:module');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { JSON, Object, String, Set, Buffer } = globalThis;
const sourcePath = path.resolve(process.argv[2]);
const snapshotPath = process.argv[3];
const syntaxFallbackPath = process.argv[4];
let sourceUrl = pathToFileURL(sourcePath).href;
const source = fs.readFileSync(sourcePath, 'utf8');
const lastSourceLine = source.trimEnd().split(/\r\n|\r|\n/).length - 1;
const session = new inspector.Session();
let scriptId;
let stepCount = 0;
let stepBytes = 0;
let hostGlobals;

function post(method, params, callback) {
  session.post(method, params, callback);
}

function render(value) {
  if (value.type === 'string') {
    return JSON.stringify(value.value.slice(0, 160)) + (value.value.length > 160 ? '...' : '');
  }
  if (value.type === 'number' || value.type === 'boolean') return String(value.value ?? value.unserializableValue);
  if (value.type === 'undefined') return 'undefined';
  if (value.subtype === 'null') return 'null';
  if (value.type === 'bigint') return (value.unserializableValue || '<bigint>').slice(0, 160);
  return '<object>';
}

session.connect();
session.on('Debugger.scriptParsed', ({ params }) => {
  if (params.url !== sourceUrl) return;
  scriptId = params.scriptId;
  post('Debugger.getPossibleBreakpoints', {
    start: { scriptId, lineNumber: 0 }, restrictToFunction: false
  }, (error, result) => {
    if (error) return;
    const lines = new Set();
    for (const location of result.locations) {
      if (location.lineNumber > lastSourceLine) continue;
      if (lines.has(location.lineNumber) || lines.size >= 4096) continue;
      lines.add(location.lineNumber);
      post('Debugger.setBreakpoint', { location }, () => {});
    }
  });
});
session.on('Debugger.paused', ({ params }) => {
  const frame = params.callFrames[0];
  if (!frame || frame.location.scriptId !== scriptId || frame.location.lineNumber > lastSourceLine ||
      stepCount >= 512 || stepBytes >= 262144) {
    if (stepCount >= 512 || stepBytes >= 262144) post('Debugger.setSkipAllPauses', { skip: true }, () => {});
    post('Debugger.resume', {}, () => {});
    return;
  }
  ++stepCount;
  const variables = Object.create(null);
  const scopes = frame.scopeChain.filter(scope => scope.type === 'local' || scope.type === 'block' ||
      scope.type === 'catch' || scope.type === 'closure' || scope.type === 'script' ||
      scope.type === 'module' || scope.type === 'global');
  function readScope(index) {
    if (index >= scopes.length || Object.keys(variables).length >= 16) {
      const record = JSON.stringify({ line: frame.location.lineNumber + 1,
        phase: params.reason === 'exception' ? 'exception' : 'line', variables }) + '\n';
      const bytes = Buffer.byteLength(record, 'utf8');
      if (bytes <= 8192 && stepBytes + bytes <= 262144) {
        fs.appendFileSync(snapshotPath, record, 'utf8');
        stepBytes += bytes;
      }
      post('Debugger.resume', {}, () => {});
      return;
    }
    post('Runtime.getProperties', { objectId: scopes[index].object.objectId, ownProperties: true,
      generatePreview: false }, (error, result) => {
      if (!error) {
        for (const property of result.result) {
          if (Object.keys(variables).length >= 16) break;
          const name = property.name;
          if (property.symbol || (scopes[index].type === 'global' && hostGlobals.has(name)) ||
              name.startsWith('__') || ['exports', 'require', 'module'].includes(name) ||
              Object.prototype.hasOwnProperty.call(variables, name) || !property.value) continue;
          variables[name.slice(0, 128)] = render(property.value);
        }
      }
      readScope(index + 1);
    });
  }
  readScope(0);
});
process.once('exit', () => session.disconnect());
session.post('Debugger.enable');
session.post('Debugger.setPauseOnExceptions', { state: 'uncaught' });
const learner = new Module('[stdin]', module);
learner.filename = path.join(process.cwd(), '[stdin]');
learner.paths = Module._nodeModulePaths(process.cwd());
const learnerRequire = Module.createRequire(learner.filename);
learnerRequire.main = undefined;
process.argv = [process.execPath, '-'];
Object.assign(globalThis, { require: learnerRequire, module: learner, exports: learner.exports,
  __filename: '[stdin]', __dirname: '.' });
hostGlobals = new Set(Object.getOwnPropertyNames(globalThis));
let compiled;
try {
  compiled = new vm.Script(source, { filename: sourcePath });
} catch (error) {
  if (error.name !== 'SyntaxError') throw error;
  if (typeof Module.registerHooks !== 'function') {
    fs.writeFileSync(syntaxFallbackPath, '1');
    process.exit(1);
  }
  // Match Node's stdin ESM entry URL: relative imports and import.meta resolve
  // against cwd, not against the disposable trace directory.
  sourceUrl = pathToFileURL(path.join(process.cwd(), '[eval1]')).href;
  for (const name of ['require', 'module', 'exports', '__filename', '__dirname']) delete globalThis[name];
  Module.registerHooks({
    resolve(specifier, context, nextResolve) {
      if (specifier === sourceUrl) return { url: sourceUrl, shortCircuit: true };
      return nextResolve(specifier, context);
    },
    load(url, context, nextLoad) {
      if (url === sourceUrl) return { format: 'module', source, shortCircuit: true };
      return nextLoad(url, context);
    }
  });
  let settled = false;
  let unresolvedExit = false;
  process.on('beforeExit', () => {
    if (!settled && (process.exitCode === undefined || process.exitCode === 0)) {
      unresolvedExit = true;
      process.exitCode = 13;
    }
  });
  import(sourceUrl).then(() => {
    settled = true;
    if (unresolvedExit && process.exitCode === 13) process.exitCode = 0;
  }, moduleError => {
    settled = true;
    // Throw outside promise/Inspector callbacks to retain ordinary uncaught
    // failure and nonzero exit behavior; never retry learner execution.
    setImmediate(() => { throw moduleError; });
  });
  return;
}
// Execute outside Inspector callbacks so learner exceptions retain their exit status.
compiled.runInThisContext();
)JS";

}  // namespace codeweave::execution
