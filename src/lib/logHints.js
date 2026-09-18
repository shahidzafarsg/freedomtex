// Plain-language explanations for common LaTeX errors and warnings.
const HINTS = [
  [/Undefined control sequence/i, 'LaTeX does not recognise a command on this line. Check the spelling, or load the package that defines it with \\usepackage{...} in the preamble.'],
  [/Missing \$ inserted/i, 'A maths symbol (such as _, ^ or \\alpha) was used outside maths mode. Wrap it in $...$, or escape the character (\\_ for an underscore).'],
  [/Extra alignment tab has been changed/i, 'A table row has more cells (&) than the column specification allows. Add a column to \\begin{tabular}{...} or remove an &.'],
  [/Misplaced alignment tab character &/i, 'The & character is only allowed inside tables and aligned equations. Write \\& to print an ampersand.'],
  [/There's no line here to end/i, 'A \\\\ line break was used where there is no line to end (for example right after a heading or a blank line). Remove it or use \\newline in text.'],
  [/File `.*' not found/i, 'A file or package could not be found. If it is a package, FreedomTex can install it for you. If it is one of your files, check the name and folder.'],
  [/Missing \\begin\{document\}/i, 'Text or commands appear before \\begin{document}, or the preamble has a stray character. Move body text below \\begin{document}.'],
  [/Environment .* undefined/i, 'This environment is not defined. Check the spelling or load the package that provides it.'],
  [/\\begin\{.*\} on input line .* ended by \\end/i, 'An environment was closed with the wrong \\end{...}. Make sure every \\begin has a matching \\end with the same name.'],
  [/Too many \}'s/i, 'There is a closing brace } without a matching opening brace {.'],
  [/Runaway argument/i, 'A command argument is missing its closing brace }. Look for an unbalanced { on or before this line.'],
  [/Paragraph ended before .* was complete/i, 'A blank line appears inside a command argument, usually because a closing brace } is missing.'],
  [/Missing number, treated as zero/i, 'A command expected a number or length (such as 2cm) but got something else.'],
  [/Illegal unit of measure/i, 'A length is missing its unit. Write, for example, 1cm, 12pt or 0.5\\textwidth.'],
  [/Option clash for package/i, 'The same package is loaded twice with different options. Load it once with all options, or use \\PassOptionsToPackage before \\documentclass.'],
  [/Citation .* undefined/i, 'This citation key was not found. Check it matches an entry in your .bib file, then recompile so the bibliography is rebuilt.'],
  [/Reference .* undefined/i, 'A \\ref points to a \\label that does not exist (or was just added). Check the label name. It may resolve after another compile.'],
  [/There were undefined references/i, 'Some references or citations could not be resolved. Recompile once more; if the warning stays, check the label and citation names.'],
  [/Label .* multiply defined/i, 'The same \\label name is used more than once. Give each label a unique name.'],
  [/Overfull \\hbox/i, 'A line is wider than the text area, often due to a long word, URL or wide image. Rephrase, allow hyphenation, or scale the content.'],
  [/Underfull \\hbox/i, 'A line has too much space, usually from a manual \\\\ or \\newline. This is cosmetic and can often be ignored.'],
  [/Font shape .* undefined/i, 'The requested font style is not available, so a substitute was used. This is usually harmless.'],
  [/Unicode character .* not set up for use with LaTeX/i, 'The text contains a character pdfLaTeX cannot print. Replace it with a LaTeX command, or switch the compiler to XeLaTeX or LuaLaTeX.'],
  [/Emergency stop/i, 'LaTeX stopped because of an earlier error. Fix the first error in the list and compile again.'],
  [/Float too large for page/i, 'A figure or table is taller than the page. Reduce its size, for example with [width=0.8\\textwidth].'],
  [/Too many unprocessed floats/i, 'Too many figures or tables are waiting to be placed. Add \\clearpage, or use [htbp] placement options.'],
  [/I couldn't open database file/i, 'BibTeX could not find the .bib file. Check the name in \\bibliography{...} (without the .bib extension).'],
  [/I found no \\citation commands/i, 'BibTeX found no \\cite commands. Cite at least one source, or use \\nocite{*} to list every entry.'],
  [/Missing \} inserted/i, 'A group was not closed properly. Check for a missing } or a stray { in maths.'],
  [/Display math should end with \$\$/i, 'Display maths started with $$ was not closed with $$. Prefer \\[ ... \\] for display equations.'],
];

export function hintFor(message) {
  for (const [re, hint] of HINTS) if (re.test(message)) return hint;
  return null;
}
