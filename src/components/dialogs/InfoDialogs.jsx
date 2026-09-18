import { useEffect, useState } from 'react';
import { Hash, Keyboard, BookOpen, Loader2 } from 'lucide-react';
import { useStore } from '../../store';
import { call } from '../../lib/api';
import * as E from '../../editor/controller';
import { errorMessage } from '../../lib/ui';
import { Modal } from '../ui';

export function WordCountDialog({ onClose }) {
  const project = useStore((s) => s.project);
  const openPath = useStore((s) => s.openPath);
  const [scope, setScope] = useState('document');
  const [res, setRes] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    setRes(null);
    E.saveAll().then(() =>
      call('index:wordcount', project.id, scope === 'file' ? openPath : project.mainFile)
        .then(setRes)
        .catch((e) => setError(errorMessage(e))),
    );
  }, [scope]);

  return (
    <Modal title="Word count" icon={<Hash size={18} color="var(--accent)" />} size="sm" onClose={onClose} footer={<button className="btn btn-primary" onClick={onClose}>Close</button>}>
      <div className="segmented" style={{ marginBottom: 12 }}>
        <button className={scope === 'document' ? 'on' : ''} onClick={() => setScope('document')}>
          Whole document
        </button>
        <button className={scope === 'file' ? 'on' : ''} disabled={!openPath || !/\.tex$/i.test(openPath)} onClick={() => setScope('file')}>
          Current file
        </button>
      </div>
      {error && <p style={{ color: 'var(--danger)' }}>{error}</p>}
      {!res && !error && (
        <div className="row muted">
          <Loader2 size={15} className="spin" /> Counting...
        </div>
      )}
      {res && (
        <>
          <table className="stats">
            <tbody>
              <tr className="total">
                <td>Total words</td>
                <td>{res.total.toLocaleString()}</td>
              </tr>
              <tr>
                <td>Words in text</td>
                <td>{res.textWords.toLocaleString()}</td>
              </tr>
              <tr>
                <td>Words in headings</td>
                <td>{res.headerWords.toLocaleString()}</td>
              </tr>
              <tr>
                <td>Words in captions and footnotes</td>
                <td>{res.captionWords.toLocaleString()}</td>
              </tr>
              <tr>
                <td>Headings</td>
                <td>{res.headers}</td>
              </tr>
              <tr>
                <td>Figures and tables</td>
                <td>{res.floats}</td>
              </tr>
              <tr>
                <td>Inline maths</td>
                <td>{res.inlineMath}</td>
              </tr>
              <tr>
                <td>Displayed maths</td>
                <td>{res.displayMath}</td>
              </tr>
              <tr>
                <td>Characters (no spaces)</td>
                <td>{res.characters.toLocaleString()}</td>
              </tr>
            </tbody>
          </table>
          <p className="faint" style={{ fontSize: 11.5, marginBottom: 0 }}>
            Counted from {res.files.length} file{res.files.length === 1 ? '' : 's'}: {res.files.join(', ')}. Commands, comments, maths and the preamble are not counted as words.
          </p>
        </>
      )}
    </Modal>
  );
}

const SHORTCUTS = [
  ['Compiling', [['Recompile', 'Ctrl+Enter'], ['Save and recompile', 'Ctrl+S'], ['Show logs', 'Ctrl+J'], ['Go to location in PDF', 'Ctrl+Alt+Right'], ['Go to code from PDF', 'Double-click the PDF']]],
  [
    'Editing',
    [
      ['Bold / Italic', 'Ctrl+B / Ctrl+I'],
      ['Inline maths', 'Ctrl+Shift+M'],
      ['Toggle comment', 'Ctrl+/'],
      ['Autocomplete', 'Ctrl+Space'],
      ['Next placeholder', 'Tab'],
      ['Add review comment', 'Ctrl+Shift+C'],
      ['Undo / Redo', 'Ctrl+Z / Ctrl+Y'],
      ['Select next occurrence', 'Ctrl+D'],
      ['Move line up / down', 'Alt+Up / Alt+Down'],
      ['Copy line up / down', 'Shift+Alt+Up / Down'],
      ['Delete line', 'Ctrl+Shift+K'],
      ['Fold / unfold', 'Ctrl+Shift+[ / ]'],
    ],
  ],
  ['Search', [['Find and replace', 'Ctrl+F'], ['Find next / previous', 'F3 / Shift+F3'], ['Search in project', 'Ctrl+Shift+F'], ['Go to line', 'Ctrl+Alt+G']]],
  [
    'Window',
    [
      ['New project', 'Ctrl+Shift+N'],
      ['All projects', 'Ctrl+O'],
      ['Settings', 'Ctrl+,'],
      ['Toggle file tree', 'Ctrl+Shift+E'],
      ['History', 'Ctrl+Shift+H'],
      ['Word count', 'Ctrl+Shift+W'],
      ['Light / dark theme', 'Ctrl+Shift+L'],
      ['Zoom in / out / reset', 'Ctrl+= / Ctrl+- / Ctrl+0'],
      ['Full screen', 'F11'],
      ['LaTeX quick reference', 'F1'],
    ],
  ],
];

export function ShortcutsDialog({ onClose }) {
  return (
    <Modal title="Keyboard shortcuts" icon={<Keyboard size={18} color="var(--accent)" />} size="lg" onClose={onClose}>
      <div className="ref-grid">
        {SHORTCUTS.map(([group, list]) => (
          <div key={group}>
            <div className="settings-group-title" style={{ marginBottom: 4 }}>
              {group}
            </div>
            <table className="shortcut-table">
              <tbody>
                {list.map(([a, k]) => (
                  <tr key={a}>
                    <td>{a}</td>
                    <td>
                      {k.split(' / ').map((part, i) => (
                        <span key={i}>
                          {i > 0 && ' / '}
                          <kbd>{part}</kbd>
                        </span>
                      ))}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ))}
      </div>
    </Modal>
  );
}

const REF = [
  ['Document structure', '\\documentclass{article}\n\\usepackage{amsmath}\n\\title{Title}\n\\author{Name}\n\\begin{document}\n\\maketitle\n\\section{Introduction}\n\\subsection{Background}\n\\end{document}'],
  ['Text formatting', '\\textbf{bold}  \\textit{italic}\n\\underline{underline}  \\emph{emphasis}\n\\texttt{monospace}  \\textsc{Small Caps}\n{\\large bigger}  {\\small smaller}\n\\footnote{A footnote}'],
  ['Lists', '\\begin{itemize}\n  \\item First point\n  \\item Second point\n\\end{itemize}\n\n\\begin{enumerate}\n  \\item Step one\n\\end{enumerate}'],
  ['Maths', 'Inline: $E = mc^2$\nDisplay: \\[ \\int_0^1 x^2\\,dx \\]\n\\begin{equation}\n  a^2 + b^2 = c^2 \\label{eq:pyth}\n\\end{equation}\n\\frac{a}{b}  \\sqrt{x}  x_i^2  \\sum_{i=1}^{n}'],
  ['Figures', '\\usepackage{graphicx}\n\\begin{figure}[htbp]\n  \\centering\n  \\includegraphics[width=0.8\\textwidth]{image}\n  \\caption{A caption}\n  \\label{fig:image}\n\\end{figure}'],
  ['Tables', '\\begin{table}[htbp]\n  \\centering\n  \\begin{tabular}{l c r}\n    \\hline\n    A & B & C \\\\\n    1 & 2 & 3 \\\\\n    \\hline\n  \\end{tabular}\n  \\caption{A table}\n\\end{table}'],
  ['References', 'See Figure~\\ref{fig:image} on page~\\pageref{fig:image}.\nEquation~\\eqref{eq:pyth}\n\\usepackage{hyperref}  % clickable links\n\\href{https://mmu.edu.my}{MMU website}'],
  ['Citations (BibTeX)', '\\cite{key}  \\citep{key}  \\citet{key}\n\\bibliographystyle{plain}\n\\bibliography{references}\n\n% biblatex alternative:\n\\usepackage[backend=biber]{biblatex}\n\\addbibresource{references.bib}\n\\printbibliography'],
  ['Special characters', '\\%  \\$  \\&  \\#  \\_  \\{  \\}\n\\textbackslash  ~ (non-breaking space)\n`` quotes \'\'  --  (en dash)\n\\ldots (ellipsis)'],
  ['Page layout', '\\usepackage[margin=2.5cm]{geometry}\n\\usepackage{setspace} \\onehalfspacing\n\\newpage  \\clearpage\n\\tableofcontents\n\\listoffigures  \\listoftables'],
];

export function QuickRefDialog({ onClose }) {
  return (
    <Modal title="LaTeX quick reference" icon={<BookOpen size={18} color="var(--accent)" />} size="xl" onClose={onClose}>
      <div className="ref-grid" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))' }}>
        {REF.map(([title, code]) => (
          <div key={title} className="ref-card">
            <h3>{title}</h3>
            <pre>{code}</pre>
          </div>
        ))}
      </div>
    </Modal>
  );
}
