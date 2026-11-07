import { readFile, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..')
const require = createRequire(resolve(root, '../../网页端/项目/package.json'))
const ts = require('typescript')
const source = await readFile(resolve(root, '../../网页端/项目/src/engine/teaching-runtime.ts'), 'utf8')
const { outputText, diagnostics } = ts.transpileModule(source, {
  compilerOptions: { target: ts.ScriptTarget.ES2015, module: ts.ModuleKind.CommonJS },
  reportDiagnostics: true,
})
if (diagnostics.some((item) => item.category === ts.DiagnosticCategory.Error)) {
  throw new Error(ts.formatDiagnosticsWithColorAndContext(diagnostics, {
    getCurrentDirectory: () => root, getCanonicalFileName: (name) => name, getNewLine: () => '\n',
  }))
}
await writeFile(process.argv[2], `(function() { const exports = {};
if (!Array.prototype.at) Object.defineProperty(Array.prototype, 'at', { value: function(index) {
  return this[index < 0 ? this.length + index : index];
} });
${outputText}\nreturn exports.simulateProgram; })()`, 'utf8')
