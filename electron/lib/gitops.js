'use strict';
const { run, exists } = require('./util');
const path = require('path');

async function git(root, args, timeout = 120000) {
  const r = await run('git', args, { cwd: root, timeout, env: { ...process.env, GIT_TERMINAL_PROMPT: '0' } });
  return { ok: r.code === 0, out: (r.stdout || '').trim(), err: (r.stderr || '').trim(), code: r.code };
}

async function available() {
  const r = await run('git', ['--version'], { timeout: 10000 });
  return r.code === 0 ? r.stdout.trim() : null;
}

async function status(root) {
  const version = await available();
  if (!version) return { available: false };
  const isRepo = exists(path.join(root, '.git'));
  if (!isRepo) return { available: true, version, isRepo: false };
  const [st, br, remote, log] = await Promise.all([
    git(root, ['status', '--porcelain=v1']),
    git(root, ['rev-parse', '--abbrev-ref', 'HEAD']),
    git(root, ['remote', '-v']),
    git(root, ['log', '--pretty=format:%h%x09%an%x09%ar%x09%s', '-n', '30']),
  ]);
  return {
    available: true,
    version,
    isRepo: true,
    branch: br.ok ? br.out : '(no commits yet)',
    changes: st.out ? st.out.split(/\r?\n/).map((l) => ({ code: l.slice(0, 2).trim(), file: l.slice(3) })) : [],
    remote: remote.out.split(/\r?\n/).find((l) => l.includes('(push)'))?.split(/\s+/)[1] || '',
    log: log.ok && log.out ? log.out.split(/\r?\n/).map((l) => {
      const [hash, author, when, subject] = l.split('\t');
      return { hash, author, when, subject };
    }) : [],
  };
}

async function init(root) {
  const r = await git(root, ['init']);
  if (r.ok && !exists(path.join(root, '.gitignore'))) {
    require('fs').writeFileSync(
      path.join(root, '.gitignore'),
      '*.aux\n*.log\n*.synctex.gz\n*.fls\n*.fdb_latexmk\n*.out\n*.toc\n*.bbl\n*.blg\n*.bcf\n*.run.xml\n*.lof\n*.lot\n',
    );
  }
  return r;
}

async function commit(root, message, name, email) {
  await git(root, ['add', '-A']);
  const args = [];
  if (name) args.push('-c', `user.name=${name}`);
  if (email) args.push('-c', `user.email=${email}`);
  return git(root, [...args, 'commit', '-m', message || 'Update from FreedomTex']);
}

const push = (root) => git(root, ['push', '-u', 'origin', 'HEAD'], 300000);
const pull = (root) => git(root, ['pull', '--no-rebase'], 300000);
const setRemote = async (root, url) => {
  const has = await git(root, ['remote', 'get-url', 'origin']);
  return git(root, has.ok ? ['remote', 'set-url', 'origin', url] : ['remote', 'add', 'origin', url]);
};

module.exports = { status, init, commit, push, pull, setRemote };
