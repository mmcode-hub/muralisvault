import { createHash } from 'node:crypto';
import { createWriteStream, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn, spawnSync } from 'node:child_process';
import { pipeline } from 'node:stream/promises';

const toolDir = resolve(fileURLToPath(new URL('.', import.meta.url)));
const version = '0.167.0';
const runtimeDir = join(toolDir, '.runtime');
const hugoPath = join(runtimeDir, 'hugo');
const archive = join(runtimeDir, `hugo_extended_${version}_linux-amd64.tar.gz`);

function execute(command, args, options = {}) {
  const result = spawnSync(command, args, { stdio: 'inherit', shell: false, ...options });
  if (result.status !== 0) process.exit(result.status || 1);
}

async function download(url, destination) {
  const response = await fetch(url);
  if (!response.ok || !response.body) throw new Error(`Download failed: ${response.status} ${url}`);
  await pipeline(response.body, createWriteStream(destination));
}

async function ensureHugo() {
  if (existsSync(hugoPath) && spawnSync(hugoPath, ['version'], { encoding: 'utf8' }).stdout.includes(`v${version}`)) return;
  mkdirSync(runtimeDir, { recursive: true });
  const base = `https://github.com/gohugoio/hugo/releases/download/v${version}`;
  const name = `hugo_extended_${version}_linux-amd64.tar.gz`;
  console.log(`Downloading Hugo Extended ${version} for Blog Studio…`);
  await download(`${base}/${name}`, archive);
  const sums = await (await fetch(`${base}/hugo_${version}_checksums.txt`)).text();
  const expected = sums.match(new RegExp(`^([a-f0-9]{64})\\s+${name.replaceAll('.', '\\.')}\\s*$`, 'm'))?.[1];
  const actual = createHash('sha256').update(readFileSync(archive)).digest('hex');
  if (!expected || expected !== actual) throw new Error('The downloaded Hugo archive did not match its published checksum.');
  execute('tar', ['-xzf', archive, '-C', runtimeDir, 'hugo']);
}

await ensureHugo();
if (!existsSync(join(toolDir, 'node_modules', 'vite'))) {
  console.log('Installing Blog Studio dependencies…');
  execute('npm', ['install'], { cwd: toolDir });
}
execute('npm', ['run', 'build'], { cwd: toolDir });
const child = spawn('node', ['server.mjs'], { cwd: toolDir, stdio: 'inherit', shell: false, env: { ...process.env, BLOG_STUDIO_HUGO: hugoPath } });
child.on('exit', (code) => process.exit(code || 0));
