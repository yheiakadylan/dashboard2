import { readFile, readdir, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import JavaScriptObfuscator from 'javascript-obfuscator';

const distDirectory = path.resolve('dist');
const extensionMode = process.argv.includes('--extension');

async function collectFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = await Promise.all(entries.map(async entry => {
    const target = path.join(directory, entry.name);
    return entry.isDirectory() ? collectFiles(target) : [target];
  }));
  return files.flat();
}

const candidates = (await collectFiles(distDirectory)).filter(file => {
  const name = path.basename(file);
  return extensionMode
    ? /^(?:background|collector|popup)\.js$/.test(name)
    : /^index-.*\.js$/.test(name) || /^dataWorker-.*\.js$/.test(name);
});

for (const file of candidates) {
  const source = await readFile(file, 'utf8');
  const result = JavaScriptObfuscator.obfuscate(source, {
    compact: true,
    controlFlowFlattening: false,
    deadCodeInjection: false,
    debugProtection: false,
    identifierNamesGenerator: 'hexadecimal',
    numbersToExpressions: true,
    renameGlobals: false,
    renameProperties: false,
    selfDefending: false,
    simplify: true,
    splitStrings: true,
    splitStringsChunkLength: 8,
    stringArray: true,
    stringArrayEncoding: ['base64'],
    stringArrayIndexShift: true,
    stringArrayRotate: true,
    stringArrayShuffle: true,
    stringArrayThreshold: 0.65,
    transformObjectKeys: true,
    unicodeEscapeSequence: false,
  });
  await writeFile(file, result.getObfuscatedCode(), 'utf8');
  const size = (await stat(file)).size;
  console.log(`[obfuscate] ${path.relative(distDirectory, file)} (${Math.round(size / 1024)} KiB)`);
}

if (candidates.length === 0) throw new Error(`No ${extensionMode ? 'extension' : 'dashboard'} application bundles were found to obfuscate.`);
