import { useMemo, useState } from 'react';
import {
  Plus,
  Search,
  FolderOpen,
  FileArchive,
  Archive,
  Trash2,
  Copy,
  Download,
  Tag,
  Layers,
  Clock,
  RotateCcw,
  Settings,
  Info,
  FilePlus2,
  LayoutTemplate,
  BookOpen,
  ArrowUpDown,
  Pencil,
  AlertTriangle,
  MoreHorizontal,
  X,
} from 'lucide-react';
import { useStore } from '../store';
import { call } from '../lib/api';
import { openDialog, prompt, confirm, toast, formatDate, errorMessage } from '../lib/ui';
import * as A from '../actions';
import { Menu } from './ui';
import logo from '../assets/logo.svg';

export default function Dashboard() {
  const projects = useStore((s) => s.projects);
  const tags = useStore((s) => s.tags);
  const tex = useStore((s) => s.tex);
  const [filter, setFilter] = useState('all'); // all | recent | archived | trashed | tag:<id>
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState({ key: 'lastOpened', dir: -1 });
  const [menu, setMenu] = useState(null);

  const visible = useMemo(() => {
    let list = projects.filter((p) => {
      if (filter === 'trashed') return p.trashed;
      if (p.trashed) return false;
      if (filter === 'archived') return p.archived;
      if (p.archived) return false;
      if (filter.startsWith('tag:')) return (p.tags || []).includes(filter.slice(4));
      return true;
    });
    if (filter === 'recent') list = list.filter((p) => Date.now() - (p.lastOpened || 0) < 14 * 86400000);
    if (query.trim()) {
      const q = query.toLowerCase();
      list = list.filter((p) => p.name.toLowerCase().includes(q) || p.path.toLowerCase().includes(q));
    }
    return [...list].sort((a, b) => {
      const va = a[sort.key] ?? '';
      const vb = b[sort.key] ?? '';
      return (typeof va === 'string' ? va.localeCompare(vb) : va - vb) * sort.dir;
    });
  }, [projects, filter, query, sort]);

  const counts = useMemo(
    () => ({
      all: projects.filter((p) => !p.trashed && !p.archived).length,
      archived: projects.filter((p) => p.archived && !p.trashed).length,
      trashed: projects.filter((p) => p.trashed).length,
    }),
    [projects],
  );

  const title =
    filter === 'all' ? 'All Projects' : filter === 'recent' ? 'Recent' : filter === 'archived' ? 'Archived' : filter === 'trashed' ? 'Trash' : tags.find((t) => `tag:${t.id}` === filter)?.name || 'Projects';

  const update = async (p, patch) => {
    await call('projects:update', p.id, patch);
    A.refreshProjects();
  };

  const rename = async (p) => {
    const name = await prompt({ title: 'Rename project', label: 'Project name', value: p.name, okLabel: 'Rename' });
    if (name && name !== p.name) update(p, { name });
  };

  const duplicate = async (p) => {
    const name = await prompt({ title: 'Copy project', label: 'Name for the copy', value: `${p.name} (Copy)`, okLabel: 'Copy' });
    if (!name) return;
    try {
      await call('projects:duplicate', p.id, name);
      A.refreshProjects();
      toast('success', 'Project copied', name);
    } catch (e) {
      toast('error', 'Could not copy project', errorMessage(e));
    }
  };

  const deleteForever = async (p) => {
    const ok = await confirm({
      title: 'Delete project permanently',
      message: p.managed
        ? `"${p.name}" will be removed from FreedomTex and its folder moved to the Windows Recycle Bin.`
        : `"${p.name}" will be removed from FreedomTex. Its folder is not deleted:\n${p.path}`,
      okLabel: 'Delete',
      danger: true,
    });
    if (!ok) return;
    await call('projects:deleteForever', p.id);
    A.refreshProjects();
  };

  const newTag = async () => {
    const name = await prompt({ title: 'New tag', label: 'Tag name', placeholder: 'e.g. Semester 1', okLabel: 'Create' });
    if (!name) return;
    await call('tags:create', name);
    A.refreshProjects();
  };

  const tagMenu = (p, rect) => ({
    anchor: rect,
    items: [
      ...(tags.length
        ? tags.map((t) => ({
            label: t.name,
            checked: (p.tags || []).includes(t.id),
            onClick: () => update(p, { tags: (p.tags || []).includes(t.id) ? p.tags.filter((x) => x !== t.id) : [...(p.tags || []), t.id] }),
          }))
        : [{ label: 'No tags yet', disabled: true }]),
      { separator: true },
      { label: 'New Tag...', icon: <Plus size={14} />, onClick: newTag },
    ],
  });

  const rowMenu = (p, rect) => ({
    anchor: rect,
    align: 'right',
    items: [
      { label: 'Open', icon: <FolderOpen size={14} />, onClick: () => A.openProject(p.id) },
      { label: 'Rename...', icon: <Pencil size={14} />, onClick: () => rename(p) },
      { label: 'Make a Copy...', icon: <Copy size={14} />, onClick: () => duplicate(p) },
      { label: 'Download Source (ZIP)...', icon: <Download size={14} />, onClick: () => A.exportZip(p.id) },
      { label: 'Show in Explorer', icon: <FolderOpen size={14} />, onClick: () => call('app:openPath', p.path) },
      { separator: true },
      { label: 'Tags', icon: <Tag size={14} />, items: tagMenu(p).items },
      { separator: true },
      p.archived ? { label: 'Unarchive', icon: <RotateCcw size={14} />, onClick: () => update(p, { archived: false }) } : { label: 'Archive', icon: <Archive size={14} />, onClick: () => update(p, { archived: true }) },
      p.trashed
        ? { label: 'Restore', icon: <RotateCcw size={14} />, onClick: () => update(p, { trashed: false }) }
        : { label: 'Move to Trash', icon: <Trash2 size={14} />, onClick: () => update(p, { trashed: true }) },
      ...(p.trashed ? [{ label: 'Delete Permanently...', icon: <Trash2 size={14} />, onClick: () => deleteForever(p) }] : []),
    ],
  });

  const newMenu = (rect) => ({
    anchor: rect,
    items: [
      { label: 'Blank Project', icon: <FilePlus2 size={14} />, onClick: () => A.createProject('blank') },
      { label: 'Example Project', icon: <BookOpen size={14} />, onClick: () => A.createProject('example', 'Example Project') },
      { label: 'From a Template...', icon: <LayoutTemplate size={14} />, onClick: () => openDialog('templates') },
      { separator: true },
      { label: 'Upload Project (ZIP)...', icon: <FileArchive size={14} />, onClick: () => A.importZip() },
      { label: 'Open Folder as Project...', icon: <FolderOpen size={14} />, onClick: () => A.importFolder() },
    ],
  });

  const toggleSort = (key) => setSort((s) => ({ key, dir: s.key === key ? -s.dir : key === 'name' ? 1 : -1 }));
  const tagById = (id) => tags.find((t) => t.id === id);

  return (
    <div className="dash">
      <aside className="dash-side">
        <button className="btn btn-primary btn-lg btn-block" style={{ marginBottom: 12 }} onClick={(e) => setMenu(newMenu(e.currentTarget.getBoundingClientRect()))}>
          <Plus size={17} /> New Project
        </button>
        <NavItem icon={<Layers size={16} />} label="All Projects" count={counts.all} active={filter === 'all'} onClick={() => setFilter('all')} />
        <NavItem icon={<Clock size={16} />} label="Recent" active={filter === 'recent'} onClick={() => setFilter('recent')} />
        <NavItem icon={<Archive size={16} />} label="Archived" count={counts.archived || null} active={filter === 'archived'} onClick={() => setFilter('archived')} />
        <NavItem icon={<Trash2 size={16} />} label="Trash" count={counts.trashed || null} active={filter === 'trashed'} onClick={() => setFilter('trashed')} />

        <div className="dash-section-title">
          <span>Tags</span>
          <button className="icon-btn sm" title="New tag" onClick={newTag}>
            <Plus size={14} />
          </button>
        </div>
        {tags.length === 0 && <div className="faint" style={{ padding: '2px 10px', fontSize: 12 }}>Group projects with tags, such as a course name.</div>}
        {tags.map((t) => (
          <NavItem
            key={t.id}
            icon={<span className="tag-dot" style={{ background: t.color }} />}
            label={t.name}
            count={projects.filter((p) => !p.trashed && (p.tags || []).includes(t.id)).length || null}
            active={filter === `tag:${t.id}`}
            onClick={() => setFilter(`tag:${t.id}`)}
            onContext={(e) =>
              setMenu({
                at: { x: e.clientX, y: e.clientY },
                items: [
                  {
                    label: 'Rename Tag...',
                    onClick: async () => {
                      const name = await prompt({ title: 'Rename tag', label: 'Tag name', value: t.name, okLabel: 'Rename' });
                      if (name) call('tags:update', t.id, { name }).then(A.refreshProjects);
                    },
                  },
                  {
                    label: 'Delete Tag',
                    onClick: () => call('tags:delete', t.id).then(() => {
                      if (filter === `tag:${t.id}`) setFilter('all');
                      A.refreshProjects();
                    }),
                  },
                ],
              })
            }
          />
        ))}

        <div className="spacer" />
        <div className="dash-section-title">
          <span>LaTeX engine</span>
        </div>
        <button className="dash-nav" onClick={() => openDialog('tex')}>
          <span className={`sb-dot ${tex && tex.found ? '' : 'err'}`} />
          <span className="ellipsis">{tex && tex.found ? tex.version : 'Not installed'}</span>
        </button>
        <button className="dash-nav" onClick={() => openDialog('settings')}>
          <Settings size={16} /> Settings
        </button>
        <button className="dash-nav" onClick={() => openDialog('about')}>
          <Info size={16} /> About FreedomTex
        </button>
      </aside>

      <main className="dash-main">
        <div className="dash-header">
          <h1>{title}</h1>
          <span className="spacer" />
          <div className="input-icon" style={{ width: 300 }}>
            <Search size={15} />
            <input className="input" placeholder="Search projects..." value={query} onChange={(e) => setQuery(e.target.value)} />
          </div>
        </div>
        <div className="dash-body">
          {projects.filter((p) => !p.trashed).length === 0 && filter === 'all' ? (
            <Welcome />
          ) : visible.length === 0 ? (
            <div className="empty-note" style={{ paddingTop: 60 }}>
              {query ? 'No projects match your search.' : filter === 'trashed' ? 'Trash is empty.' : filter === 'archived' ? 'No archived projects.' : 'No projects here yet.'}
            </div>
          ) : (
            <table className="proj-table">
              <thead>
                <tr>
                  <th className="sortable" onClick={() => toggleSort('name')}>
                    Title <ArrowUpDown size={11} />
                  </th>
                  <th>Compiler</th>
                  <th className="sortable" onClick={() => toggleSort('updatedAt')}>
                    Last Modified <ArrowUpDown size={11} />
                  </th>
                  <th className="sortable" onClick={() => toggleSort('lastOpened')}>
                    Last Opened <ArrowUpDown size={11} />
                  </th>
                  <th style={{ width: 170 }} />
                </tr>
              </thead>
              <tbody>
                {visible.map((p) => (
                  <tr
                    key={p.id}
                    className="proj-row"
                    onDoubleClick={() => !p.trashed && !p.missing && A.openProject(p.id)}
                    onClick={(e) => {
                      if (e.target.closest('button')) return;
                      if (!p.trashed && !p.missing) A.openProject(p.id);
                    }}
                    onContextMenu={(e) => {
                      e.preventDefault();
                      setMenu({ ...rowMenu(p), anchor: null, at: { x: e.clientX, y: e.clientY } });
                    }}
                  >
                    <td>
                      <div className="proj-name">
                        {p.missing && <AlertTriangle size={14} color="var(--warning)" title="Folder not found" />}
                        <span>{p.name}</span>
                        {(p.tags || []).map((id) => {
                          const t = tagById(id);
                          return t ? (
                            <span key={id} className="tag-chip" style={{ color: t.color, borderColor: t.color + '66', background: t.color + '14' }}>
                              {t.name}
                            </span>
                          ) : null;
                        })}
                      </div>
                      <div className="proj-path ellipsis" title={p.path}>
                        {p.missing ? 'Folder not found: ' : ''}
                        {p.path}
                      </div>
                    </td>
                    <td className="muted">{{ pdflatex: 'pdfLaTeX', xelatex: 'XeLaTeX', lualatex: 'LuaLaTeX' }[p.compiler] || p.compiler}</td>
                    <td className="muted">{formatDate(p.updatedAt)}</td>
                    <td className="muted">{formatDate(p.lastOpened)}</td>
                    <td>
                      <div className="proj-actions">
                        {!p.trashed && (
                          <>
                            <button className="icon-btn sm" title="Make a copy" onClick={() => duplicate(p)}>
                              <Copy size={15} />
                            </button>
                            <button className="icon-btn sm" title="Download source (ZIP)" onClick={() => A.exportZip(p.id)}>
                              <Download size={15} />
                            </button>
                            <button className="icon-btn sm" title={p.archived ? 'Unarchive' : 'Archive'} onClick={() => update(p, { archived: !p.archived })}>
                              {p.archived ? <RotateCcw size={15} /> : <Archive size={15} />}
                            </button>
                            <button className="icon-btn sm" title="Move to trash" onClick={() => update(p, { trashed: true })}>
                              <Trash2 size={15} />
                            </button>
                          </>
                        )}
                        {p.trashed && (
                          <>
                            <button className="icon-btn sm" title="Restore" onClick={() => update(p, { trashed: false })}>
                              <RotateCcw size={15} />
                            </button>
                            <button className="icon-btn sm" title="Delete permanently" onClick={() => deleteForever(p)}>
                              <X size={15} />
                            </button>
                          </>
                        )}
                        <button className="icon-btn sm" title="More" onClick={(e) => setMenu(rowMenu(p, e.currentTarget.getBoundingClientRect()))}>
                          <MoreHorizontal size={15} />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </main>
      {menu && <Menu items={menu.items} anchor={menu.anchor} at={menu.at} align={menu.align} onClose={() => setMenu(null)} />}
    </div>
  );
}

function NavItem({ icon, label, count, active, onClick, onContext }) {
  return (
    <button
      className={`dash-nav ${active ? 'active' : ''}`}
      onClick={onClick}
      onContextMenu={(e) => {
        if (onContext) {
          e.preventDefault();
          onContext(e);
        }
      }}
    >
      {icon}
      <span className="ellipsis">{label}</span>
      {count != null && <span className="count">{count}</span>}
    </button>
  );
}

function Welcome() {
  const cards = [
    { icon: <FilePlus2 size={17} />, title: 'Blank project', desc: 'Start from an empty article.', run: () => A.createProject('blank') },
    { icon: <BookOpen size={17} />, title: 'Example project', desc: 'See sections, maths, figures and references.', run: () => A.createProject('example', 'Example Project') },
    { icon: <LayoutTemplate size={17} />, title: 'Templates', desc: 'Thesis, IEEE paper, slides, poster, CV and more.', run: () => openDialog('templates') },
    { icon: <FileArchive size={17} />, title: 'Upload a ZIP', desc: 'Import a project exported from another editor.', run: () => A.importZip() },
    { icon: <FolderOpen size={17} />, title: 'Open a folder', desc: 'Work on LaTeX files already on this PC.', run: () => A.importFolder() },
  ];
  return (
    <div className="welcome">
      <div className="welcome-hero">
        <img src={logo} alt="" width="64" height="64" />
        <h2>Welcome to FreedomTex</h2>
        <p>Write LaTeX documents on your own computer, for free, with no subscription and no internet needed. Create your first project to get started.</p>
        <button className="btn btn-primary btn-lg" onClick={() => openDialog('templates')}>
          <LayoutTemplate size={17} /> Browse templates
        </button>
      </div>
      <div className="quick-grid">
        {cards.map((c) => (
          <div key={c.title} className="quick-card" onClick={c.run}>
            <div className="qc-icon">{c.icon}</div>
            <div className="qc-title">{c.title}</div>
            <div className="qc-desc">{c.desc}</div>
          </div>
        ))}
      </div>
    </div>
  );
}
