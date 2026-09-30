import { splitBlock, setBlock, pairNode, textOf } from './editor.js?v=20260930.2';
const containers = 'section,.publication,.card';
const keyOf = el => el?.dataset.ttdNode || el?.dataset.ttdId;
export function findEntry(root, key) {
  return outline(root).find(entry => entry.key === key);
}
export function headingOf(el) {
  return [...el.children].find(c => /^H[1-4]$/.test(c.tagName)) || null;
}
export function outline(root) {
  const entries = [];
  for (const el of root.querySelectorAll(containers + ',[data-ttd-id]')) {
    if (el.dataset.ttdPairEn) continue;
    if (el.parentElement.matches(containers) && headingOf(el.parentElement) === el) continue;
    const structural = el.matches(containers);
    const heading = structural ? headingOf(el) : el;
    const kind = el.tagName === 'SECTION' ? 'section' : el.matches('.publication') ? 'subsection' : el.matches('.card') ? 'card' : el.tagName === 'H4' ? 'group' : (el.tagName === 'A' && el.closest('nav')) ? 'navigation' : 'item';
    const label = heading ? textOf(splitBlock(heading, root).zh) : '';
    const scope = el.closest('section');
    let depth = 0, parent = el.parentElement;
    while (parent && parent !== root) { if (parent.matches(containers)) depth++; parent = parent.parentElement; }
    entries.push({ key: keyOf(el), el, heading, kind, label: label || '（空白内容，可继续编辑）', scope: keyOf(scope) || 'layout', depth });
  }
  return entries;
}
export function nodesOf(entry, root) {
  if (entry.kind === 'group') {
    const list = [entry.el];
    let next = entry.el.nextElementSibling;
    while (next && !/^H[1-4]$/.test(next.tagName)) { list.push(next); next = next.nextElementSibling; }
    return list;
  }
  const pair = pairNode(entry.el, root);
  return pair ? [entry.el, pair] : [entry.el];
}
function removeLinks(root, ids) {
  for (const link of root.querySelectorAll('header nav a[href^="#"]')) {
    if (!ids.has(link.getAttribute('href').slice(1))) continue;
    const li = link.closest('li');
    // Preserve unrelated child navigation if a custom hierarchy uses it.
    for (const child of [...(li?.querySelectorAll(':scope>ul>li') || [])]) {
      const target = child.querySelector('a')?.getAttribute('href')?.slice(1);
      if (target && !ids.has(target)) li.before(child);
    }
    (li || link).remove();
  }
  root.querySelectorAll('header li.dropdown').forEach(li => {
    if (!li.querySelector('li')) { li.querySelector('ul')?.remove(); li.classList.remove('dropdown'); }
  });
}
export function deleteEntry(root, key) {
  const entry = findEntry(root, key);
  if (!entry) throw new Error('这条内容已改变，请刷新管理面板。');
  const nodes = nodesOf(entry, root), ids = new Set();
  nodes.forEach(n => { if (n.id) ids.add(n.id); n.querySelectorAll('[id]').forEach(e => ids.add(e.id)); });
  removeLinks(root, ids);
  if (entry.kind === 'navigation') {
    const li = entry.el.closest('li');
    for (const child of [...(li?.querySelectorAll(':scope>ul>li') || [])]) li.before(child);
    (li || entry.el).remove(); return;
  }
  // Keep editable anchors for layout text, including an emptied page name/footer.
  if (entry.el.matches('.logo,[data-ttd-footer]') || /^H[1-3]$/.test(entry.el.tagName)) {
    setBlock(entry.el, root, '', '', false); return;
  }
  const parent = entry.el.parentElement;
  nodes.forEach(n => n.remove());
  if (parent.matches('.cards') && !parent.children.length) parent.remove();
}
export function moveEntry(root, key, direction) {
  const entry = findEntry(root, key);
  if (!entry || !['up','down'].includes(direction)) throw new Error('无法定位需要移动的内容。');
  const nodes = nodesOf(entry, root);
  if (entry.kind === 'navigation') {
    const li = entry.el.closest('li');
    const other = direction === 'up' ? li?.previousElementSibling : li?.nextElementSibling;
    if (!other) throw new Error('已到达本组边界。');
    other.parentElement.insertBefore(li, direction === 'up' ? other : other.nextSibling); return;
  }
  let peer;
  if (entry.kind === 'group') {
    const candidates = outline(root).filter(e => e.kind === 'group' && e.el.parentElement === entry.el.parentElement);
    peer = candidates[candidates.findIndex(e => e.el === entry.el) + (direction === 'up' ? -1 : 1)];
  } else {
    let node = direction === 'up' ? nodes[0].previousElementSibling : nodes.at(-1).nextElementSibling;
    if (node?.dataset.ttdPairEn) node = root.querySelector('[data-ttd-pair="' + CSS.escape(node.dataset.ttdPairEn) + '"]');
    peer = outline(root).find(e => e.el === node && e.kind === entry.kind && (['section','subsection','card'].includes(entry.kind) || e.el.tagName === entry.el.tagName));
  }
  if (!peer) throw new Error('已到达本组边界；跨栏目移动请使用“移动到”。');
  const peerNodes = nodesOf(peer, root), parent = entry.el.parentElement;
  const anchor = direction === 'up' ? peerNodes[0] : peerNodes.at(-1).nextSibling;
  nodes.forEach(n => parent.insertBefore(n, anchor));
  if (['section','subsection'].includes(entry.kind)) syncNavigationOrder(root);
}
export function syncNavigationOrder(root) {
  const order = [...root.querySelectorAll('[id]')].map(e => e.id);
  for (const ul of root.querySelectorAll('header nav ul')) {
    [...ul.children].sort((a,b) => {
      const index = li => { const id = li.querySelector(':scope>a')?.getAttribute('href')?.slice(1); const i = order.indexOf(id); return i < 0 ? Number.MAX_SAFE_INTEGER : i; };
      return index(a)-index(b);
    }).forEach(li => ul.append(li));
  }
}
export function transferEntry(root, key, target, placement = 'end') {
  const entry = findEntry(root, key);
  if (!entry || !target || entry.el.contains(target)) throw new Error('请选择其他有效栏目。');
  if (entry.kind !== 'item' || !entry.el.matches('p,.review-list>div')) throw new Error('“移动到”用于正文条目、课程和评审记录；栏目请使用上移或下移。');
  const isReview = entry.el.parentElement.matches('.review-list');
  if (isReview !== target.matches('.review-list')) throw new Error(isReview ? '评审记录只能移动到评审列表。' : '正文、论文和课程不能放入评审列表。');
  const nodes = nodesOf(entry, root);
  if (nodes.some(n => n === target)) throw new Error('不能移动到自身。');
  let parent = target, anchor = null;
  if (target.tagName === 'H4') {
    parent = target.parentElement; anchor = target.nextElementSibling;
    if (placement !== 'start') while (anchor && !/^H[1-4]$/.test(anchor.tagName)) anchor = anchor.nextElementSibling;
  } else if (placement === 'start') anchor = [...target.children].find(e => !/^H[1-3]$/.test(e.tagName)) || null;
  // Detach first, then recompute the insertion anchor for moves within the same group.
  if (nodes.includes(anchor)) anchor = nodes.at(-1).nextSibling;
  nodes.forEach(n => parent.insertBefore(n, anchor));
}
export function updateCaptionLinks(root, el, zh, en, pending) {
  if (/^H[1-4]$/.test(el.tagName) && el.parentElement.matches('section,.publication') && headingOf(el.parentElement) === el) {
    for (const nav of root.querySelectorAll('header a')) if (nav.getAttribute('href') === '#' + el.parentElement.id) setBlock(nav, root, zh, en, pending);
  }
}
