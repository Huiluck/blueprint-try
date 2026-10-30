import test from 'node:test';
import assert from 'node:assert/strict';
import { 图纸缓出, 创建分身切换动效 } from './分身切换动效.js';

class Element {
  constructor(rect, names = []) {
    this.rect = { ...rect }; this.style = {}; this.animations = []; this.classes = new Set(names); this.children = [];
    this.classList = { remove: (...values) => values.forEach(value => this.classes.delete(value)), add: value => this.classes.add(value) };
  }
  getBoundingClientRect() { return { ...this.rect }; }
  setAttribute() {}
  cloneNode() { return new Element(this.rect, [...this.classes]); }
  appendChild(node) { node.parent = this; this.children.push(node); }
  remove() { if (this.parent) this.parent.children = this.parent.children.filter(node => node !== this); this.parent = null; }
  animate(frames, options) {
    let resolve, reject;
    const animation = { frames, options, canceled: false, finished: new Promise((ok, fail) => { resolve = ok; reject = fail; }),
      finish() { resolve(); }, cancel() { this.canceled = true; reject(new Error('canceled')); } };
    this.animations.push(animation); return animation;
  }
}
const rect = (left, top, width = 200, height = 74) => ({ left, top, width, height });
function fixture() {
  const original = { matrix: globalThis.DOMMatrix, style: globalThis.getComputedStyle };
  globalThis.DOMMatrix = class { a = 1; };
  globalThis.getComputedStyle = () => ({ transform: 'none' });
  const scene = new Element(rect(0, 0, 1200, 800)), ghosts = new Element(rect(0, 0));
  const motion = 创建分身切换动效({ scene: () => scene, ghosts: () => ghosts });
  const choice = new Element(rect(30, 100, 200, 47)), current = new Element(rect(30, 220));
  choice.style.top = '999px'; // 动画中途屏幕位置与旧落点不同。
  const change = motion.capture({ key: 'helm', incoming: 'next', outgoing: 'previous', choice, current });
  const brick = new Element(rect(30, 220)), track = new Element(rect(30, 350, 200, 47));
  const play = () => motion.play({ change, brick, target: { x: 30, y: 220, w: 200, h: 74 }, outgoingTrack: track,
    outgoingTarget: { x: 30, y: 350, w: 200, h: 47 } });
  const restore = () => { motion.cancel(); globalThis.DOMMatrix = original.matrix; globalThis.getComputedStyle = original.style; };
  return { motion, ghosts, change, brick, track, play, restore };
}

test('镜头缓动与 CSS 曲线同相，不再用近似五次方曲线', () => {
  assert.equal(图纸缓出(0), 0); assert.equal(图纸缓出(1), 1);
  assert.ok(Math.abs(图纸缓出(.3425) - .875) < .00001);
  assert.ok(Array.from({ length: 100 }, (_, i) => 图纸缓出(i / 100) <= 图纸缓出((i + 1) / 100)).every(Boolean));
});
test('进出卡片同一时长交接，正文不缩放，结束撤下过渡副本', async () => {
  const state = fixture();
  try {
    assert.equal(state.change.from.y, 100);
    assert.equal(state.play(), true); assert.equal(state.ghosts.children.length, 2);
    const copies = [...state.ghosts.children];
    const animations = [...copies.flatMap(copy => copy.animations), ...state.brick.animations, ...state.track.animations];
    assert.equal(animations.length, 4);
    assert.ok(animations.every(animation => animation.options.duration === 540 && animation.options.easing === 'cubic-bezier(.22,1,.36,1)'));
    assert.equal(state.brick.animations[0].frames[0].transform, 'translate(0px,-120px)');
    assert.ok(!JSON.stringify(animations.map(animation => animation.frames)).includes('scale('));
    assert.equal(copies[1].animations[0].frames.at(-1).height, '47px');
    animations.forEach(animation => animation.finish()); await Promise.resolve();
    assert.equal(state.ghosts.children.length, 0); assert.ok(animations.every(animation => animation.canceled));
  } finally { state.restore(); }
});
test('快速反向接住飞行中的旧分身，旧回调不能清掉新一轮过渡', async () => {
  const state = fixture();
  try {
    state.play();
    const [incoming, outgoing] = state.ghosts.children;
    outgoing.rect = rect(30, 278, 200, 60);
    const reverse = state.motion.capture({ key: 'helm', incoming: 'previous', outgoing: 'next',
      choice: new Element(rect(30, 999, 200, 47)), current: state.brick });
    assert.equal(reverse.from.y, 278); assert.equal(reverse.from.h, 60);
    assert.equal(state.ghosts.children.length, 0);
    assert.ok([...incoming.animations, ...outgoing.animations, ...state.brick.animations, ...state.track.animations].every(animation => animation.canceled));
    const brick = new Element(rect(30, 220));
    state.motion.play({ change: reverse, brick, target: { x: 30, y: 220, w: 200, h: 74 }, outgoingTrack: state.track,
      outgoingTarget: { x: 30, y: 100, w: 200, h: 47 } });
    await Promise.resolve();
    assert.equal(state.ghosts.children.length, 2);
    state.motion.cancel(); assert.equal(state.ghosts.children.length, 0);
  } finally { state.restore(); }
});
