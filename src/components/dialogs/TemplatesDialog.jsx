import { useMemo, useState } from 'react';
import { LayoutTemplate, FileArchive, FolderOpen, GraduationCap, Presentation, FileText, Newspaper, User, Mail, BookOpen, ClipboardList, Image, Sparkles } from 'lucide-react';
import { useStore } from '../../store';
import { call } from '../../lib/api';
import { toast, errorMessage } from '../../lib/ui';
import * as A from '../../actions';
import { Modal } from '../ui';

const CAT_STYLE = {
  Start: { color: ['#14b8a6', '#0d9488'], icon: Sparkles },
  Academic: { color: ['#6366f1', '#4338ca'], icon: Newspaper },
  Thesis: { color: ['#0ea5e9', '#0369a1'], icon: GraduationCap },
  Presentation: { color: ['#f97316', '#c2410c'], icon: Presentation },
  Poster: { color: ['#ec4899', '#be185d'], icon: Image },
  Report: { color: ['#22c55e', '#15803d'], icon: ClipboardList },
  CV: { color: ['#a855f7', '#7e22ce'], icon: User },
  Letter: { color: ['#64748b', '#334155'], icon: Mail },
  Book: { color: ['#eab308', '#a16207'], icon: BookOpen },
};

export function TemplateThumb({ t }) {
  const st = CAT_STYLE[t.category] || { color: ['#64748b', '#334155'], icon: FileText };
  const Icon = st.icon;
  return (
    <div className="tpl-thumb" style={{ background: `linear-gradient(135deg, ${st.color[0]}, ${st.color[1]})` }}>
      <Icon className="tpl-glyph" size={20} />
      <div className="tpl-paper">
        <i className="h" />
        <i />
        <i />
        <i style={{ width: '80%' }} />
        <i />
        <i style={{ width: '60%' }} />
      </div>
    </div>
  );
}

export default function TemplatesDialog({ onClose }) {
  const templates = useStore((s) => s.templates);
  const cats = useMemo(() => ['All', ...new Set(templates.map((t) => t.category))], [templates]);
  const [cat, setCat] = useState('All');
  const [sel, setSel] = useState(templates[0] ? templates[0].id : null);
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);

  const list = cat === 'All' ? templates : templates.filter((t) => t.category === cat);
  const selected = templates.find((t) => t.id === sel);

  const create = async (id = sel) => {
    const t = templates.find((x) => x.id === id);
    if (!t) return;
    setBusy(true);
    try {
      const p = await call('projects:create', { name: name.trim() || t.defaultName || t.name, templateId: t.id });
      onClose();
      await A.refreshProjects();
      await A.openProject(p.id);
    } catch (e) {
      toast('error', 'Could not create project', errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      title="New project"
      icon={<LayoutTemplate size={18} color="var(--accent)" />}
      size="xl"
      onClose={onClose}
      footer={
        <>
          <button className="btn btn-ghost" onClick={() => (onClose(), A.importZip())}>
            <FileArchive size={15} /> Upload ZIP
          </button>
          <button className="btn btn-ghost" onClick={() => (onClose(), A.importFolder())}>
            <FolderOpen size={15} /> Open folder
          </button>
          <span className="spacer" />
          <input className="input" style={{ width: 260 }} placeholder={selected ? `Project name (${selected.defaultName || selected.name})` : 'Project name'} value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && create()} />
          <button className="btn btn-primary" disabled={!selected || busy} onClick={() => create()}>
            Create project
          </button>
        </>
      }
    >
      <div className="tpl-layout">
        <div className="tpl-cats">
          {cats.map((c) => (
            <button key={c} className={`dash-nav ${cat === c ? 'active' : ''}`} onClick={() => setCat(c)}>
              {c}
              <span className="count">{c === 'All' ? templates.length : templates.filter((t) => t.category === c).length}</span>
            </button>
          ))}
        </div>
        <div className="tpl-grid">
          {list.map((t) => (
            <div key={t.id} className={`tpl-card ${sel === t.id ? 'selected' : ''}`} onClick={() => setSel(t.id)} onDoubleClick={() => create(t.id)}>
              <TemplateThumb t={t} />
              <div className="tpl-info">
                <div className="tpl-name">{t.name}</div>
                <div className="tpl-desc">{t.description}</div>
                <div className="row" style={{ marginTop: 8, gap: 5, flexWrap: 'wrap' }}>
                  <span className="pill">{{ pdflatex: 'pdfLaTeX', xelatex: 'XeLaTeX', lualatex: 'LuaLaTeX' }[t.compiler] || 'pdfLaTeX'}</span>
                  {t.bibliography && <span className="pill">{t.bibliography}</span>}
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </Modal>
  );
}
