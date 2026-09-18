// Autocomplete vocabulary. "#" marks the cursor, "#1".."#9" are tab stops.
const groups = {
  Structure: `documentclass[#1]{#2}|usepackage{#}|usepackage[#1]{#2}|begin{#}|end{#}|part{#}|chapter{#}|chapter*{#}|section{#}|section*{#}|subsection{#}|subsection*{#}|subsubsection{#}|subsubsection*{#}|paragraph{#}|subparagraph{#}|appendix|maketitle|title{#}|author{#}|date{#}|date{\\today}|today|thanks{#}|and|tableofcontents|listoffigures|listoftables|input{#}|include{#}|includeonly{#}|frontmatter|mainmatter|backmatter|abstractname|newpage|clearpage|cleardoublepage|pagebreak|linebreak|nopagebreak|pagenumbering{#}|pagestyle{#}|thispagestyle{#}|markboth{#1}{#2}|markright{#}`,
  Text: `textbf{#}|textit{#}|emph{#}|underline{#}|texttt{#}|textsc{#}|textsf{#}|textrm{#}|textsl{#}|textup{#}|textmd{#}|textnormal{#}|textsuperscript{#}|textsubscript{#}|textcolor{#1}{#2}|colorbox{#1}{#2}|fcolorbox{#1}{#2}{#3}|color{#}|highlight{#}|hl{#}|sout{#}|uline{#}|mbox{#}|fbox{#}|framebox{#}|makebox[#1]{#2}|parbox{#1}{#2}|raisebox{#1}{#2}|footnote{#}|footnotemark|footnotetext{#}|marginpar{#}|verb|url{#}|href{#1}{#2}|hyperref[#1]{#2}|ldots|dots|textbackslash|textasciitilde|textasciicircum|textbar|textbullet|textdegree|textquotedblleft|textquotedblright|LaTeX|TeX|ie|eg|centering|raggedright|raggedleft|noindent|indent|par|newline|hfill|vfill|hspace{#}|vspace{#}|hspace*{#}|vspace*{#}|smallskip|medskip|bigskip|quad|qquad|enspace|thinspace|tiny|scriptsize|footnotesize|small|normalsize|large|Large|LARGE|huge|Huge|bfseries|itshape|ttfamily|scshape|sffamily|rmfamily|normalfont|em|selectlanguage{#}|foreignlanguage{#1}{#2}|lipsum|lipsum[#]|blindtext|item|item[#]`,
  References: `label{#}|ref{#}|eqref{#}|pageref{#}|autoref{#}|cref{#}|Cref{#}|nameref{#}|vref{#}|cite{#}|cite[#1]{#2}|citep{#}|citet{#}|citeauthor{#}|citeyear{#}|parencite{#}|textcite{#}|autocite{#}|footcite{#}|fullcite{#}|nocite{*}|bibliography{#}|bibliographystyle{#}|addbibresource{#}|printbibliography|printbibliography[heading=#]|bibitem{#}|makeindex|printindex|index{#}|glossary{#}|gls{#}|Gls{#}|glspl{#}|acrshort{#}|acrlong{#}|acrfull{#}|newacronym{#1}{#2}{#3}|newglossaryentry{#1}{name={#2},description={#3}}|printglossaries|makeglossaries|nomenclature{#1}{#2}|printnomenclature`,
  Floats: `includegraphics{#}|includegraphics[width=\\textwidth]{#}|includegraphics[width=0.#1\\textwidth]{#2}|graphicspath{{#}}|caption{#}|caption*{#}|captionof{#1}{#2}|subcaption{#}|listoffigures|hline|cline{#}|toprule|midrule|bottomrule|cmidrule{#}|multicolumn{#1}{#2}{#3}|multirow{#1}{#2}{#3}|arraystretch|tabcolsep|rowcolor{#}|cellcolor{#}|newcolumntype{#1}{#2}|textwidth|linewidth|columnwidth|paperwidth|textheight|resizebox{#1}{#2}{#3}|scalebox{#1}{#2}|rotatebox{#1}{#2}`,
  Math: `frac{#1}{#2}|dfrac{#1}{#2}|tfrac{#1}{#2}|sqrt{#}|sqrt[#1]{#2}|sum|sum_{#1}^{#2}|prod|prod_{#1}^{#2}|int|int_{#1}^{#2}|iint|iiint|oint|lim|lim_{#}|limsup|liminf|infty|partial|nabla|cdot|cdots|ldots|vdots|ddots|times|div|pm|mp|leq|geq|neq|approx|equiv|sim|simeq|cong|propto|ll|gg|subset|subseteq|supset|supseteq|in|notin|ni|cup|cap|setminus|emptyset|varnothing|forall|exists|nexists|neg|land|lor|implies|iff|to|mapsto|rightarrow|leftarrow|Rightarrow|Leftarrow|leftrightarrow|Leftrightarrow|uparrow|downarrow|hat{#}|bar{#}|tilde{#}|vec{#}|dot{#}|ddot{#}|overline{#}|underline{#}|widehat{#}|widetilde{#}|overbrace{#1}^{#2}|underbrace{#1}_{#2}|mathbf{#}|mathit{#}|mathrm{#}|mathsf{#}|mathtt{#}|mathcal{#}|mathbb{#}|mathfrak{#}|mathscr{#}|boldsymbol{#}|text{#}|operatorname{#}|left(|right)|left[|right]|left\\{|right\\}|left|right|big|Big|bigg|Bigg|binom{#1}{#2}|choose|pmod{#}|bmod|mod{#}|log|ln|exp|sin|cos|tan|cot|sec|csc|arcsin|arccos|arctan|sinh|cosh|tanh|max|min|sup|inf|arg|det|dim|gcd|deg|ker|Pr|alpha|beta|gamma|delta|epsilon|varepsilon|zeta|eta|theta|vartheta|iota|kappa|lambda|mu|nu|xi|pi|varpi|rho|varrho|sigma|varsigma|tau|upsilon|phi|varphi|chi|psi|omega|Gamma|Delta|Theta|Lambda|Xi|Pi|Sigma|Upsilon|Phi|Psi|Omega|ell|hbar|Re|Im|aleph|angle|perp|parallel|mid|nmid|circ|bullet|star|ast|dagger|ddagger|langle|rangle|lceil|rceil|lfloor|rfloor|lvert|rvert|lVert|rVert|norm{#}|abs{#}|tag{#}|nonumber|notag|intertext{#}|substack{#}|stackrel{#1}{#2}|overset{#1}{#2}|underset{#1}{#2}|xrightarrow{#}|xleftarrow{#}|displaystyle|textstyle|limits|nolimits|mathrm{d}|qedhere|therefore|because`,
  Definitions: `newcommand{\\#1}{#2}|newcommand{\\#1}[#2]{#3}|renewcommand{\\#1}{#2}|providecommand{\\#1}{#2}|newenvironment{#1}{#2}{#3}|newtheorem{#1}{#2}|newtheorem{#1}{#2}[#3]|theoremstyle{#}|DeclareMathOperator{\\#1}{#2}|def|let|setlength{#1}{#2}|addtolength{#1}{#2}|setcounter{#1}{#2}|addtocounter{#1}{#2}|newcounter{#}|stepcounter{#}|value{#}|arabic{#}|roman{#}|Roman{#}|alph{#}|Alph{#}|the|renewcommand{\\baselinestretch}{#}|linespread{#}|geometry{#}|hypersetup{#}|definecolor{#1}{#2}{#3}|setmainfont{#}|setsansfont{#}|setmonofont{#}|lstset{#}|usetikzlibrary{#}|tikz|draw|node|fill|filldraw|path|coordinate|addplot|usetheme{#}|usecolortheme{#}|usefonttheme{#}|setbeamercolor{#1}{#2}|setbeamertemplate{#1}{#2}|frametitle{#}|framesubtitle{#}|titlepage|pause|only<#1>{#2}|onslide<#>|uncover<#1>{#2}|alert{#}|institute{#}|logo{#}|titlegraphic{#}|tableofcontents[currentsection]|AtBeginSection|makeatletter|makeatother|IfFileExists{#1}{#2}{#3}|ifthenelse{#1}{#2}{#3}|mbox|protect|string|expandafter|relax|phantom{#}|vphantom{#}|hphantom{#}|strut|rule{#1}{#2}|leavevmode|null`,
};

// CodeMirror snippet templates treat "\{" as an escaped brace, so literal LaTeX "\{" needs doubling.
export function toSnippet(body) {
  return body.replace(/\\([{}])/g, '\\\\$1').replace(/#(\d)?/g, (_, d) => (d ? `\${${d}}` : '${}'));
}

function displayLabel(body) {
  return '\\' + body.replace(/#\d?/g, '');
}

export const COMMANDS = [];
for (const [group, list] of Object.entries(groups)) {
  for (const body of list.split('|')) {
    if (!body) continue;
    COMMANDS.push({ label: displayLabel(body), snippet: toSnippet(body), detail: group, hasArgs: /[{[<]/.test(body) });
  }
}

// Environment bodies. "#" marks the cursor.
export const ENVIRONMENTS = {
  document: '\n\t#\n',
  abstract: '\n\t#\n',
  itemize: '\n\t\\item #\n',
  enumerate: '\n\t\\item #\n',
  description: '\n\t\\item[#1] #2\n',
  figure: '[htbp]\n\t\\centering\n\t\\includegraphics[width=0.8\\textwidth]{#1}\n\t\\caption{#2}\n\t\\label{fig:#3}\n',
  'figure*': '[htbp]\n\t\\centering\n\t\\includegraphics[width=\\textwidth]{#1}\n\t\\caption{#2}\n\t\\label{fig:#3}\n',
  table: '[htbp]\n\t\\centering\n\t\\caption{#1}\n\t\\label{tab:#2}\n\t\\begin{tabular}{#3}\n\t\t#4\n\t\\end{tabular}\n',
  'table*': '[htbp]\n\t\\centering\n\t\\caption{#1}\n\t\\label{tab:#2}\n\t\\begin{tabular}{#3}\n\t\t#4\n\t\\end{tabular}\n',
  tabular: '{#1}\n\t#2\n',
  'tabular*': '{#1}{#2}\n\t#3\n',
  tabularx: '{\\textwidth}{#1}\n\t#2\n',
  longtable: '{#1}\n\t#2\n',
  equation: '\n\t#\n',
  'equation*': '\n\t#\n',
  align: '\n\t#\n',
  'align*': '\n\t#\n',
  gather: '\n\t#\n',
  'gather*': '\n\t#\n',
  multline: '\n\t#\n',
  'multline*': '\n\t#\n',
  flalign: '\n\t#\n',
  split: '\n\t#\n',
  cases: '\n\t#\n',
  matrix: '\n\t#\n',
  pmatrix: '\n\t#\n',
  bmatrix: '\n\t#\n',
  vmatrix: '\n\t#\n',
  Vmatrix: '\n\t#\n',
  array: '{#1}\n\t#2\n',
  eqnarray: '\n\t#\n',
  subequations: '\n\t#\n',
  center: '\n\t#\n',
  flushleft: '\n\t#\n',
  flushright: '\n\t#\n',
  quote: '\n\t#\n',
  quotation: '\n\t#\n',
  verse: '\n\t#\n',
  verbatim: '\n#\n',
  lstlisting: '[language=#1]\n#2\n',
  minted: '{#1}\n#2\n',
  minipage: '{0.#1\\textwidth}\n\t#2\n',
  subfigure: '{0.#1\\textwidth}\n\t\\centering\n\t\\includegraphics[width=\\textwidth]{#2}\n\t\\caption{#3}\n\t\\label{fig:#4}\n',
  wrapfigure: '{r}{0.4\\textwidth}\n\t\\centering\n\t\\includegraphics[width=0.38\\textwidth]{#1}\n\t\\caption{#2}\n',
  theorem: '\n\t#\n',
  lemma: '\n\t#\n',
  proposition: '\n\t#\n',
  corollary: '\n\t#\n',
  definition: '\n\t#\n',
  example: '\n\t#\n',
  remark: '\n\t#\n',
  proof: '\n\t#\n',
  frame: '{#1}\n\t#2\n',
  block: '{#1}\n\t#2\n',
  alertblock: '{#1}\n\t#2\n',
  exampleblock: '{#1}\n\t#2\n',
  columns: '\n\t\\begin{column}{0.5\\textwidth}\n\t\t#1\n\t\\end{column}\n\t\\begin{column}{0.5\\textwidth}\n\t\t#2\n\t\\end{column}\n',
  column: '{0.5\\textwidth}\n\t#\n',
  tikzpicture: '\n\t#\n',
  axis: '[#1]\n\t#2\n',
  thebibliography: '{99}\n\t\\bibitem{#1} #2\n',
  titlepage: '\n\t#\n',
  appendices: '\n\t#\n',
  algorithm: '[htbp]\n\t\\caption{#1}\n\t\\label{alg:#2}\n\t#3\n',
  algorithmic: '[1]\n\t#\n',
  comment: '\n#\n',
  landscape: '\n\t#\n',
  multicols: '{2}\n\t#\n',
  spacing: '{1.5}\n\t#\n',
  small: '\n\t#\n',
  footnotesize: '\n\t#\n',
  tcolorbox: '[title=#1]\n\t#2\n',
  filecontents: '{#1}\n#2\n',
  appendix: '\n\t#\n',
};

export const PACKAGES = `amsmath amssymb amsthm amsfonts mathtools graphicx xcolor color hyperref geometry babel inputenc fontenc lmodern
natbib biblatex cite booktabs tabularx longtable multirow multicol array caption subcaption float wrapfig placeins
enumitem listings minted algorithm algorithmic algorithm2e algpseudocode tikz pgfplots pgf circuitikz siunitx physics
cleveref varioref nameref url microtype setspace titlesec titling fancyhdr lastpage xparse etoolbox ifthen calc
csquotes lipsum blindtext kantlipsum todonotes soul ulem xspace fontspec polyglossia unicode-math times mathptmx
newtxtext newtxmath helvet courier palatino mathpazo charter libertine tgtermes lato opensans sourcesanspro
tcolorbox mdframed framed fancybox fancyvrb verbatim comment pdfpages pdflscape rotating afterpage appendix
glossaries acronym nomencl imakeidx makeidx index tocloft tocbibind chngcntr datetime2 datetime textcomp gensymb
bm dsfont mathrsfs upgreek cancel chemfig mhchem chemformula tikz-cd forest qtree dirtree smartdiagram
adjustbox changepage pdfcomment xstring hyphenat ragged2e sectsty authblk footmisc footnote threeparttable
makecell colortbl diagbox tabu ltablex dcolumn pgfgantt pgfplotstable standalone subfiles import docmute
beamerposter tikzposter a0poster ifpdf ifxetex ifluatex iftex epstopdf svg transparent eso-pic background
draftwatermark watermark qrcode tabto marginnote sidenotes ccicons fontawesome fontawesome5 academicons
moderncv europecv hologo metalogo realboxes lscape nicefrac xfrac units numprint thmtools ntheorem shadethm
parskip indentfirst zref hypcap bookmark pdfsync scrlayer-scrpage typearea csvsimple datatool xltabular tabularray
arydshln hhline stackengine accents esint wasysym marvosym pifont bbding dingbat amstext amsopn`.split(/\s+/);

export const CLASSES = `article report book letter memoir beamer scrartcl scrreprt scrbook scrlttr2 IEEEtran elsarticle llncs
amsart amsbook revtex4-2 revtex4-1 moderncv standalone tikzposter a0poster jarticle ltxdoc minimal extarticle extreport
exam acmart svjour3 aa mnras apa7 apa6 thesis ociamthesis`.split(/\s+/);

export const REF_CMDS = /\\(ref|eqref|pageref|autoref|Autoref|cref|Cref|vref|nameref|labelcref|hyperref\[)\*?$/;
export const CITE_CMDS = /\\(cite|citep|citet|citealp|citealt|citeauthor|citeyear|citeyearpar|parencite|textcite|autocite|Autocite|footcite|fullcite|smartcite|supercite|nocite|Cite|Parencite|Textcite)\*?$/;
