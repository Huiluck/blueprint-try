// Renders the finished MP4: soundtrack, frames in parallel pages, encode, mux.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { prepare, withEngine } from './pipeline.js';
import { frameEncoder, ffmpeg, normalizeLoudness } from './ffmpeg.js';

export async function render(project, opts = {}) {
  const log = opts.log || (() => {});
  const t0 = Date.now();
  const { timeline } = await prepare(project, { log });
  const draft = !!opts.draft;
  const scale = opts.scale ?? (draft ? 0.5 : 1);
  const fps = project.config.fps;
  const total = timeline.frames;
  const from = Math.max(0, Math.floor((opts.from ?? 0) * fps));
  const to = Math.min(total, opts.to !== undefined ? Math.ceil(opts.to * fps) : total);
  if (to <= from) throw new Error('nothing to render: --from must be before --to');
  const partial = from > 0 || to < total;
  const out = path.resolve(opts.out || path.join(project.paths.out, draft ? 'draft.mp4' : 'video.mp4'));
  const workers = Math.max(1, Math.min(opts.workers ?? Math.min(8, Math.max(1, Math.floor(os.cpus().length / 2))), to - from));
  const quality = draft ? 0.82 : 0.93;
  const segDir = path.join(project.paths.build, 'segments');
  fs.rmSync(segDir, { recursive: true, force: true });
  fs.mkdirSync(segDir, { recursive: true });
  fs.mkdirSync(path.dirname(out), { recursive: true });
  log(`rendering ${((to - from) / fps).toFixed(1)}s (${to - from} frames at ${fps} fps, ${Math.round(project.config.width * scale)}x${Math.round(project.config.height * scale)}) with ${workers} worker${workers > 1 ? 's' : ''}`);

  const mix = path.join(project.paths.build, 'mix.wav');
  const mixNorm = path.join(project.paths.build, 'mix-norm.wav');
  const encoders = [];
  try {
    await withEngine(project, timeline, { scale, pages: workers, log }, async (pages) => {
      const list = Array.isArray(pages) ? pages : [pages];
      const ta = Date.now();
      const sound = await list[0].evaluate((p) => window.explainroo.soundtrack(p), 'build/mix.wav');
      log(`soundtrack: ${sound.cues} sound cues, mixed in ${((Date.now() - ta) / 1000).toFixed(1)}s`);
      const norm = normalizeLoudness(mix, mixNorm, project.config.loudness);
      norm.catch(() => {});

      const per = Math.ceil((to - from) / list.length);
      let done = 0;
      let lastLog = Date.now();
      const tf = Date.now();
      await Promise.all(list.map(async (page, k) => {
        const a = from + k * per;
        const b = Math.min(to, a + per);
        if (a >= b) return;
        const enc = frameEncoder({ fps, out: path.join(segDir, `seg-${String(k).padStart(2, '0')}.mp4`), draft });
        encoders.push(enc);
        const batch = 6;
        for (let f = a; f < b; f += batch) {
          const frames = [];
          for (let i = f; i < Math.min(b, f + batch); i++) frames.push(i);
          const jpegs = await page.evaluate(([l, q]) => window.explainroo.frames(l, q), [frames, quality]);
          for (const j of jpegs) await enc.write(Buffer.from(j, 'base64'));
          done += frames.length;
          if (Date.now() - lastLog > 3000) {
            lastLog = Date.now();
            const rate = done / ((Date.now() - tf) / 1000);
            log(`frames ${done}/${to - from} (${rate.toFixed(1)} fps, about ${Math.ceil((to - from - done) / rate)}s left)`);
          }
        }
        await enc.close();
      }));
      log(`frames done in ${((Date.now() - tf) / 1000).toFixed(1)}s`);
      await norm;
    });
  } catch (e) {
    for (const enc of encoders) enc.kill();
    throw e;
  }

  const segs = fs.readdirSync(segDir).filter((f) => f.endsWith('.mp4')).sort();
  const listFile = path.join(segDir, 'list.txt');
  fs.writeFileSync(listFile, segs.map((s) => `file '${path.join(segDir, s).replace(/'/g, "'\\''")}'`).join('\n') + '\n');
  const audioArgs = partial ? ['-ss', String(from / fps), '-t', String((to - from) / fps), '-i', mixNorm] : ['-i', mixNorm];
  await ffmpeg(['-loglevel', 'error', '-f', 'concat', '-safe', '0', '-i', listFile, ...audioArgs, '-map', '0:v', '-map', '1:a', '-c:v', 'copy', '-c:a', 'aac', '-b:a', '192k', '-movflags', '+faststart', '-shortest', out]);
  fs.rmSync(segDir, { recursive: true, force: true });
  const secs = (Date.now() - t0) / 1000;
  log(`wrote ${path.relative(process.cwd(), out) || out} in ${secs.toFixed(1)}s`);
  return { out, duration: (to - from) / fps, frames: to - from, seconds: secs, width: Math.round(project.config.width * scale), height: Math.round(project.config.height * scale) };
}
