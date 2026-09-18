import { useState } from 'react';
import { useStore } from '../../store';
import { closeDialog } from '../../lib/ui';
import { Modal } from '../ui';
import TemplatesDialog from './TemplatesDialog';
import SettingsDialog from './SettingsDialog';
import AboutDialog from './AboutDialog';
import { PackagesDialog, CheckPackagesDialog, InstallPackageDialog, TexDialog, PackageDocsDialog } from './TexDialogs';
import { FigureDialog, TableDialog } from './InsertDialogs';
import { WordCountDialog, ShortcutsDialog, QuickRefDialog } from './InfoDialogs';
import GitDialog from './GitDialog';
import ZoteroDialog from './ZoteroDialog';

const REGISTRY = {
  prompt: PromptDialog,
  confirm: ConfirmDialog,
  newProject: TemplatesDialog,
  templates: TemplatesDialog,
  settings: SettingsDialog,
  about: AboutDialog,
  packages: PackagesDialog,
  checkPackages: CheckPackagesDialog,
  installPackage: InstallPackageDialog,
  tex: TexDialog,
  packageDocs: PackageDocsDialog,
  figure: FigureDialog,
  table: TableDialog,
  wordCount: WordCountDialog,
  shortcuts: ShortcutsDialog,
  quickRef: QuickRefDialog,
  git: GitDialog,
  zotero: ZoteroDialog,
};

export default function DialogHost() {
  const dialogs = useStore((s) => s.dialogs);
  return dialogs.map((d) => {
    const C = REGISTRY[d.type];
    if (!C) return null;
    return <C key={d.id} {...d.props} onClose={() => closeDialog(d.id)} />;
  });
}

function PromptDialog({ title, label, value, placeholder, okLabel, validate, resolve, onClose }) {
  const [v, setV] = useState(value || '');
  const [err, setErr] = useState(null);
  const submit = () => {
    const e = validate ? validate(v) : !v.trim() ? 'Please enter a value.' : null;
    if (e) return setErr(e);
    resolve(v.trim());
    onClose();
  };
  const cancel = () => {
    resolve(null);
    onClose();
  };
  return (
    <Modal
      title={title}
      size="sm"
      onClose={cancel}
      footer={
        <>
          <button className="btn" onClick={cancel}>
            Cancel
          </button>
          <button className="btn btn-primary" onClick={submit}>
            {okLabel}
          </button>
        </>
      }
    >
      <div className="field">
        {label && <label>{label}</label>}
        <input
          className="input"
          autoFocus
          value={v}
          placeholder={placeholder}
          onFocus={(e) => {
            // Select the name without the extension, like Explorer does.
            const dot = e.target.value.lastIndexOf('.');
            e.target.setSelectionRange(0, dot > 0 ? dot : e.target.value.length);
          }}
          onChange={(e) => {
            setV(e.target.value);
            setErr(null);
          }}
          onKeyDown={(e) => e.key === 'Enter' && submit()}
        />
        {err && <div className="hint" style={{ color: 'var(--danger)' }}>{err}</div>}
      </div>
    </Modal>
  );
}

function ConfirmDialog({ title, message, okLabel, danger, resolve, onClose }) {
  const done = (r) => {
    resolve(r);
    onClose();
  };
  return (
    <Modal
      title={title}
      size="sm"
      onClose={() => done(false)}
      footer={
        <>
          <button className="btn" onClick={() => done(false)}>
            Cancel
          </button>
          <button className={`btn ${danger ? 'btn-danger' : 'btn-primary'}`} autoFocus onClick={() => done(true)}>
            {okLabel}
          </button>
        </>
      }
    >
      <p style={{ margin: '4px 0', whiteSpace: 'pre-wrap', color: 'var(--text-muted)' }}>{message}</p>
    </Modal>
  );
}
