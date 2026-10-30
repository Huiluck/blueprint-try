import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { readFile, writeFile } from 'node:fs/promises';
const here = dirname(fileURLToPath(import.meta.url));
const dshLicense = await readFile(resolve(here, 'LICENSE'), 'utf8');
const reactLicense = await readFile(resolve(here, 'node_modules/react/LICENSE'), 'utf8');
const result = await build({
  entryPoints: [resolve(here, 'bridge.js')],
  outfile: resolve(here, '../../dsh-turn-navigator.js'),
  bundle: true, format: 'iife', globalName: 'BlueprintDshTurnNavigator',
  target: ['chrome110', 'safari16.4', 'firefox115'], minify: true,
  jsx: 'automatic', loader: {'.css': 'local-css'}, write: false,
  define: { 'process.env.NODE_ENV': '"production"' }, legalComments: 'inline',
  banner: { js: `/* DSH TurnNavigator / TrajectoryToolbar / TrajectoryTimeline 0.1.5-rc.2. Source: viewer/vendor/dsh-turn-navigator.\n${dshLicense}\nReact / React DOM license:\n${reactLicense}\n*/` },
});
for (const output of result.outputFiles) if (output.path.endsWith('.js')) await writeFile(output.path, output.contents);
const css = await Promise.all(['TurnNavigator.css', 'trajectory/TrajectoryToolbar.css', 'trajectory/TrajectoryTimeline.css']
  .map(path => readFile(resolve(here, path), 'utf8')));
css.push(...result.outputFiles.filter(output => output.path.endsWith('.css')).map(output => output.text));
await writeFile(resolve(here, '../../dsh-turn-navigator.css'), css.join('\n'));
