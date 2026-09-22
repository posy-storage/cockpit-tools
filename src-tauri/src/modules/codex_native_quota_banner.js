// Evaluated by the existing per-profile CDP loop. Intentionally NOT registered
// as a new-document script: a stale launch option must never survive a reload.
((enabled, session) => {
  const KEY = '__cockpitNativeQuotaSuppression';
  const ROOT = '[data-codex-composer-root][data-composer-placement]';
  const MARK = 'data-cockpit-native-banner-hidden';
  const TYPES = new Set(['workspace_member_credits_depleted']);
  const VERSION = 1;
  const previous = window[KEY];
  if (!enabled) {
    if (previous?.session === session) previous.destroy();
    return;
  }
  if (previous?.version === VERSION && previous.session === session) {
    previous.heartbeatAt = Date.now();
    previous.scan();
    return;
  }
  previous?.destroy();

  const observers = new Map();
  const originalDisplay = new Map();
  let frame = null;
  let destroyed = false;
  let watchdog;

  function getFiber(element) {
    const key = Object.keys(element).find(name =>
      name.startsWith('__reactFiber$') || name.startsWith('__reactInternalInstance$'));
    const fiber = key ? element[key] : null;
    if (!fiber) return null;
    // React may keep the DOM pointer on the alternate from the previous commit.
    let top = fiber;
    for (let depth = 0; top.return && depth < 128; depth++) top = top.return;
    if (top.return) return null;
    const current = top.stateNode?.current;
    return current && current !== top ? fiber.alternate ?? null : fiber;
  }

  function ownsOnlyThisAside(fiber, aside) {
    const pending = fiber.child ? [fiber.child] : [];
    const seen = new Set();
    while (pending.length) {
      const node = pending.pop();
      if (seen.has(node) || seen.size >= 256) return false;
      seen.add(node);
      if (node.stateNode?.tagName === 'ASIDE' && node.stateNode !== aside) return false;
      if (node.child) pending.push(node.child);
      if (node.sibling) pending.push(node.sibling);
    }
    return true;
  }

  function identity(aside) {
    try {
      let fiber = getFiber(aside);
      const seen = new Set();
      for (let depth = 0; fiber && depth < 24; depth++, fiber = fiber.return) {
        if (seen.has(fiber)) return null;
        seen.add(fiber);
        // Never inherit UsageBanner state from a shared composer/stack DOM parent.
        const node = fiber.stateNode;
        if (node?.nodeType === 1 && node !== aside && !aside.contains(node)) return null;
        if (!ownsOnlyThisAside(fiber, aside)) return null;
        const p = fiber.memoizedProps;
        if (!p || typeof p !== 'object') continue;
        const types = [
          p.banner?.banner_type,
          p.rateLimitStatus?.rate_limit_upsell?.banner_type,
          p.usageBannerProps?.rateLimit?.rate_limit_upsell?.banner_type,
        ].filter(type => typeof type === 'string');
        if (types.length) return types.every(type => type === types[0]) ? types[0] : null;
      }
    } catch {
      // React internals are not a public contract. An unreadable identity stays visible.
    }
    return null;
  }

  function restore(aside) {
    const old = originalDisplay.get(aside);
    if (!old) return;
    if (old.value) aside.style.setProperty('display', old.value, old.priority);
    else aside.style.removeProperty('display');
    aside.removeAttribute(MARK);
    originalDisplay.delete(aside);
  }
  function restoreAll() {
    for (const aside of originalDisplay.keys()) restore(aside);
  }
  function schedule() {
    if (destroyed || frame !== null) return;
    frame = window.requestAnimationFrame(() => { frame = null; scan(); });
  }
  function scan() {
    if (destroyed) return;
    const roots = new Set(document.querySelectorAll(ROOT));
    for (const [root, observer] of observers) {
      if (!roots.has(root)) { observer.disconnect(); observers.delete(root); }
    }
    const matched = new Set();
    for (const root of roots) {
      if (!observers.has(root)) {
        const observer = new MutationObserver(schedule);
        observer.observe(root, { childList: true, subtree: true });
        observers.set(root, observer);
      }
      for (const aside of root.querySelectorAll('aside')) {
        if (aside.closest(ROOT) !== root) continue;
        const type = identity(aside);
        if (!TYPES.has(type)) continue;
        matched.add(aside);
        if (!originalDisplay.has(aside)) {
          originalDisplay.set(aside, {
            value: aside.style.getPropertyValue('display'),
            priority: aside.style.getPropertyPriority('display'),
          });
        }
        aside.setAttribute(MARK, type);
        aside.style.setProperty('display', 'none', 'important');
      }
    }
    // React can reuse a node for a different warning, or remove the entire root.
    for (const aside of originalDisplay.keys()) if (!matched.has(aside)) restore(aside);
  }
  function destroy() {
    destroyed = true;
    for (const observer of observers.values()) observer.disconnect();
    observers.clear();
    if (frame !== null) window.cancelAnimationFrame(frame);
    window.clearInterval(watchdog);
    restoreAll();
    if (window[KEY] === runtime) delete window[KEY];
  }
  const runtime = { version: VERSION, session, heartbeatAt: Date.now(), scan, restoreAll, destroy };
  window[KEY] = runtime;
  // Fails open visually if Cockpit crashes, disconnects, or exits before cleanup.
  // This timer only restores; it is not another injection/scanning loop.
  watchdog = window.setInterval(() => {
    if (Date.now() - runtime.heartbeatAt > 30000) destroy();
  }, 1000);
  scan();
})
