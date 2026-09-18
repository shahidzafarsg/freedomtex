import { useEffect, useState } from 'react';
import { GraduationCap, Heart, Scale, Info, Code2, Globe } from 'lucide-react';
import { useStore } from '../../store';
import { call } from '../../lib/api';
import { Modal } from '../ui';
import logo from '../../assets/logo.svg';

// Lucide no longer ships brand icons, so draw the GitHub mark here.
function Github({ size = 16 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M12 .5a11.5 11.5 0 0 0-3.64 22.41c.58.1.79-.25.79-.56v-2c-3.2.7-3.88-1.37-3.88-1.37-.52-1.33-1.28-1.69-1.28-1.69-1.05-.72.08-.7.08-.7 1.16.08 1.77 1.19 1.77 1.19 1.03 1.77 2.7 1.26 3.36.96.1-.75.4-1.26.73-1.55-2.55-.29-5.24-1.28-5.24-5.7 0-1.26.45-2.29 1.19-3.1-.12-.29-.52-1.46.11-3.05 0 0 .97-.31 3.17 1.18a11 11 0 0 1 5.78 0c2.2-1.49 3.17-1.18 3.17-1.18.63 1.59.23 2.76.11 3.05.74.81 1.19 1.84 1.19 3.1 0 4.43-2.7 5.4-5.26 5.69.41.36.78 1.06.78 2.14v3.17c0 .31.21.67.8.56A11.5 11.5 0 0 0 12 .5Z" />
    </svg>
  );
}

export const REPO_URL = 'https://github.com/shahidzafarsg/freedomtex';
export const WEBSITE_URL = 'https://freedomsoft.uk';
const PROFILE_URL = 'https://github.com/shahidzafarsg';

export default function AboutDialog({ tab: initial, onClose }) {
  const info = useStore((s) => s.info);
  const tex = useStore((s) => s.tex);
  const [tab, setTab] = useState(initial || 'about');
  const [text, setText] = useState({});

  useEffect(() => {
    if ((tab === 'license' || tab === 'notices') && !text[tab]) {
      call('app:readResource', tab)
        .then((t) => setText((x) => ({ ...x, [tab]: t })))
        .catch(() => setText((x) => ({ ...x, [tab]: 'Could not load this document.' })));
    }
  }, [tab]);

  return (
    <Modal size="lg" onClose={onClose} noPadding title={null}>
      <div className="about-hero">
        <img src={logo} alt="" />
        <h1>FreedomTex</h1>
        <div className="muted">A free LaTeX editor for everyone · Version {info ? info.version : ''}</div>
      </div>
      <div style={{ padding: '0 22px' }}>
        <div className="tab-strip">
          {[
            ['about', 'About', <Info size={14} key="i" />],
            ['developer', 'Developer', <GraduationCap size={14} key="g" />],
            ['license', 'License', <Scale size={14} key="s" />],
            ['notices', 'Third-party notices', <Code2 size={14} key="c" />],
          ].map(([k, l, icon]) => (
            <button key={k} className={tab === k ? 'on' : ''} onClick={() => setTab(k)}>
              <span className="row" style={{ gap: 6 }}>
                {icon}
                {l}
              </span>
            </button>
          ))}
        </div>
      </div>
      <div style={{ padding: '0 22px 20px', maxHeight: '52vh', overflow: 'auto' }} className="selectable">
        {tab === 'about' && (
          <>
            <p style={{ fontSize: 13.5, lineHeight: 1.6 }}>
              FreedomTex is a free and open-source LaTeX editor that runs entirely on your own computer. It gives you a live PDF preview, templates, smart autocomplete, a visual editor, comments, version history and automatic
              installation of missing packages, all without a subscription or an internet connection.
            </p>
            <div className="about-card">
              <div className="avatar" style={{ background: 'linear-gradient(135deg,#f43f5e,#f59e0b)' }}>
                <Heart size={20} />
              </div>
              <div>
                <div style={{ fontWeight: 700 }}>Dedicated to the students of Multimedia University (MMU), Malaysia</div>
                <div className="muted">Created to give students relief from paying for LaTeX subscriptions. Free to use, share and improve.</div>
              </div>
            </div>
            <div className="about-card">
              <div className="avatar">SZ</div>
              <div className="grow">
                <div style={{ fontWeight: 700 }}>Developed by Shahid Zafar</div>
                <div className="muted">PhD Candidate, Multimedia University, Malaysia</div>
              </div>
              <div className="col" style={{ gap: 6 }}>
                <button className="btn btn-sm" onClick={() => call('app:openExternal', WEBSITE_URL)}>
                  <Globe size={14} /> freedomsoft.uk
                </button>
                <button className="btn btn-sm" onClick={() => call('app:openExternal', REPO_URL)}>
                  <Github size={14} /> Source code
                </button>
              </div>
            </div>
            <table className="stats" style={{ marginTop: 6 }}>
              <tbody>
                <tr>
                  <td className="muted">FreedomTex</td>
                  <td>{info && info.version}</td>
                </tr>
                <tr>
                  <td className="muted">LaTeX engine</td>
                  <td>{tex && tex.found ? tex.version : 'Not installed'}</td>
                </tr>
                <tr>
                  <td className="muted">Electron / Chromium / Node.js</td>
                  <td>{info && `${info.electron} / ${info.chrome} / ${info.node}`}</td>
                </tr>
                <tr>
                  <td className="muted">License</td>
                  <td>MIT (open source)</td>
                </tr>
                <tr>
                  <td className="muted">Website</td>
                  <td>
                    <a href="#" onClick={(e) => (e.preventDefault(), call('app:openExternal', WEBSITE_URL))}>
                      freedomsoft.uk
                    </a>
                  </td>
                </tr>
              </tbody>
            </table>
            <p className="muted" style={{ fontSize: 12, marginTop: 14 }}>
              Built with Electron, React, CodeMirror, PDF.js, KaTeX and Lucide icons. LaTeX typesetting is provided by MiKTeX. See Third-party notices for details.
            </p>
          </>
        )}
        {tab === 'developer' && (
          <>
            <div className="about-card" style={{ padding: 18 }}>
              <div className="avatar" style={{ width: 64, height: 64, fontSize: 22 }}>
                SZ
              </div>
              <div className="grow">
                <div style={{ fontWeight: 750, fontSize: 18 }}>Shahid Zafar</div>
                <div className="muted">PhD Candidate</div>
                <div className="muted">Multimedia University (MMU), Malaysia</div>
              </div>
            </div>
            <p style={{ lineHeight: 1.65, fontSize: 13.5 }}>
              I built FreedomTex because LaTeX is essential for research writing, theses and reports, yet many students end up paying for online subscriptions to use it comfortably. FreedomTex brings those features to your
              own computer for free.
            </p>
            <p style={{ lineHeight: 1.65, fontSize: 13.5 }}>
              FreedomTex is dedicated to the students of Multimedia University, Malaysia. It is open source so that anyone can use it, learn from it and help improve it.
            </p>
            <div className="row" style={{ flexWrap: 'wrap' }}>
              <button className="btn" onClick={() => call('app:openExternal', WEBSITE_URL)}>
                <Globe size={15} /> freedomsoft.uk
              </button>
              <button className="btn" onClick={() => call('app:openExternal', PROFILE_URL)}>
                <Github size={15} /> github.com/shahidzafarsg
              </button>
              <button className="btn" onClick={() => call('app:openExternal', REPO_URL)}>
                <Code2 size={15} /> FreedomTex repository
              </button>
            </div>
          </>
        )}
        {(tab === 'license' || tab === 'notices') && <pre className="raw-log" style={{ maxHeight: 'none' }}>{text[tab] || 'Loading...'}</pre>}
      </div>
      <div className="modal-footer">
        <span className="faint" style={{ fontSize: 12, marginRight: 'auto' }}>
          Copyright © 2026 Shahid Zafar
        </span>
        <button className="btn btn-primary" onClick={onClose}>
          Close
        </button>
      </div>
    </Modal>
  );
}
