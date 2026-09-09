#!/usr/bin/env python3
"""Inline src/engine.js (the file the validation harness runs) into src/page.template.html → ginzu/index.html."""
import pathlib
here = pathlib.Path(__file__).resolve().parent
engine = (here / 'engine.js').read_text()
tpl = (here / 'page.template.html').read_text()
assert '/*__ENGINE__*/' in tpl
out = tpl.replace('/*__ENGINE__*/', engine)
dest = here.parent / 'index.html'
dest.write_text(out)
print(f'wrote {dest} ({len(out):,} bytes)')
