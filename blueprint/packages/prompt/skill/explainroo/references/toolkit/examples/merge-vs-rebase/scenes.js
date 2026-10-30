// git merge vs rebase, as a vertical short. Time flows down the screen: main
// is the left column, your branch the right one. Captions fill the lower part
// of the frame, so the graph stays above y = 1300.

const MAIN_X = 300;
const FEAT_X = 760;
const Y = (i) => 400 + i * 142;
const R = 58;

// Draws main (A to E) and the feature branch (F1, F2 off B).
function history(s, { at = -1, main = true, feature = true, featureOut, ghost = false } = {}) {
  const t0 = s.time(at);
  const when = (d) => (t0 < 0 ? t0 : t0 + d);
  if (main) {
    ['A', 'B', 'C', 'D', 'E'].forEach((c, i) => {
      s.circle({ id: c, x: MAIN_X, y: Y(i), r: R, label: c, size: 52, color: 'blue', at: when(i * 0.15) });
      if (i) s.line([[MAIN_X, Y(i - 1) + R], [MAIN_X, Y(i) - R]], { color: 'blue', at: when(i * 0.15 - 0.05), sfx: false });
    });
    s.note('main', { x: MAIN_X, y: Y(0) - 105, size: 44, color: 'blue', at: t0 });
  }
  if (!feature) return;
  const f = { at: when(0.8), out: featureOut, dashed: ghost, opacity: ghost ? 0.45 : 1 };
  s.line([[MAIN_X + R * 0.7, Y(1) + R * 0.7], [FEAT_X - R * 0.7, Y(2) - R * 0.7]], { color: 'green', ...f, sfx: false });
  s.circle({ id: 'F1', x: FEAT_X, y: Y(2), r: R, label: 'F1', size: 46, color: 'green', ...f });
  s.line([[FEAT_X, Y(2) + R], [FEAT_X, Y(3) - R]], { color: 'green', ...f, sfx: false });
  s.circle({ id: 'F2', x: FEAT_X, y: Y(3), r: R, label: 'F2', size: 46, color: 'green', ...f, at: f.at + 0.15 });
  s.note('your branch', { x: FEAT_X, y: Y(2) - 105, size: 44, color: 'green', ...f });
}

export default {
  hook(s) {
    s.title('merge or *rebase*?', { y: 190, size: 88, at: 0 });
    history(s, { at: 'branch' });
    s.icon('git-merge', { x: 300, y: 1150, size: 120, color: 'purple', at: '#two', label: 'merge', labelSize: 48 });
    s.icon('git-commit-vertical', { x: 780, y: 1150, size: 120, color: 'accent', at: '#or', label: 'rebase', labelSize: 48 });
  },

  merge(s) {
    s.title('merge', { y: 190, size: 88, at: -1 });
    history(s);
    const my = Y(5);
    s.circle({ id: 'M', x: MAIN_X, y: my, r: R + 6, label: 'M', size: 52, color: 'purple', at: '#knot', enter: 'pop' });
    s.line([[MAIN_X, Y(4) + R], [MAIN_X, my - R - 6]], { color: 'purple', at: s.mark('knot') - 0.2 });
    s.line([[FEAT_X, Y(3) + R], [MAIN_X + R, my - R * 0.5]], { color: 'purple', at: s.mark('knot') - 0.2 });
    s.note('merge commit', { x: 420, y: my, size: 48, color: 'purple', align: 'left', at: s.mark('knot') + 0.4 });
  },

  rebase(s) {
    s.title('rebase', { y: 190, size: 88, at: -1 });
    history(s, { featureOut: 'takes', ghost: false });
    history(s, { main: false, ghost: true, at: s.cueEnd('off') - 0.8 });
    const y1 = Y(5);
    const y2 = Y(6);
    s.line([[MAIN_X, Y(4) + R], [MAIN_X, y1 - R]], { color: 'accent', at: s.mark('replay') + 0.1 });
    s.circle({ id: 'F1b', x: MAIN_X, y: y1, r: R, label: "F1'", size: 46, color: 'accent', at: s.mark('replay') + 0.3, enter: 'drop' });
    s.line([[MAIN_X, y1 + R], [MAIN_X, y2 - R]], { color: 'accent', at: s.mark('replay') + 0.8 });
    s.circle({ id: 'F2b', x: MAIN_X, y: y2, r: R, label: "F2'", size: 46, color: 'accent', at: s.mark('replay') + 1.0, enter: 'drop' });
    s.arrow([FEAT_X - 20, Y(2) + 70], [MAIN_X + 90, y1 - 10], { bend: -0.3, dashed: true, color: 'muted', at: s.mark('replay') + 0.1, width: 3 });
    s.note('a straight line', { x: 420, y: y2, size: 48, color: 'accent', align: 'left', at: '#line' });
  },

  hashes(s) {
    s.title('new hashes', { y: 190, size: 88, at: 0 });
    const rows = [
      ['F1', 'a3f9c21', "F1'", 'e1d7b09'],
      ['F2', '7be04d8', "F2'", '4c2a8f3'],
    ];
    rows.forEach(([o, oh, n, nh], i) => {
      const y = 480 + i * 340;
      s.circle({ id: `o${i}`, x: 230, y, r: R, label: o, size: 46, color: 'green', at: -1, opacity: 0.55, dashed: true });
      s.text(oh, { id: `oh${i}`, font: 'mono', x: 340, y, size: 60, align: 'left', color: 'muted', at: -1 });
      s.annotate(`oh${i}`, { type: 'strike', color: 'red', at: s.mark('new') + i * 0.3 });
      s.circle({ id: `n${i}`, x: 230, y: y + 150, r: R, label: n, size: 46, color: 'accent', at: s.cue('new') + i * 0.25 });
      s.text(nh, { font: 'mono', x: 340, y: y + 150, size: 60, align: 'left', color: 'accent', at: s.mark('new') + 0.2 + i * 0.3, enter: 'type', dur: 0.5 });
    });
    s.note('same changes, new commits', { y: 1230, size: 48, at: s.cue('commits') });
  },

  rule(s) {
    s.icon('triangle-alert', { y: 470, size: 210, color: 'yellow', at: 0.2, bg: 'circle', bgScale: 1.5 });
    s.text("Don't rebase\n*shared* branches", { font: 'display', size: 84, y: 850, at: '#shared', lineHeight: 1.15, mark: 'yellow' });
    s.icon('users', { y: 1150, size: 120, color: 'muted', at: 'people' });
  },

  outro(s) {
    s.box('merge', { x: 540, y: 520, w: 760, h: 250, icon: 'git-merge', color: 'purple', size: 56, at: 'merge' });
    s.note('history as it happened', { y: 710, size: 48, at: 'happened' });
    s.box('rebase', { x: 540, y: 960, w: 760, h: 250, icon: 'git-commit-vertical', color: 'accent', size: 56, at: '#clean' });
    s.note('a straight line, easier to read', { y: 1150, size: 48, at: 'easier' });
  },
};
