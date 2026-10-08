/**
 * Post-build: inline the hashed CSS/JS assets into a single self-contained
 * HTML file (dist/app.html) so it can be served standalone (preview server
 * serves the HTML file without sibling assets).
 */
import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const dist = join(root, 'dist');
let html = readFileSync(join(dist, 'index.html'), 'utf8');

const assets = readdirSync(join(dist, 'assets'));
const cssFile = assets.find((f) => f.endsWith('.css'));
const jsFile = assets.find((f) => f.endsWith('.js'));

if (cssFile) {
  const css = readFileSync(join(dist, 'assets', cssFile), 'utf8');
  // Replacer function so `$&`-like sequences in the payload stay literal
  html = html.replace(
    new RegExp(`<link[^>]*href="[^"]*${cssFile}"[^>]*>`),
    () => `<style>\n${css}\n</style>`,
  );
}
if (jsFile) {
  const js = readFileSync(join(dist, 'assets', jsFile), 'utf8').replace(/<\/script/gi, '<\\/script');
  html = html.replace(
    new RegExp(`<script[^>]*src="[^"]*${jsFile}"[^>]*></script>`),
    () => `<script type="module">\n${js}\n</script>`,
  );
}

writeFileSync(join(dist, 'app.html'), html);
console.log(`dist/app.html written (${(html.length / 1024).toFixed(0)} kB, self-contained)`);
