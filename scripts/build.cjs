'use strict';
// Build pipeline for dsh-cross-collaboration (persistent installable plugin):
// tsc compiles src/*.ts -> dist/*.js (ESM host/client plugins + plain gateway script).
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const root = path.join(__dirname, '..');

console.log('[build] compiling TypeScript...');
const tscBin = path.join(root, 'node_modules', '.bin', process.platform === 'win32' ? 'tsc.cmd' : 'tsc');
execSync('"' + tscBin + '" -p tsconfig.json', { cwd: root, stdio: 'inherit' });

for (const name of ['host.js', 'gateway.js']) {
  const file = path.join(root, 'dist', name);
  console.log('[build] dist/' + name + ':', fs.readFileSync(file, 'utf8').length, 'chars');
}

// Client bundle: the DSH client-modules loader expects a self-registering
// bundle (window.__ModuleLoader__.load({ id, factory })) — not a bare ESM
// module. Wrap the compiled client half: React is injected via require()
// (no global React in the client world), and the plugin surface is assigned
// onto module.exports.
{
  const clientFile = path.join(root, 'dist', 'client.js');
  const compiled = fs.readFileSync(clientFile, 'utf8');
  let body = compiled.replace(/^export /gm, '');
  body += '\nexports.name = name;\nexports.inject = inject;\nexports.apply = apply;\n';
  const bundle =
    'window.__ModuleLoader__.load({\n' +
    '\tid: "dsh-cross-collaboration",\n' +
    '\tfactory: (require) => {\n' +
    '\t\tvar module = { exports: {} };\n' +
    '\t\tvar exports = module.exports;\n' +
    '\t\tObject.defineProperty(exports, Symbol.toStringTag, { value: "Module" });\n' +
    '\t\tvar React = require("react");\n' +
    body.split('\n').map((l) => '\t\t' + l).join('\n') + '\n' +
    '\t\treturn module.exports;\n' +
    '\t}\n' +
    '});\n';
  fs.writeFileSync(clientFile, bundle);
  console.log('[build] dist/client.js:', bundle.length, 'chars (self-registering bundle)');
}
