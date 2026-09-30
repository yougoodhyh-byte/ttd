// Treat saved markup as untrusted: no scripts, event handlers, styles, embeds or remote resources.
const tags = new Set('HEADER NAV DIV SPAN UL OL LI A SMALL BUTTON SECTION H1 H2 H3 H4 P BR EM FOOTER STRONG B I U S SUB SUP INPUT'.split(' '));
const inline = new Set('DIV SPAN BR EM STRONG B I U S SUB SUP A'.split(' '));
const dataAttrs = new Set(['data-ttd-node','data-ttd-id','data-ttd-pair','data-ttd-pair-en','data-ttd-en','data-ttd-footer','data-ttd-pending']);
export function safeURL(value) { return /^(https?:\/\/|mailto:|#[A-Za-z][\w-]*$)/i.test(value.trim()); }
export function clean(html, richOnly = false) {
  const template = document.createElement('template');
  template.innerHTML = String(html);
  const doc = { body: template.content };
  // contenteditable uses DIV/P for Enter. Normalize to BR before nesting inside an existing paragraph.
  if (richOnly) for (const block of [...doc.body.querySelectorAll('div,p')]) {
    const content = document.createDocumentFragment();
    if (block.previousSibling && block.previousSibling.nodeName !== 'BR') content.append(document.createElement('br'));
    content.append(...block.childNodes);
    if (block.nextSibling && !['DIV','P','BR'].includes(block.nextSibling.nodeName)) content.append(document.createElement('br'));
    block.replaceWith(content);
  }
  for (const el of [...doc.body.querySelectorAll('*')]) {
    if (!(richOnly ? inline : tags).has(el.tagName)) { el.remove(); continue; }
    for (const attr of [...el.attributes]) {
      const n = attr.name;
      const keep = !richOnly && (['id','class','type','role','readonly'].includes(n) || dataAttrs.has(n) || n.startsWith('aria-'));
      if (n === 'href' && el.tagName === 'A' && safeURL(attr.value)) continue;
      if (!keep || n.startsWith('on') || (n === 'id' && (attr.value.startsWith('ttd-') || attr.value === 'site-root'))) el.removeAttribute(n);
    }
    if (el.tagName === 'INPUT') { el.type = 'text'; el.readOnly = true; }
    if (el.tagName === 'BUTTON') el.type = 'button';
    if (el.tagName === 'A' && /^https?:/i.test(el.getAttribute('href') || '')) el.setAttribute('rel','noopener noreferrer');
  }
  return template.innerHTML;
}
export function fragment(html) { const el = document.createElement('div'); el.innerHTML = clean(html); return el; }
export function englishNode(el) {
  return [...el.children].find(c => c.matches('span.english,[data-ttd-en],small') || (/^H[1-4]$/.test(el.tagName) && c.tagName === 'SPAN') || (el.classList.contains('logo') && c.tagName === 'SPAN')) || null;
}
export function pairNode(el, root) {
  return el.dataset.ttdPair ? root.querySelector('[data-ttd-pair-en="' + CSS.escape(el.dataset.ttdPair) + '"]') : null;
}
export function splitBlock(el, root) {
  const clone = el.cloneNode(true), enNode = englishNode(clone), paired = pairNode(el, root);
  let en = enNode?.innerHTML || paired?.querySelector('span')?.innerHTML || '';
  if (enNode) {
    // Remove the bilingual separator, not meaningful internal line breaks.
    let before = enNode.previousSibling;
    while (before?.nodeType === 3 && !before.textContent.trim()) { const previous = before.previousSibling; before.remove(); before = previous; }
    if (before?.nodeName === 'BR') before.remove();
    enNode.remove();
  }
  return { zh: clone.innerHTML.trim(), en: en.trim(), pending: el.dataset.ttdPending === 'true' };
}
export function setBlock(el, root, zh, en, pending = false) {
  const oldEnglish = englishNode(el), paired = pairNode(el, root);
  const enTag = oldEnglish?.tagName || (el.tagName === 'A' ? 'SMALL' : 'SPAN');
  const enClass = oldEnglish?.className || ((/^H[1-4]$/.test(el.tagName) || el.tagName === 'A' || el.classList.contains('logo')) ? '' : 'english');
  const oldData = !!oldEnglish?.hasAttribute('data-ttd-en');
  el.innerHTML = clean(zh, true);
  if (pending) el.dataset.ttdPending = 'true'; else delete el.dataset.ttdPending;
  const english = document.createElement(enTag);
  english.className = enClass;
  if (oldData) english.dataset.ttdEn = 'true';
  english.innerHTML = clean(en, true);
  if (paired) { paired.replaceChildren(english); return; }
  if (en.trim()) {
    if (!/^H[1-4]$/.test(el.tagName) && el.tagName !== 'A' && !el.classList.contains('logo')) el.append(document.createElement('br'));
    el.append(english);
  }
}
export function decorate(root) {
  root.querySelectorAll('section,.publication,.card,.review-list').forEach(el => {
    if (!el.dataset.ttdNode) el.dataset.ttdNode = 'node-' + crypto.randomUUID();
  });
  const selector = 'header .logo,header nav a,section h1,section h2,section h3,section h4,section p,footer p,.review-list>div,[data-ttd-footer]';
  root.querySelectorAll(selector).forEach(el => {
    if (el.dataset.ttdPairEn) return;
    if (!el.dataset.ttdId) el.dataset.ttdId = 'block-' + crypto.randomUUID();
  });
  root.querySelectorAll('[data-ttd-pair-en]').forEach(el => {
    const primary = root.querySelector('[data-ttd-pair="' + CSS.escape(el.dataset.ttdPairEn) + '"]');
    if (primary) el.dataset.ttdId = primary.dataset.ttdId;
  });
}
export function serialize(root) {
  const clone = root.cloneNode(true);
  clone.querySelector('#qrcode')?.replaceChildren();
  const visits = clone.querySelector('#busuanzi_value_site_pv'); if (visits) visits.textContent = '正在获取...';
  const counter = clone.querySelector('#busuanzi_container_site_pv'); if (counter) counter.removeAttribute('style');
  const share = clone.querySelector('#share-modal'); if (share) { share.classList.remove('show'); share.setAttribute('aria-hidden','true'); }
  const copied = clone.querySelector('#copy-message'); if (copied) copied.textContent = '';
  const copyBtn = clone.querySelector('#copy-url'); if (copyBtn) copyBtn.textContent = '复制网址';
  return clean(clone.innerHTML);
}
export function targetChoices(root) {
  const targets = [...root.querySelectorAll('section,.publication,.card,.review-list,section h4,footer')];
  return targets.map((el, index) => {
    const h = el.querySelector(':scope>h1,:scope>h2,:scope>h3,:scope>h4');
    const base = h ? textOf(splitBlock(h, root).zh) : el.tagName === 'FOOTER' ? '页脚' : '同行评审列表';
    const parent = el.closest('section');
    const parentTitle = parent?.querySelector(':scope>h1,:scope>h2');
    const prefix = parentTitle && parent !== el ? textOf(splitBlock(parentTitle,root).zh) + ' / ' : '';
    const label = prefix + (el.tagName === 'H4' ? textOf(splitBlock(el,root).zh) : base);
    return { el, value: String(index), label: label.trim() };
  });
}
export function insertContent(root, target, kind, zh, en, pending, placement = 'end') {
  if (!['section','subsection','card','heading','review','paragraph'].includes(kind)) throw new Error('不支持的内容类型。');
  if (target?.tagName === 'H4' && ['card','subsection','heading'].includes(kind)) target = target.parentElement;
  if (target?.matches('.review-list') && kind === 'paragraph') kind = 'review';
  if (kind !== 'section' && !target) throw new Error('请先选择所属栏目。');
  let item = document.createElement(kind === 'heading' ? 'h4' : kind === 'review' ? 'div' : 'p');
  if (kind === 'section') {
    const section = document.createElement('section'); section.id = 'custom-' + crypto.randomUUID();
    item = document.createElement('h2'); section.append(item);
    const nav = document.createElement('a'); nav.href = '#' + section.id; setBlock(nav, root, zh, en, pending);
    const li = document.createElement('li'); li.append(nav); let menu = root.querySelector('header nav>ul');
    if (!menu) throw new Error('导航结构缺失，请从历史版本恢复。');
    menu.append(li);
    root.insertBefore(section, root.querySelector('footer'));
  } else if (kind === 'subsection') {
    const section = target.closest('section');
    if (!section) throw new Error('二级栏目需要放在一级栏目中。');
    const group = document.createElement('div'); group.className = 'publication'; group.id = 'custom-' + crypto.randomUUID();
    item = document.createElement('h3'); item.className = 'sub-title'; group.append(item);
    if (placement === 'start') section.insertBefore(group, [...section.children].find(e => !/^H[1-2]$/.test(e.tagName)) || null); else section.append(group);
    const parentLink = [...root.querySelectorAll('header nav a')].find(a => a.getAttribute('href') === '#' + section.id);
    if (parentLink?.closest('li')) {
      const owner = parentLink.closest('li'); owner.classList.add('dropdown');
      let menu = owner.querySelector(':scope>ul'); if (!menu) { menu=document.createElement('ul'); menu.className='dropdown-menu'; owner.append(menu); }
      const link=document.createElement('a'); link.href='#'+group.id; setBlock(link,root,zh,en,pending);
      const li=document.createElement('li'); li.append(link); placement==='start' ? menu.prepend(li) : menu.append(li);
    }
  } else if (kind === 'card') {
    let cards = target.matches('.cards') ? target : target.querySelector(':scope>.cards');
    if (!cards) { cards = document.createElement('div'); cards.className = 'cards'; target.append(cards); }
    const card = document.createElement('div'); card.className = 'card'; item = document.createElement('h3'); card.append(item);
    placement === 'start' ? cards.prepend(card) : cards.append(card);
  } else {
    if (kind === 'review') target = target.matches('.review-list') ? target : target.querySelector('.review-list');
    if (!target) throw new Error('请在“同行评审期刊”栏目新增期刊记录。');
    if (target.tagName === 'H4') {
      let next = target.nextElementSibling;
      if (placement !== 'start') while (next && !/^H[1-4]$/.test(next.tagName)) next = next.nextElementSibling;
      target.parentElement.insertBefore(item, next);
    } else if (placement === 'start') {
      const first = [...target.children].find(e => !/^H[1-3]$/.test(e.tagName));
      target.insertBefore(item, first || null);
    } else target.append(item);
  }
  item.dataset.ttdId = 'block-' + crypto.randomUUID();
  setBlock(item, root, zh, en, pending); decorate(root); return item;
}
export function textOf(html) { const d = fragment(html); return d.textContent.trim(); }
export function translationParts(html) {
  const root = fragment(clean(html, true)); const nodes = [];
  const walk = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  while (walk.nextNode()) if (/[\u3400-\u9fff]/.test(walk.currentNode.textContent)) nodes.push(walk.currentNode);
  return { root, nodes, segments: nodes.map(n => n.textContent) };
}
