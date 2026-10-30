#!/usr/bin/env node
import { main } from '../src/cli.js';

main(process.argv.slice(2)).then(
  (code) => process.stdout.write('', () => process.exit(code ?? 0)),
  (e) => {
    process.stderr.write(`${e && e.stack ? e.stack : e}\n`);
    process.exit(1);
  },
);
