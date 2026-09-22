import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import { resolveNativeQuotaBannerPreference } from '../src/utils/codexNativeQuotaBanner';

const source = readFileSync(new URL('../src-tauri/src/modules/codex_native_quota_banner.js', import.meta.url), 'utf8');
const TYPE = 'workspace_member_credits_depleted';
const ROOT = '[data-codex-composer-root][data-composer-placement]';
const MARK = 'data-cockpit-native-banner-hidden';

class Element {
  tagName: string;
  nodeType = 1;
  children: Element[] = [];
  parent: Element | null = null;
  attributes = new Map<string, string>();
  styles = new Map<string, { value: string; priority: string }>();
  style = {
    getPropertyValue: (key: string) => this.styles.get(key)?.value ?? '',
    getPropertyPriority: (key: string) => this.styles.get(key)?.priority ?? '',
    setProperty: (key: string, value: string, priority = '') => { this.styles.set(key, {value, priority}); },
    removeProperty: (key: string) => { this.styles.delete(key); },
  };
  constructor(tag: string, public composer = false, public textContent = '') { this.tagName = tag.toUpperCase(); }
  append(child: Element) { child.parent = this; this.children.push(child); return child; }
  contains(child: Element): boolean { return child === this || this.children.some(c => c.contains(child)); }
  querySelectorAll(selector: string): Element[] {
    assert.equal(selector, 'aside');
    return this.children.flatMap(c => [...(c.tagName === 'ASIDE' ? [c] : []), ...c.querySelectorAll(selector)]);
  }
  closest(selector: string): Element | null {
    assert.equal(selector, ROOT);
    return this.composer ? this : this.parent?.closest(selector) ?? null;
  }
  setAttribute(key: string, value: string) { this.attributes.set(key, value); }
  removeAttribute(key: string) { this.attributes.delete(key); }
}

type Fiber = {
  memoizedProps: Record<string, unknown>;
  stateNode?: unknown;
  return?: Fiber;
  child?: Fiber;
  sibling?: Fiber;
  alternate?: Fiber;
};
function attach(aside: Element, props: Record<string, unknown>) {
  const host: Fiber = { stateNode: aside, memoizedProps: {} };
  const owner: Fiber = { memoizedProps: props, child: host };
  host.return = owner;
  Object.assign(aside, { __reactFiber$test: host });
  return { host, owner };
}
function fixture() {
  let now = 0;
  let sequence = 0;
  const roots: Element[] = [];
  const observers: { callback: () => void; root?: Element; connected: boolean }[] = [];
  const intervals = new Map<number, () => void>();
  const frames = new Map<number, () => void>();
  const window: Record<string, any> = {
    setInterval: (callback: () => void) => { const id = ++sequence; intervals.set(id, callback); return id; },
    clearInterval: (id: number) => intervals.delete(id),
    requestAnimationFrame: (callback: () => void) => { const id = ++sequence; frames.set(id, callback); return id; },
    cancelAnimationFrame: (id: number) => frames.delete(id),
  };
  const context = vm.createContext({
    window,
    document: { querySelectorAll: (selector: string) => { assert.equal(selector, ROOT); return roots; } },
    Date: { now: () => now },
    MutationObserver: class {
      record: typeof observers[number];
      constructor(callback: () => void) { this.record = {callback, connected: false}; observers.push(this.record); }
      observe(root: Element, options: unknown) {
        assert.deepEqual(JSON.parse(JSON.stringify(options)), {childList: true, subtree: true});
        assert.ok(root.composer, 'observation must stay within a composer root');
        Object.assign(this.record, {root, connected: true});
      }
      disconnect() { this.record.connected = false; }
    },
  });
  return {
    roots, window, observers, intervals, frames,
    inject: (enabled = true, session = 'one') => vm.runInContext(source + '(' + enabled + ', ' + JSON.stringify(session) + ')', context),
    mutate: () => {
      observers.filter(o => o.connected).forEach(o => o.callback());
      const callbacks = [...frames.values()]; frames.clear(); callbacks.forEach(cb => cb());
    },
    advance: (ms: number) => { now += ms; [...intervals.values()].forEach(cb => cb()); },
    root: () => { const root = new Element('div', true); roots.push(root); return root; },
  };
}
function hidden(aside: Element) { return aside.style.getPropertyValue('display') === 'none'; }

test('only API Service desktop launches default on; explicit choices override all bindings', () => {
  for (const binding of ['__api_service__', 'oauth', 'deepseek', '__provider_gateway__:key', 'api-key', null]) {
    assert.equal(resolveNativeQuotaBannerPreference(undefined, binding), binding === '__api_service__');
    assert.equal(resolveNativeQuotaBannerPreference(false, binding), false);
    assert.equal(resolveNativeQuotaBannerPreference(true, binding), true);
    assert.equal(resolveNativeQuotaBannerPreference(undefined, binding, 'cli'), false);
  }
});

test('all supported semantic paths hide independently of language', () => {
  const f = fixture(), root = f.root();
  const props = [
    {banner: {banner_type: TYPE}},
    {rateLimitStatus: {rate_limit_upsell: {banner_type: TYPE}}},
    {usageBannerProps: {rateLimit: {rate_limit_upsell: {banner_type: TYPE}}}},
  ];
  for (const language of ['中文', 'English', '日本語', '한국어']) {
    for (const p of props) {
      const aside = root.append(new Element('aside', false, language));
      attach(aside, p);
    }
  }
  f.inject();
  for (const aside of root.children) {
    assert.ok(hidden(aside));
    assert.equal(aside.attributes.get(MARK), TYPE);
  }
});

test('unknown, reserve, image, safety and no-Fiber banners remain visible', () => {
  const f = fixture(), root = f.root();
  for (const type of ['unknown', 'luna_reserve', 'image_generation_limit_reached', 'safety', 'windows_sandbox']) {
    attach(root.append(new Element('aside')), {banner: {banner_type: type}});
  }
  root.append(new Element('aside', false, 'Codex 和工作使用额度已用完'));
  const rail = root.append(new Element('div'));
  const editor = rail.append(new Element('div'));
  f.inject();
  assert.ok(root.children.every(e => !hidden(e)));
  assert.ok(!hidden(editor));
});

test('shared usage props cannot hide a sibling environment warning', () => {
  const f = fixture(), root = f.root();
  const warning = root.append(new Element('aside'));
  const quota = root.append(new Element('aside'));
  const safety = attach(warning, {});
  const usage = attach(quota, {banner: {banner_type: TYPE}});
  const shared: Fiber = {memoizedProps: {usageBannerProps: {rateLimit: {rate_limit_upsell: {banner_type: TYPE}}}}, child: safety.owner};
  safety.owner.return = shared; safety.owner.sibling = usage.owner; usage.owner.return = shared;
  f.inject();
  assert.ok(hidden(quota));
  assert.ok(!hidden(warning));
});

test('ancestor host boundary and conflicting identities fail closed', () => {
  const f = fixture(), root = f.root();
  const warning = root.append(new Element('aside'));
  const {owner} = attach(warning, {});
  owner.return = {stateNode: root, memoizedProps: {banner: {banner_type: TYPE}}};
  const conflicting = root.append(new Element('aside'));
  attach(conflicting, {banner: {banner_type: TYPE}, rateLimitStatus: {rate_limit_upsell: {banner_type: 'safety'}}});
  f.inject();
  assert.ok(!hidden(warning)); assert.ok(!hidden(conflicting));
});

test('disable restores original display including !important and disconnects observers', () => {
  const f = fixture(), root = f.root();
  const original = root.append(new Element('aside'));
  original.style.setProperty('display', 'flex', 'important');
  const blank = root.append(new Element('aside'));
  attach(original, {banner: {banner_type: TYPE}}); attach(blank, {banner: {banner_type: TYPE}});
  f.inject(); f.inject(false);
  assert.equal(original.style.getPropertyValue('display'), 'flex');
  assert.equal(original.style.getPropertyPriority('display'), 'important');
  assert.equal(blank.style.getPropertyValue('display'), '');
  assert.ok(!original.attributes.has(MARK));
  assert.ok(f.observers.every(o => !o.connected));
  assert.equal(f.intervals.size, 0); assert.equal(f.frames.size, 0);
});

test('React redraw, reused warning node and root replacement reconcile without leaked observers', () => {
  const f = fixture(), root = f.root();
  f.inject();
  const aside = root.append(new Element('aside'));
  const {owner} = attach(aside, {banner: {banner_type: TYPE}});
  f.mutate(); assert.ok(hidden(aside));
  owner.memoizedProps = {banner: {banner_type: 'safety'}};
  f.inject(); assert.ok(!hidden(aside));
  owner.memoizedProps = {banner: {banner_type: TYPE}};
  f.inject(); assert.ok(hidden(aside));
  f.roots.splice(0);
  const replacement = f.root(), next = replacement.append(new Element('aside'));
  attach(next, {banner: {banner_type: TYPE}});
  f.inject();
  assert.ok(!hidden(aside)); assert.ok(hidden(next));
  assert.equal(f.observers.filter(o => o.connected).length, 1);
  f.inject(); assert.equal(f.observers.filter(o => o.connected).length, 1);
});

test('reads the current React alternate instead of stale quota props', () => {
  const f = fixture(), root = f.root(), aside = root.append(new Element('aside'));
  const {host, owner} = attach(aside, {banner: {banner_type: TYPE}});
  const current: Fiber = {memoizedProps: {}};
  const oldRoot: Fiber = {memoizedProps: {}, stateNode: {current}};
  owner.return = oldRoot;
  const currentOwner: Fiber = {memoizedProps: {banner: {banner_type: 'safety'}}, return: current};
  const currentHost: Fiber = {memoizedProps: {}, stateNode: aside, return: currentOwner};
  currentOwner.child = currentHost; host.alternate = currentHost;
  f.inject(); assert.ok(!hidden(aside));
});

test('late cleanup from an old session cannot destroy a replacement session', () => {
  const f = fixture(), root = f.root(), aside = root.append(new Element('aside'));
  attach(aside, {banner: {banner_type: TYPE}});
  f.inject(true, 'old'); f.inject(true, 'new'); f.inject(false, 'old');
  assert.ok(hidden(aside)); assert.equal(f.window.__cockpitNativeQuotaSuppression.session, 'new');
  f.inject(false, 'new'); assert.ok(!hidden(aside));
});

test('host disappearance restores warnings; document reload has no retained hook', () => {
  const f = fixture(), root = f.root(), aside = root.append(new Element('aside'));
  attach(aside, {banner: {banner_type: TYPE}});
  f.inject(); f.advance(31000);
  assert.ok(!hidden(aside)); assert.equal(f.window.__cockpitNativeQuotaSuppression, undefined);
  assert.ok(f.observers.every(o => !o.connected));
  const reloaded = fixture(), reloadedAside = reloaded.root().append(new Element('aside'));
  attach(reloadedAside, {banner: {banner_type: TYPE}});
  reloaded.inject(false); assert.ok(!hidden(reloadedAside));
});

test('missing composer, unreadable Fiber and cyclic Fiber do not hide anything', () => {
  const f = fixture(); f.inject();
  const root = f.root(), aside = root.append(new Element('aside'));
  const {host, owner} = attach(aside, {});
  owner.return = host;
  f.inject(); assert.ok(!hidden(aside));
  Object.defineProperty(aside, '__reactFiber$test', {get() {throw Error('private API changed');}});
  f.inject(); assert.ok(!hidden(aside));
});
