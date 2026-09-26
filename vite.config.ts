/**
 * Build: `npm run build` writes the static site to dist/ (not committed). CI
 * builds, tests and e2e-checks it, then deploys that exact dist/ to GitHub
 * Pages on every push to main (.github/workflows/ci.yml).
 *
 * The sw plugin generates sw.js with the exact list of emitted files and a
 * content hash as its version, so every deploy precaches the full app.
 */
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import preact from '@preact/preset-vite';
import { defineConfig, type Plugin } from 'vite';

function walk(dir: string): string[] {
  let out: string[] = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out = out.concat(walk(p));
    else out.push(p);
  }
  return out;
}

function serviceWorker(): Plugin {
  return {
    name: 'hopa-service-worker',
    apply: 'build',
    enforce: 'post',
    generateBundle(_opts, bundle) {
      const publicDir = resolve(__dirname, 'public');
      const publicFiles = walk(publicDir)
        .map((p) => relative(publicDir, p).split('\\').join('/'))
        .filter((f) => !f.startsWith('.') && f !== 'sw.js');
      const bundled = Object.keys(bundle).filter((f) => !f.endsWith('.map'));
      const files = [...new Set([...bundled, ...publicFiles])].sort();
      const h = createHash('sha256');
      for (const f of files) {
        h.update(f);
        const b = bundle[f];
        if (b) h.update(b.type === 'chunk' ? b.code : typeof b.source === 'string' ? b.source : Buffer.from(b.source));
        else h.update(readFileSync(join(publicDir, f)));
      }
      const version = h.digest('hex').slice(0, 12);
      const assets = ['./', ...files.filter((f) => f !== 'index.html').map((f) => `./${f}`)];
      const src = readFileSync(resolve(__dirname, 'src/sw/sw.template.js'), 'utf8')
        .replace('__VERSION__', version)
        .replace('__ASSETS__', JSON.stringify(assets));
      this.emitFile({ type: 'asset', fileName: 'sw.js', source: src });
    },
  };
}

export default defineConfig({
  base: './',
  plugins: [preact(), serviceWorker()],
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    assetsDir: 'assets',
    sourcemap: false,
    target: 'es2020',
    assetsInlineLimit: 0,
  },
});
