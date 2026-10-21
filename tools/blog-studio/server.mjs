import { createServer } from 'node:http';
import { createReadStream, existsSync, readFileSync, rmSync, mkdirSync, readdirSync, statSync, writeFileSync, renameSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { extname, join, normalize, relative, resolve } from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const toolDir = resolve(fileURLToPath(new URL('.', import.meta.url)));
const repoDir = resolve(toolDir, '../..');
const distDir = join(toolDir, 'dist');
const contentDir = join(repoDir, 'content');
const trashDir = join(toolDir, '.runtime', 'trash');
const requiredHugo = '0.167.0';
const hugoBin = process.env.BLOG_STUDIO_HUGO || 'hugo';
const host = '127.0.0.1';
const port = 4174;
const sections = new Set(['profession', 'travel', 'my-thoughts', 'temple-architecture/temple-stories', 'temple-architecture/places', 'temple-architecture/architectural-elements']);
let hugoProcess;
let authState = { running: false, output: '', completed: false };

function run(command, args, options = {}) {
  return new Promise((resolveRun, rejectRun) => {
    const child = spawn(command, args, { cwd: repoDir, shell: false, ...options });
    let stdout = '', stderr = '';
    child.stdout?.on('data', (chunk) => { stdout += chunk; });
    child.stderr?.on('data', (chunk) => { stderr += chunk; });
    child.on('error', rejectRun);
    child.on('close', (code) => code === 0 ? resolveRun({ stdout, stderr }) : rejectRun(new Error(`${command} ${args.join(' ')} failed (${code}).\n${stderr || stdout}`)));
  });
}

function commandText(command, args) {
  const result = spawnSync(command, args, { cwd: repoDir, encoding: 'utf8', shell: false });
  return { ok: result.status === 0, output: `${result.stdout || ''}${result.stderr || ''}`.trim() };
}

function isHugoReady() { return commandText(hugoBin, ['version']).output.includes(`v${requiredHugo}`); }
function pathInside(parent, candidate) { return relative(parent, candidate) && !relative(parent, candidate).startsWith('..') && !resolve(candidate).startsWith('..'); }
function validSlug(value) { return typeof value === 'string' && /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value); }
function yaml(value) { return String(value || '').replaceAll('\\', '\\\\').replaceAll('"', '\\"').replaceAll('\n', ' '); }
function postPath(section, slug) {
  if (!sections.has(section) || !validSlug(slug)) throw new Error('Choose a valid section and lowercase hyphenated slug.');
  return join(contentDir, section, slug, 'index.md');
}
function parseDataUrl(value) {
  const match = /^data:([\w/+.-]+);base64,([A-Za-z0-9+/=]+)$/.exec(value || '');
  if (!match) throw new Error('An uploaded file is not valid base64 data.');
  return Buffer.from(match[2], 'base64');
}
function validAssetName(name) { return typeof name === 'string' && /^[a-zA-Z0-9][a-zA-Z0-9._-]*\.(?:jpe?g|png|webp)$/i.test(name); }
function safeBundlePath(section, slug) { const result = resolve(postPath(section, slug), '..'); if (!pathInside(contentDir, result)) throw new Error('Post path escapes content directory.'); return result; }
function branchName(date, slug) { return `blog/${date}-${slug}`; }

function status() {
  const problems = [];
  const github = commandText('gh', ['api', 'user', '--jq', '.login']);
  if (!isHugoReady()) problems.push(`Hugo ${requiredHugo} is required`);
  if (!github.ok) problems.push('Run gh auth login for GitHub publishing');
  if (!commandText('git', ['rev-parse', '--is-inside-work-tree']).ok) problems.push('This folder is not a Git repository');
  return { ready: problems.length === 0, problems, hugo: commandText(hugoBin, ['version']).output, gh: commandText('gh', ['--version']).output.split('\n')[0], github: { authenticated: github.ok, account: github.ok ? github.output : '', ...authState } };
}

function readPost(pathname) {
  const absolute = resolve(repoDir, pathname || '');
  if (!absolute.startsWith(`${contentDir}/`) || !absolute.endsWith('/index.md') || !existsSync(absolute)) throw new Error('Post not found.');
  const raw = readFileSync(absolute, 'utf8');
  const match = /^---\n([\s\S]*?)\n---\n?([\s\S]*)$/m.exec(raw);
  if (!match) throw new Error('Post has no YAML front matter.');
  const value = (key) => (new RegExp(`^${key}:\\s*"?(.*?)"?\\s*$`, 'm').exec(match[1])?.[1] || '').replaceAll('\\"', '"');
  const relativePath = relative(repoDir, absolute);
  const pieces = relative(contentDir, absolute).split('/');
  return { path: relativePath, bundle: relative(repoDir, resolve(absolute, '..')), section: pieces.slice(0, -2).join('/'), slug: pieces.at(-2), title: value('title'), date: value('date'), draft: value('draft') === 'true', summary: value('summary'), image: value('image'), imageAlt: value('imageAlt'), imageCaption: value('imageCaption'), body: match[2].trim() };
}

function listPosts() {
  const found = [];
  const walk = (directory) => {
    for (const entry of readdirSync(directory)) {
      const fullPath = join(directory, entry);
      if (statSync(fullPath).isDirectory()) walk(fullPath);
      else if (entry === 'index.md' && !fullPath.includes('/_index.md')) {
        try { found.push(readPost(relative(repoDir, fullPath))); } catch { /* Leave hand-authored unsupported files alone. */ }
      }
    }
  };
  walk(contentDir);
  return found.sort((left, right) => right.date.localeCompare(left.date));
}

function trashRecord(id) {
  if (!/^[0-9a-f-]{36}$/.test(id || '')) throw new Error('Invalid deleted entry.');
  const folder = join(trashDir, id);
  const record = JSON.parse(readFileSync(join(folder, 'record.json'), 'utf8'));
  if (relative(repoDir, safeBundlePath(record.post.section, record.post.slug)) !== record.post.bundle) throw new Error('Invalid deleted entry path.');
  return { ...record, id, folder };
}

function listDeleted() {
  if (!existsSync(trashDir)) return [];
  return readdirSync(trashDir).flatMap((id) => {
    try { const { post, tracked, deletedAt } = trashRecord(id); return [{ ...post, tracked, deletedAt, trashId: id, deleted: true }]; }
    catch { return []; }
  }).sort((left, right) => right.deletedAt.localeCompare(left.deletedAt));
}

function deletePost(pathname) {
  const post = readPost(pathname);
  const bundle = safeBundlePath(post.section, post.slug);
  const tracked = commandText('git', ['ls-files', '--error-unmatch', '--', post.path]).ok;
  const id = randomUUID();
  const folder = join(trashDir, id);
  mkdirSync(folder, { recursive: true });
  try {
    writeFileSync(join(folder, 'record.json'), JSON.stringify({ post, tracked, deletedAt: new Date().toISOString() }));
    renameSync(bundle, join(folder, 'bundle'));
  } catch (error) { rmSync(folder, { recursive: true, force: true }); throw error; }
  return { ...post, tracked, trashId: id, deleted: true };
}

function restorePost(id) {
  const { post, folder } = trashRecord(id);
  const bundle = safeBundlePath(post.section, post.slug);
  if (existsSync(bundle)) throw new Error('An entry already exists at this path.');
  mkdirSync(resolve(bundle, '..'), { recursive: true });
  renameSync(join(folder, 'bundle'), bundle);
  rmSync(folder, { recursive: true, force: true });
  return readPost(post.path);
}

function beginGithubLogin() {
  if (authState.running) return authState;
  authState = { running: true, output: 'Starting GitHub browser authorization…\n', completed: false };
  const child = spawn('gh', ['auth', 'login', '--hostname', 'github.com', '--web', '--git-protocol', 'https', '--skip-ssh-key'], { cwd: repoDir, shell: false });
  const append = (chunk) => { authState.output = `${authState.output}${chunk}`.slice(-6000); };
  child.stdout.on('data', append); child.stderr.on('data', append);
  child.on('error', (error) => { authState = { running: false, output: `${authState.output}\n${error.message}`, completed: false }; });
  child.on('close', (code) => { authState = { running: false, output: authState.output, completed: code === 0 }; });
  return authState;
}

function startHugo() {
  if (!isHugoReady()) return;
  hugoProcess = spawn(hugoBin, ['server', '--buildDrafts', '--port', '1313', '--bind', host], { cwd: repoDir, shell: false, stdio: 'ignore' });
  hugoProcess.on('exit', () => { hugoProcess = undefined; });
}

async function readJson(request) {
  let raw = '';
  for await (const part of request) { raw += part; if (raw.length > 20_000_000) throw new Error('Request is too large.'); }
  return JSON.parse(raw || '{}');
}
function send(response, code, body) { response.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8' }); response.end(JSON.stringify(body)); }
function serveFile(response, pathname) {
  const requested = pathname === '/' ? 'index.html' : pathname.slice(1);
  const target = resolve(distDir, requested);
  if (!target.startsWith(`${distDir}/`) || !existsSync(target)) return false;
  const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml' };
  response.writeHead(200, { 'Content-Type': types[extname(target)] || 'application/octet-stream' }); createReadStream(target).pipe(response); return true;
}

async function savePost(payload) {
  const { title, section, slug, date, summary, draft, image, imageAlt, imageCaption, body, assets = [], existingPath } = payload;
  if (![title, date, summary, body].every((value) => typeof value === 'string' && value.trim())) throw new Error('Title, date, summary, and article body are required.');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error('Date must use YYYY-MM-DD.');
  const bundle = safeBundlePath(section, slug);
  const updating = Boolean(existingPath);
  if (updating && relative(repoDir, resolve(repoDir, existingPath)) !== relative(repoDir, join(bundle, 'index.md'))) throw new Error('Changing a post path is not supported; create a new post instead.');
  if (!updating && existsSync(bundle)) throw new Error('A post already exists at this section and slug.');
  const names = new Set();
  for (const asset of assets) { if (!validAssetName(asset.name) || names.has(asset.name)) throw new Error('Images must use unique JPEG, PNG, or WebP filenames.'); names.add(asset.name); parseDataUrl(asset.content); }
  if (image && !names.has(image) && !existsSync(join(bundle, image))) throw new Error('The selected cover image was not uploaded.');
  mkdirSync(bundle, { recursive: true });
  try {
    for (const asset of assets) writeFileSync(join(bundle, asset.name), parseDataUrl(asset.content));
    const markdown = `---\ntitle: "${yaml(title.trim())}"\ndate: ${date}\ndraft: ${draft ? 'true' : 'false'}\nsummary: "${yaml(summary.trim())}"\nimage: "${yaml(image)}"\nimageAlt: "${yaml(imageAlt)}"\nimageCaption: "${yaml(imageCaption)}"\n---\n\n${body.trim()}\n`;
    writeFileSync(join(bundle, 'index.md'), markdown);
  } catch (error) { if (!updating) rmSync(bundle, { recursive: true, force: true }); throw error; }
  return { path: relative(repoDir, join(bundle, 'index.md')), section, slug, date, bundle: relative(repoDir, bundle) };
}

async function validate() {
  if (!isHugoReady()) throw new Error(`Hugo ${requiredHugo} is required; current version is ${commandText(hugoBin, ['version']).output || 'not installed'}.`);
  const build = await run(hugoBin, ['--gc', '--minify', '--panicOnWarning', '--cleanDestinationDir']);
  const check = await run('python3', ['scripts/check_site.py', 'public']);
  return `${build.stdout}${build.stderr}${check.stdout}${check.stderr}`.trim() || 'Hugo build and site checks passed.';
}

function assertOnlyBundleChanged(bundle) {
  const prefix = `${bundle.replaceAll('\\', '/')}/`;
  const staged = commandText('git', ['diff', '--cached', '--name-only']).output.split('\n').filter(Boolean);
  const unrelated = staged.filter((file) => !file.replaceAll('\\', '/').startsWith(prefix));
  if (unrelated.length) throw new Error(`Refusing to publish while unrelated changes are staged: ${unrelated.join(', ')}`);
}

async function publish({ bundle, section, slug, date }) {
  if (!bundle || !validSlug(slug) || !/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error('Saved post information is incomplete.');
  if (relative(repoDir, safeBundlePath(section, slug)) !== bundle) throw new Error('Saved post path is invalid.');
  if (commandText('git', ['branch', '--show-current']).output !== 'main') throw new Error('Switch to main before creating a pull request.');
  if (!commandText('gh', ['api', 'user']).ok) throw new Error('Run gh auth login before publishing.');
  const deleting = !existsSync(join(repoDir, bundle));
  const tracked = commandText('git', ['ls-files', '--error-unmatch', '--', join(bundle, 'index.md')]).ok;
  if (deleting && !tracked) throw new Error('Only tracked entries can be removed through a pull request.');
  assertOnlyBundleChanged(bundle);
  await validate();
  const branch = branchName(date, slug);
  if (commandText('git', ['show-ref', '--verify', '--quiet', `refs/heads/${branch}`]).ok) throw new Error(`Local branch ${branch} already exists.`);
  await run('git', ['switch', '-c', branch]);
  await run('git', ['add', '--', bundle]);
  const action = deleting ? 'Remove' : tracked ? 'Update' : 'Add';
  await run('git', ['commit', '-m', `${action} ${slug}`]);
  await run('git', ['push', '--set-upstream', 'origin', branch]);
  const pr = await run('gh', ['pr', 'create', '--base', 'main', '--head', branch, '--title', `${action} ${slug}`, '--body', `Created with Blog Studio.\n\n${bundle}`]);
  const url = pr.stdout.trim();
  const numberMatch = /pull\/(\d+)/.exec(url);
  if (!numberMatch) throw new Error(`Pull request was created but its number could not be read: ${url}`);
  return { number: Number(numberMatch[1]), url, branch };
}

async function merge({ number, trashId }) {
  if (!Number.isInteger(number)) throw new Error('Invalid pull request number.');
  const checks = await run('gh', ['pr', 'checks', String(number)]);
  if (!checks.stdout.trim()) throw new Error('GitHub has not reported required checks yet.');
  await run('gh', ['pr', 'merge', String(number), '--squash', '--delete-branch']);
  await run('git', ['switch', 'main']);
  await run('git', ['pull', '--ff-only']);
  if (trashId) { try { const { folder } = trashRecord(trashId); rmSync(folder, { recursive: true, force: true }); } catch { /* The pull request has already merged. */ } }
  return `Merged PR #${number} and updated local main.`;
}

startHugo();
const server = createServer(async (request, response) => {
  try {
    const url = new URL(request.url, `http://${host}:${port}`);
    if (request.method === 'GET' && url.pathname === '/api/status') return send(response, 200, status());
    if (request.method === 'GET' && url.pathname === '/api/posts') return send(response, 200, { posts: url.searchParams.get('path') ? [readPost(url.searchParams.get('path'))] : listPosts() });
    if (request.method === 'GET' && url.pathname === '/api/deleted') return send(response, 200, { posts: listDeleted() });
    if (request.method === 'POST' && url.pathname === '/api/posts') return send(response, 201, await savePost(await readJson(request)));
    if (request.method === 'DELETE' && url.pathname === '/api/posts') return send(response, 200, deletePost((await readJson(request)).path));
    if (request.method === 'POST' && url.pathname === '/api/posts/restore') return send(response, 200, restorePost((await readJson(request)).trashId));
    if (request.method === 'POST' && url.pathname === '/api/github/login') return send(response, 202, beginGithubLogin());
    if (request.method === 'POST' && url.pathname === '/api/validate') return send(response, 200, { output: await validate() });
    if (request.method === 'POST' && url.pathname === '/api/publish') return send(response, 200, { pr: await publish(await readJson(request)) });
    if (request.method === 'POST' && url.pathname === '/api/merge') return send(response, 200, { output: await merge(await readJson(request)) });
    if (request.method === 'GET' && serveFile(response, url.pathname)) return;
    response.writeHead(404); response.end('Not found');
  } catch (error) { send(response, 400, { error: error.message }); }
});
server.listen(port, host, () => console.log(`Blog Studio: http://${host}:${port}`));
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => { hugoProcess?.kill(signal); server.close(() => process.exit(0)); });
