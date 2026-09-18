'use strict';
const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const paths = require('./paths');
const tex = require('./tex');
const logparser = require('./logparser');
const { exists, run, killTree, walk, sha1, readJSON, writeJSON, toPosix } = require('./util');

const active = new Map(); // projectId -> { child, cancelled }

const RERUN_RE = /(Rerun to get|Please rerun LaTeX|Label\(s\) may have changed|Rerun LaTeX|Table widths have changed|may have changed\. Rerun|\(rerunfilecheck\).*Rerun|Please \(re\)run LaTeX)/i;

function readText(file) {
  try {
    if (fs.statSync(file).size > 30e6) return '';
    return fs.readFileSync(file, 'utf8');
  } catch {
    return '';
  }
}

function hashFiles(files) {
  const parts = [];
  for (const f of files) {
    try {
      parts.push(f + ':' + sha1(fs.readFileSync(f)));
    } catch {
      parts.push(f + ':-');
    }
  }
  return sha1(parts.join('|'));
}

async function mirrorDirs(root, outDir) {
  const entries = await walk(root, { dirs: true });
  for (const e of entries) if (e.dir) await fsp.mkdir(path.join(outDir, e.rel), { recursive: true });
}

function magicProgram(root, mainFile) {
  try {
    const head = fs.readFileSync(path.join(root, mainFile), 'utf8').slice(0, 3000);
    const m = /%\s*!TEX\s+(?:TS-)?program\s*=\s*(\w+)/i.exec(head);
    if (m) {
      const p = m[1].toLowerCase();
      if (['pdflatex', 'xelatex', 'lualatex'].includes(p)) return p;
    }
  } catch {
    /* ignore */
  }
  return null;
}

async function compile(project, opts = {}, onLog = () => {}) {
  const info = await tex.detect();
  if (!info.found) {
    return { status: 'no-tex', issues: emptyIssues(), log: '', message: 'No TeX distribution was found.' };
  }
  if (active.has(project.id)) return { status: 'busy', issues: emptyIssues(), log: '' };

  const job = { child: null, cancelled: false };
  active.set(project.id, job);
  const started = Date.now();
  const root = project.path;
  const outDir = paths.buildDir(project.id);
  const statePath = path.join(outDir, '.freedomtex-state.json');

  try {
    if (opts.fromScratch) await fsp.rm(outDir, { recursive: true, force: true });
    await fsp.mkdir(outDir, { recursive: true });
    await mirrorDirs(root, outDir);

    let mainFile = project.mainFile;
    if (!mainFile || !exists(path.join(root, mainFile))) {
      return {
        status: 'failure',
        issues: { ...emptyIssues(), errors: [{ level: 'error', message: `The main document "${mainFile || '(none)'}" was not found. Choose a main document in Project Settings.`, file: null, line: null }] },
        log: '',
      };
    }
    mainFile = toPosix(mainFile);
    const jobname = path.posix.basename(mainFile).replace(/\.[^.]+$/, '');
    const engine = magicProgram(root, mainFile) || project.compiler || 'pdflatex';
    const engineExe = tex.toolPath(engine);
    if (!engineExe) {
      return { status: 'failure', issues: { ...emptyIssues(), errors: [{ level: 'error', message: `${engine} is not available in your TeX distribution.`, file: null, line: null }] }, log: '' };
    }

    const isMiktex = info.type === 'miktex';
    const env = tex.texEnv({
      BIBINPUTS: `${root}${path.delimiter}`,
      BSTINPUTS: `${root}${path.delimiter}`,
      TEXINPUTS: `${root}${path.delimiter}`,
      INDEXSTYLE: `${root}${path.delimiter}`,
      TEXMFOUTPUT: outDir,
      openout_any: 'a',
    });

    const args = ['-interaction=nonstopmode', '-file-line-error', '-synctex=1', `-output-directory=${outDir}`];
    // FreedomTex asks before installing; "enableInstaller" lets MiKTeX fetch files we could not map to a package.
    if (isMiktex) args.push(opts.enableInstaller ? '-enable-installer' : '-disable-installer');
    if (isMiktex && engine !== 'lualatex') args.push('-max-print-line=10000');
    if (project.haltOnError) args.push('-halt-on-error');
    if (project.shellEscape) args.push('-shell-escape');
    if (opts.draft || project.draft) {
      args.push(`-jobname=${jobname}`);
      args.push(`\\PassOptionsToPackage{draft}{graphicx}\\input{${mainFile}}`);
    } else {
      args.push(mainFile);
    }

    const state = readJSON(statePath, {});
    const pdfPath = path.join(outDir, `${jobname}.pdf`);
    const logPath = path.join(outDir, `${jobname}.log`);
    const pdfBefore = exists(pdfPath) ? fs.statSync(pdfPath).mtimeMs : 0;
    const timeoutMs = (opts.timeout || 300) * 1000;
    const deadline = started + timeoutMs;

    const auxWatch = () => {
      const exts = ['aux', 'toc', 'lof', 'lot', 'out', 'nav', 'snm', 'loa', 'lol', 'thm'];
      const list = exts.map((e) => path.join(outDir, `${jobname}.${e}`));
      // \include'd chapters write their own .aux files.
      try {
        for (const e of fs.readdirSync(outDir, { recursive: true })) if (String(e).endsWith('.aux')) list.push(path.join(outDir, String(e)));
      } catch {
        /* ignore */
      }
      return hashFiles([...new Set(list)]);
    };

    const runTool = async (exe, a, cwd, label) => {
      if (job.cancelled) return { code: -2, stdout: '', stderr: '' };
      const remaining = deadline - Date.now();
      if (remaining <= 0) return { code: -3, stdout: '', stderr: 'timeout' };
      onLog(`\n$ ${label}\n`);
      const r = await run(exe, a, {
        cwd,
        env,
        timeout: remaining,
        onSpawn: (c) => (job.child = c),
        onData: (d) => onLog(d),
      });
      job.child = null;
      if (Date.now() >= deadline) r.timedOut = true;
      return r;
    };

    const runEngine = () => runTool(engineExe, args, root, `${engine} ${mainFile}`);

    let runs = 0;
    let logText = '';
    let parsed = { errors: [], warnings: [], typesetting: [], missing: [], rerun: false };
    let bibIssues = { errors: [], warnings: [], missing: [] };
    let auxBefore = auxWatch();
    let r = await runEngine();
    runs++;
    if (job.cancelled) return finish('stopped');
    if (r.timedOut) return finish('timeout');

    logText = readText(logPath);
    parsed = logparser.parse(logText, root);

    const missingNow = parsed.missing.filter((f) => !exists(path.join(root, f)));
    if (missingNow.length) {
      const resolved = await tex.resolvePackages(missingNow);
      return finish('missing', { missing: resolved });
    }

    // --- bibliography
    const auxText = readText(path.join(outDir, `${jobname}.aux`));
    const bcf = path.join(outDir, `${jobname}.bcf`);
    const bibFiles = (await walk(root)).filter((f) => f.rel.toLowerCase().endsWith('.bib')).map((f) => f.abs);
    const bibMtimes = bibFiles.map((f) => {
      try {
        return `${f}:${fs.statSync(f).mtimeMs}`;
      } catch {
        return f;
      }
    });
    let bibTool = null;
    if (exists(bcf) && (/\\abx@aux@/.test(auxText) || /biber/i.test(logText))) bibTool = /backend=bibtex/.test(logText) ? 'bibtex' : 'biber';
    else if (/\\bibdata\{/.test(auxText)) bibTool = 'bibtex';

    let needRerun = false;
    if (bibTool) {
      const citeKey =
        bibTool === 'biber'
          ? sha1((exists(bcf) ? readText(bcf).replace(/<bcf:controlfile[^>]*>/, '') : '') + bibMtimes.join('|'))
          : sha1(auxAllCitations(outDir) + bibMtimes.join('|'));
      const bbl = path.join(outDir, `${jobname}.bbl`);
      const asked = /Please \(re\)run (Biber|BibTeX)/i.test(logText);
      if (!exists(bbl) || state.citeKey !== citeKey || asked || opts.fromScratch) {
        const exe = tex.toolPath(bibTool);
        if (exe) {
          const br =
            bibTool === 'biber'
              ? await runTool(exe, [`--output-directory=${outDir}`, jobname], root, `biber ${jobname}`)
              : await runTool(exe, isMiktex && !opts.enableInstaller ? ['-disable-installer', jobname] : [jobname], outDir, `bibtex ${jobname}`);
          if (job.cancelled) return finish('stopped');
          const blg = readText(path.join(outDir, `${jobname}.blg`));
          bibIssues = logparser.parseBibLog(blg, bibTool);
          if (bibIssues.missing.length) {
            const resolved = await tex.resolvePackages(bibIssues.missing);
            return finish('missing', { missing: resolved });
          }
          if (br.code === 0 || exists(bbl)) state.citeKey = citeKey;
          needRerun = true;
        } else if (info.type === 'texlive') {
          // TeX Live ships biber/bibtex as installable packages of the same name.
          return finish('missing', { missing: [{ file: `${bibTool} (program)`, package: bibTool }] });
        } else {
          bibIssues.errors.push({ level: 'error', message: `${bibTool} is not installed, so the bibliography cannot be built.`, file: null, line: null });
        }
      }
    }

    // --- index, nomenclature and glossaries (makeindex only; no Perl needed)
    const mk = tex.toolPath('makeindex');
    if (mk) {
      const idxJobs = [
        { src: 'idx', args: [`${jobname}.idx`] },
        { src: 'nlo', args: [`${jobname}.nlo`, '-s', 'nomencl.ist', '-o', `${jobname}.nls`] },
      ];
      if (exists(path.join(outDir, `${jobname}.ist`))) {
        idxJobs.push({ src: 'glo', args: ['-s', `${jobname}.ist`, '-t', `${jobname}.glg`, '-o', `${jobname}.gls`, `${jobname}.glo`] });
        idxJobs.push({ src: 'acn', args: ['-s', `${jobname}.ist`, '-t', `${jobname}.alg`, '-o', `${jobname}.acr`, `${jobname}.acn`] });
      }
      state.idx = state.idx || {};
      for (const j of idxJobs) {
        const f = path.join(outDir, `${jobname}.${j.src}`);
        if (!exists(f)) continue;
        const h = hashFiles([f]);
        if (state.idx[j.src] === h && !opts.fromScratch) continue;
        await runTool(mk, j.args, outDir, `makeindex ${j.args.join(' ')}`);
        state.idx[j.src] = h;
        needRerun = true;
      }
    }

    // --- rerun until cross references settle
    let auxAfter = auxWatch();
    const maxRuns = 5;
    while (runs < maxRuns && (needRerun || auxAfter !== auxBefore || RERUN_RE.test(logText))) {
      if (job.cancelled) return finish('stopped');
      needRerun = false;
      auxBefore = auxAfter;
      r = await runEngine();
      runs++;
      if (job.cancelled) return finish('stopped');
      if (r.timedOut) return finish('timeout');
      logText = readText(logPath);
      auxAfter = auxWatch();
      // After a clean second pass, stop even if aux changed only because of page numbers settling.
      if (runs >= 3 && !RERUN_RE.test(logText)) break;
    }

    parsed = logparser.parse(logText, root);
    return finish(null);

    function finish(forced, extra = {}) {
      try {
        writeJSON(statePath, state);
      } catch {
        /* ignore */
      }
      const finalLog = readText(logPath);
      const p = forced === 'missing' ? parsed : logparser.parse(finalLog, root);
      const pdfExists = exists(pdfPath);
      const pdfUpdated = pdfExists && fs.statSync(pdfPath).mtimeMs > pdfBefore;
      let status = forced;
      if (!status) status = pdfUpdated ? 'success' : 'failure';
      const issues = {
        errors: [...p.errors, ...bibIssues.errors],
        warnings: [...p.warnings, ...bibIssues.warnings],
        typesetting: p.typesetting,
      };
      return {
        status,
        engine,
        runs,
        durationMs: Date.now() - started,
        pdfPath: pdfExists ? pdfPath : null,
        pdfUpdated,
        synctexPath: exists(path.join(outDir, `${jobname}.synctex.gz`)) ? path.join(outDir, `${jobname}.synctex.gz`) : null,
        outDir,
        jobname,
        log: finalLog,
        blg: readText(path.join(outDir, `${jobname}.blg`)),
        issues,
        ...extra,
      };
    }
  } finally {
    active.delete(project.id);
  }
}

function auxAllCitations(outDir) {
  let s = '';
  try {
    for (const e of fs.readdirSync(outDir, { recursive: true })) {
      if (!String(e).endsWith('.aux')) continue;
      const t = readText(path.join(outDir, String(e)));
      s += (t.match(/\\(citation|bibdata|bibstyle)\{[^}]*\}/g) || []).join('\n');
    }
  } catch {
    /* ignore */
  }
  return s;
}

function emptyIssues() {
  return { errors: [], warnings: [], typesetting: [] };
}

function stop(projectId) {
  const job = active.get(projectId);
  if (!job) return false;
  job.cancelled = true;
  if (job.child) killTree(job.child.pid);
  return true;
}

async function clean(projectId) {
  stop(projectId);
  await fsp.rm(paths.buildDir(projectId), { recursive: true, force: true });
  return true;
}

async function outputFiles(projectId) {
  const dir = paths.buildDir(projectId);
  if (!exists(dir)) return [];
  const out = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.isFile() && !e.name.startsWith('.')) out.push({ name: e.name, path: path.join(dir, e.name), size: fs.statSync(path.join(dir, e.name)).size });
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}

module.exports = { compile, stop, clean, outputFiles, isBusy: (id) => active.has(id) };
