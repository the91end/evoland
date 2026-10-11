// Bundles the built app (dist/) into one self-contained HTML file for
// publishing as a claude.ai artifact: CSS and JS inlined, worker inlined
// as a blob by the ?worker&inline import.
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const dist = 'dist';
const out = process.argv[2] ?? join(dist, 'evoland.html');
const html = readFileSync(join(dist, 'index.html'), 'utf8');
const css = [...html.matchAll(/<link rel="stylesheet"[^>]*href="\.\/([^"]+)"[^>]*>/g)].map((m) =>
  readFileSync(join(dist, m[1]), 'utf8'),
);
const js = [...html.matchAll(/<script type="module"[^>]*src="\.\/([^"]+)"[^>]*><\/script>/g)].map((m) =>
  readFileSync(join(dist, m[1]), 'utf8').replace(/<\/script/gi, '<\\/script'),
);
const body = html.slice(html.indexOf('<body>') + 6, html.lastIndexOf('</body>'));
const title = html.match(/<title>[^<]*<\/title>/)[0];
const page =
  `${title}\n<style>\n${css.join('\n')}\n</style>\n` +
  body.replace(/<script type="module"[^>]*><\/script>/g, '') +
  js.map((s) => `<script type="module">\n${s}\n</script>`).join('\n');
writeFileSync(out, page);
console.log(`wrote ${out} (${(page.length / 1024).toFixed(0)} KB)`);
