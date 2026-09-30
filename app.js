import { Cloud, SESSION_KEY } from './cloud.js';
import { clean, fragment, decorate, splitBlock, setBlock, pairNode, serialize, targetChoices, insertContent, textOf, translationParts } from './editor.js';
const $ = id => document.getElementById(id);
const cloud = new Cloud();
let page = null, user = null, editor = null, generation = 0, saving = false, translationStatus = null, translator = null;
const root = $('site-root');
function message(id, text, error = false) { $(id).textContent = text; $(id).classList.toggle('ttd-error', error); }
function sync(text, error = false) { message('ttd-sync', text, error); }
function setBusy(value) {
  saving = value;
  $('ttd-editor-form').querySelectorAll('button,select,input').forEach(b => { b.disabled = value; });
  $('ttd-zh').contentEditable = String(!value); $('ttd-en').contentEditable = String(!value);
}
function lock(text = '请使用现有云端账号登录。') {
  generation++; page = null; user = null; editor = null; translationStatus = null;
  translator?.destroy?.(); translator = null;
  root.replaceChildren(); root.hidden = true;
  document.querySelectorAll('dialog[open]').forEach(d => d.close());
  $('ttd-zh').replaceChildren(); $('ttd-en').replaceChildren(); $('ttd-target').replaceChildren(); $('ttd-api-key').value = '';
  $('ttd-editor-title').textContent = '编辑内容'; $('ttd-editor-status').textContent = ''; $('ttd-settings-status').textContent = '';
  $('ttd-toolbar').hidden = true; $('ttd-auth').hidden = false;
  document.body.classList.add('ttd-locked'); document.body.classList.remove('ttd-editing');
  document.body.style.overflow = ''; document.title = '私有主页 · 请登录';
  $('ttd-edit-toggle').setAttribute('aria-pressed', 'false'); $('ttd-edit-toggle').textContent = '编辑内容';
  setBusy(false); message('ttd-login-status', text);
}
function handleError(id, error) {
  if (error.status === 401 || (page && (!cloud.readSession() || cloud.readSession().expires_at <= Date.now() / 1000))) { lock('登录已失效，请重新登录。'); return; }
  message(id, error.message || '操作失败，请重试。', true);
}
const scripts = new Map();
function loadScript(src) {
  if (!scripts.has(src)) scripts.set(src, new Promise((resolve, reject) => {
    const script = document.createElement('script'); script.src = src;
    script.onload = resolve; script.onerror = () => { scripts.delete(src); script.remove(); reject(new Error('资源未加载')); };
    document.head.append(script);
  }));
  return scripts.get(src);
}
function wireShare() {
  const modal = root.querySelector('#share-modal'), share = root.querySelector('#share-btn');
  if (!modal || !share) return;
  const url = location.origin + location.pathname; const input = root.querySelector('#share-url'); input.value = url;
  // Sharing the URL never grants access or puts a token in the URL/QR code.
  root.querySelector('.share-description').textContent = '扫描二维码或复制网址即可访问；仍需登录同一账号。';
  const close = () => { modal.classList.remove('show'); modal.setAttribute('aria-hidden','true'); document.body.style.overflow = ''; share.focus(); };
  share.onclick = async () => {
    modal.classList.add('show'); modal.setAttribute('aria-hidden','false'); document.body.style.overflow = 'hidden';
    root.querySelector('#share-close').focus();
    const qr = root.querySelector('#qrcode'); if (qr.childElementCount) return;
    try {
      await loadScript('https://cdnjs.cloudflare.com/ajax/libs/qrcodejs/1.0.0/qrcode.min.js');
      if (!page || !qr.isConnected) return;
      qr.replaceChildren(); new window.QRCode(qr, { text: url, width: 180, height: 180, colorDark: '#12304a', colorLight: '#ffffff', correctLevel: window.QRCode.CorrectLevel.H });
    } catch { if (qr.isConnected) qr.textContent = '二维码未加载，请复制下方网址。'; }
  };
  root.querySelector('#share-close').onclick = close;
  modal.onclick = event => { if (event.target === modal) close(); };
  modal.onkeydown = event => {
    if (event.key === 'Escape') close();
    if (event.key === 'Tab') {
      const focusable = [...modal.querySelectorAll('button,input')], first = focusable[0], last = focusable.at(-1);
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    }
  };
  root.querySelector('#copy-url').onclick = async () => {
    try { await navigator.clipboard.writeText(url); root.querySelector('#copy-message').textContent = '✓ 网址已复制'; }
    catch { input.focus(); input.select(); root.querySelector('#copy-message').textContent = '请手动复制网址。'; }
  };
}
function render(next) {
  const previousCount = root.querySelector('#busuanzi_value_site_pv')?.textContent;
  page = next; root.innerHTML = clean(next.body); decorate(root);
  document.title = next.title; root.hidden = false; $('ttd-auth').hidden = true; $('ttd-toolbar').hidden = false;
  document.body.classList.remove('ttd-locked'); wireShare();
  const counter = root.querySelector('#busuanzi_value_site_pv');
  if (counter && previousCount) counter.textContent = previousCount;
  const pending = root.querySelectorAll('[data-ttd-pending=true]').length;
  sync('云端已同步 · ' + new Date(next.updated_at).toLocaleString() + (pending ? ' · 有英文待更新' : ''));
}
async function openPage() {
  const ticket = ++generation;
  try {
    const currentUser = await cloud.user(); const next = await cloud.page();
    if (ticket !== generation) return;
    user = currentUser; render(next); $('ttd-password').value = '';
    // Existing visit-count behavior is loaded only after authorization; no private text is embedded in the public shell.
    loadScript('https://busuanzi.ibruce.info/busuanzi/2.3/busuanzi.pure.mini.js').catch(() => {
      const count = root.querySelector('#busuanzi_value_site_pv'); if (count) count.textContent = '暂不可用';
    });
    cloud.translate({ action: 'status' }).then(s => { if (ticket === generation) translationStatus = s; }).catch(() => {});
  } catch (error) {
    if (ticket !== generation) return;
    lock(error.message); if (error.status === 403) await cloud.signOut().catch(() => {});
  }
}
$('ttd-login').addEventListener('submit', async event => {
  event.preventDefault(); $('ttd-login-submit').disabled = true;
  message('ttd-login-status','正在验证账号…');
  try { await cloud.signIn($('ttd-email').value.trim(), $('ttd-password').value); await openPage(); }
  catch (error) { message('ttd-login-status', /invalid login credentials/i.test(error.message) ? '邮箱或密码不正确，请重试。' : error.message, true); }
  finally { $('ttd-password').value = ''; $('ttd-login-submit').disabled = false; }
});
$('ttd-logout').onclick = async () => {
  if ((editor || saving) && !confirm('退出会放弃尚未保存的编辑，确定退出吗？')) return;
  const signOut = cloud.signOut(); lock('已退出。此设备不再显示主页内容。');
  await signOut.catch(() => message('ttd-login-status','本机已退出；网络异常导致云端会话撤销未确认。'));
};
$('ttd-edit-toggle').onclick = () => {
  const on = document.body.classList.toggle('ttd-editing');
  $('ttd-edit-toggle').setAttribute('aria-pressed', String(on)); $('ttd-edit-toggle').textContent = on ? '完成编辑' : '编辑内容';
  sync(on ? '点击需要修改的文字；每次保存都会同步云端。' : '云端已连接');
};
function openEditor(el = null, titleOnly = false) {
  if (!page || saving) return;
  const initial = titleOnly ? { zh: page.title, en: '', pending: false } : el ? splitBlock(el, root) : { zh: '', en: '', pending: false };
  editor = { ...initial, id: el?.dataset.ttdId, titleOnly, baseVersion: page.version, targets: targetChoices(root), englishEdited: false };
  $('ttd-editor-title').textContent = titleOnly ? '修改网页标题' : el ? '编辑内容' : '新增内容';
  $('ttd-add-options').hidden = !!el || titleOnly; $('ttd-zh').innerHTML = clean(initial.zh, true); $('ttd-en').innerHTML = clean(initial.en, true);
  $('ttd-en').hidden = titleOnly; $('ttd-en-label').hidden = titleOnly; $('ttd-auto-en').closest('label').hidden = titleOnly;
  $('ttd-auto-en').checked = true; $('ttd-zh-only').hidden = true;
  const movable = !!el && (el.tagName === 'P' || el.parentElement?.classList.contains('review-list'));
  for (const id of ['ttd-delete','ttd-up','ttd-down']) $(id).hidden = !movable;
  const select = $('ttd-target'); select.replaceChildren();
  editor.targets.forEach(t => select.add(new Option(t.label, t.value)));
  $('ttd-kind').value = 'paragraph'; $('ttd-placement').value = 'end';
  message('ttd-editor-status', initial.pending ? '这条内容的英文尚未更新，保存时将重试翻译。' : '');
  setBusy(false); $('ttd-editor').showModal(); $('ttd-zh').focus();
}
root.addEventListener('click', event => {
  if (!document.body.classList.contains('ttd-editing')) return;
  const item = event.target.closest('[data-ttd-id]');
  if (item) { event.preventDefault(); event.stopPropagation(); openEditor(root.querySelector('[data-ttd-id="' + CSS.escape(item.dataset.ttdId) + '"]')); }
});
$('ttd-add').onclick = () => openEditor(); $('ttd-page-title').onclick = () => openEditor(null, true);
$('ttd-en').addEventListener('input', () => { if (editor) editor.englishEdited = true; });
for (const id of ['ttd-zh','ttd-en']) $(id).addEventListener('paste', event => {
  event.preventDefault(); document.execCommand('insertText', false, event.clipboardData.getData('text/plain'));
});
document.querySelectorAll('[data-format]').forEach(button => {
  button.addEventListener('mousedown', event => event.preventDefault());
  button.onclick = () => {
    const selection = window.getSelection();
    if (!selection?.rangeCount || !selection.anchorNode?.parentElement?.closest('.ttd-rich')) return;
    let value = null;
    if (button.dataset.format === 'createLink') {
      value = prompt('请输入 https:// 开头的网址：'); if (!value || !/^https?:\/\//i.test(value)) return;
    }
    document.execCommand(button.dataset.format, false, value);
  };
});
function closeDialog(id) {
  if (saving) return;
  if (id === 'ttd-editor' && editor) {
    const dirty = clean($('ttd-zh').innerHTML,true) !== clean(editor.zh,true) || clean($('ttd-en').innerHTML,true) !== clean(editor.en,true);
    if (dirty && !confirm('放弃本次尚未保存的编辑吗？')) return;
    editor = null; $('ttd-zh').replaceChildren(); $('ttd-en').replaceChildren();
  }
  if (id === 'ttd-settings') $('ttd-api-key').value = '';
  $(id).close();
}
document.querySelectorAll('[data-close]').forEach(b => { b.onclick = () => closeDialog(b.dataset.close); });
document.querySelectorAll('dialog').forEach(dialog => dialog.addEventListener('cancel', event => { event.preventDefault(); closeDialog(dialog.id); }));
async function getLocalTranslator(statusID = 'ttd-editor-status') {
  if (!window.Translator) throw new Error('当前浏览器不支持本机翻译，请在“翻译设置”中配置云端服务。');
  if (!translator) {
    const ticket = generation;
    const created = await window.Translator.create({ sourceLanguage: 'zh', targetLanguage: 'en', monitor(monitor) {
      monitor.addEventListener('downloadprogress', event => {
        if (ticket === generation) message(statusID, '正在准备本机语言包：' + Math.round(event.loaded * 100) + '%');
      });
    } });
    if (ticket !== generation || !user) { created.destroy?.(); throw new Error('登录状态已改变，请重新登录。'); }
    translator = created;
  }
  return translator;
}
async function translateHTML(html) {
  const parts = translationParts(html); if (!parts.segments.length) return '';
  let results;
  if (!translationStatus?.configured && window.Translator) {
    const local = await getLocalTranslator(); results = [];
    for (const text of parts.segments) results.push(await local.translate(text));
  } else {
    const result = await cloud.translate({ action: 'translate', segments: parts.segments }); results = result.translations;
  }
  if (!Array.isArray(results) || results.length !== parts.nodes.length || results.some(t => typeof t !== 'string' || !t.trim())) throw new Error('翻译结果不完整，未保存。请重试或手动填写英文。');
  parts.nodes.forEach((node,index) => { node.textContent = results[index]; }); return parts.root.innerHTML;
}
async function persist(snapshot, title, expected, ticket) {
  const saved = await cloud.save(serialize(snapshot), title, expected);
  if (ticket !== generation || !user) return false;
  render(saved); return true;
}
async function commit(zhOnly = false) {
  if (!editor || saving || !page) return;
  const ctx = editor, ticket = generation; setBusy(true);
  try {
    const zh = clean($('ttd-zh').innerHTML,true); let en = clean($('ttd-en').innerHTML,true), pending = false;
    if (!textOf(zh)) throw new Error('请填写内容；删除已有条目请使用“删除本条”。');
    const changed = clean(ctx.zh,true) !== zh;
    if (ctx.titleOnly && textOf(zh).length > 200) throw new Error('网页标题不能超过 200 个字符。');
    if (!ctx.titleOnly && !zhOnly && (changed || ctx.pending) && /[\u3400-\u9fff]/.test(textOf(zh)) && $('ttd-auto-en').checked && !ctx.englishEdited) {
      message('ttd-editor-status','正在更新英文…');
      try { en = await translateHTML(zh); }
      catch (error) { $('ttd-zh-only').hidden = false; throw error; }
      if (ticket !== generation) return;
      $('ttd-en').innerHTML = en;
    } else if (zhOnly) { en = ''; pending = true; }
    if (ticket !== generation) return;
    message('ttd-editor-status','正在保存到云端…');
    const snapshot = fragment(serialize(root));
    if (!ctx.titleOnly) {
      if (ctx.id) {
        const el = snapshot.querySelector('[data-ttd-id="' + CSS.escape(ctx.id) + '"]');
        if (!el) throw new Error('原条目已改变，请重新打开编辑。');
        setBlock(el, snapshot, zh, en, pending);
        // Keep a section's navigation caption in step with explicitly edited section headings.
        if (/^H[23]$/.test(el.tagName) && el.parentElement.id && el.parentElement.id !== 'home') {
          const nav = snapshot.querySelector('header a[href="#' + CSS.escape(el.parentElement.id) + '"]');
          if (nav) setBlock(nav, snapshot, zh, en, pending);
        }
      } else {
        const targets = targetChoices(snapshot); const target = targets[Number($('ttd-target').value)]?.el;
        if (!target && $('ttd-kind').value !== 'section') throw new Error('请先选择所属栏目。');
        insertContent(snapshot, target, $('ttd-kind').value, zh, en, pending, $('ttd-placement').value);
      }
    }
    if (await persist(snapshot, ctx.titleOnly ? textOf(zh) : page.title, ctx.baseVersion, ticket)) {
      editor = null; $('ttd-editor').close(); $('ttd-zh').replaceChildren(); $('ttd-en').replaceChildren();
    }
  } catch (error) { handleError('ttd-editor-status', error); }
  finally { if (ticket === generation) setBusy(false); }
}
$('ttd-editor-form').addEventListener('submit', event => { event.preventDefault(); commit(); });
$('ttd-zh-only').onclick = () => commit(true);
async function moveOrDelete(action) {
  if (!editor?.id || saving) return;
  if (action === 'delete' && !confirm('确定删除这一条内容及其英文吗？保存后所有设备同步删除。')) return;
  const dirty = clean($('ttd-zh').innerHTML,true) !== clean(editor.zh,true) || clean($('ttd-en').innerHTML,true) !== clean(editor.en,true);
  if (action !== 'delete' && dirty) { message('ttd-editor-status','请先保存文字修改，再重新打开条目调整顺序。', true); return; }
  const ctx = editor, ticket = generation, snapshot = fragment(serialize(root));
  const item = snapshot.querySelector('[data-ttd-id="' + CSS.escape(ctx.id) + '"]'), paired = pairNode(item,snapshot);
  try {
    if (action === 'delete') { paired?.remove(); item.remove(); }
    else {
      let next = action === 'up' ? item.previousElementSibling : (paired || item).nextElementSibling;
      if (next?.dataset.ttdPairEn) next = snapshot.querySelector('[data-ttd-pair="' + CSS.escape(next.dataset.ttdPairEn) + '"]');
      if (!next || next.tagName !== item.tagName) throw new Error('已到达本组边界。');
      const anchor = action === 'up' ? next : (pairNode(next,snapshot) || next).nextSibling;
      const parent = item.parentElement; parent.insertBefore(item, anchor); if (paired) parent.insertBefore(paired, item.nextSibling);
    }
    setBusy(true);
    if (await persist(snapshot, page.title, ctx.baseVersion, ticket)) { editor = null; $('ttd-editor').close(); $('ttd-zh').replaceChildren(); $('ttd-en').replaceChildren(); }
  } catch (error) { handleError('ttd-editor-status', error); }
  finally { if (ticket === generation) setBusy(false); }
}
$('ttd-delete').onclick = () => moveOrDelete('delete'); $('ttd-up').onclick = () => moveOrDelete('up'); $('ttd-down').onclick = () => moveOrDelete('down');
async function refreshPage(force = false) {
  if (!page || saving || document.visibilityState === 'hidden') return;
  const ticket = generation;
  try {
    const metadata = await cloud.page(true); if (ticket !== generation) return;
    if (String(metadata.version) === String(page.version)) { if (force) sync('当前已是最新云端版本'); return; }
    if (editor) { sync('另一设备有更新；当前编辑已保留，保存时会检查冲突。', true); return; }
    const next = await cloud.page(); if (ticket === generation && !editor && !saving) render(next);
  } catch (error) { if (ticket === generation) handleError('ttd-sync',error); }
}
$('ttd-refresh').onclick = () => refreshPage(true);
window.setInterval(() => refreshPage(), 20000);
window.addEventListener('online', () => refreshPage(true));
window.addEventListener('pageshow', event => {
  if (event.persisted) { lock('正在重新验证登录…'); if (cloud.readSession()) openPage(); }
});
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') refreshPage(); });
window.addEventListener('beforeunload', event => { if (editor || saving) { event.preventDefault(); event.returnValue = ''; } });
window.addEventListener('storage', event => {
  if (event.key !== SESSION_KEY) return;
  if (!event.newValue) lock('此浏览器的账号已退出，请重新登录。');
  else {
    let next; try { next = JSON.parse(event.newValue); } catch { lock(); return; }
    if (user && next.user?.id !== user.id) { lock('账号已切换，正在验证权限…'); openPage(); }
  }
});
function showTranslationStatus(status) {
  translationStatus = status; if (status.provider) $('ttd-provider').value = status.provider;
  message('ttd-settings-status', status.configured ? '云端翻译已配置。密钥不会回显。' : '尚未配置云端翻译。支持本机翻译的电脑可直接启用；手机需要云端服务。');
}
$('ttd-settings-open').onclick = async () => {
  $('ttd-api-key').value = ''; $('ttd-settings').showModal(); message('ttd-settings-status','正在读取配置状态…');
  const ticket = generation;
  try { const status = await cloud.translate({ action: 'status' }); if (ticket === generation) showTranslationStatus(status); }
  catch (error) { if (ticket === generation) handleError('ttd-settings-status', error); }
};
$('ttd-settings-form').addEventListener('submit', async event => {
  event.preventDefault(); const ticket = generation; $('ttd-settings-save').disabled = true;
  message('ttd-settings-status','正在验证并加密保存配置…');
  const key = $('ttd-api-key').value.trim(); $('ttd-api-key').value = '';
  try {
    const status = await cloud.translate({ action: 'settings', provider: $('ttd-provider').value, key });
    if (ticket === generation) showTranslationStatus(status);
  } catch (error) { if (ticket === generation) handleError('ttd-settings-status', error); }
  finally { $('ttd-settings-save').disabled = false; }
});
$('ttd-clear-key').onclick = async () => {
  if (!confirm('删除云端翻译密钥？已保存的主页中英文不会被删除。')) return;
  const ticket = generation;
  try { const status = await cloud.translate({ action: 'delete' }); if (ticket === generation) showTranslationStatus(status); }
  catch (error) { if (ticket === generation) handleError('ttd-settings-status', error); }
};
$('ttd-local-translation').onclick = async () => {
  const ticket = generation;
  try { await getLocalTranslator('ttd-settings-status'); if (ticket === generation) message('ttd-settings-status','本机翻译已就绪。中文变化后会自动生成英文并一起保存到云端。'); }
  catch (error) { if (ticket === generation) message('ttd-settings-status', error.message, true); }
};
if (cloud.readSession()) { message('ttd-login-status','正在验证已有登录…'); openPage(); }
