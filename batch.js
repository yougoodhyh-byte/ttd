// Batch drafts stay in memory. All rows are committed by ONE version-checked page update.
import { clean, fragment, splitBlock, setBlock, pairNode, serialize, targetChoices, insertContent, textOf } from './editor.js?v=20260930.2';
import { findEntry, nodesOf, updateCaptionLinks } from './structure.js?v=20260930.2';
const structuralKinds = new Set(['section', 'subsection', 'card', 'group']);
const original = el => !el.hasAttribute('data-ttd-pair-en');
const keyOf = el => el.dataset.ttdNode || el.dataset.ttdId;
const normalized = value => clean(value, true).trim();
const hasChinese = value => /[\u3400-\u9fff]/.test(textOf(value));

export function batchScope(root, key) {
  const entry = findEntry(root, key);
  if (!entry || !structuralKinds.has(entry.kind)) throw new Error('请先选择需要批量编辑的栏目、卡片或年份分组。');
  const roots = nodesOf(entry, root);
  const inside = el => roots.some(node => node === el || node.contains(el));
  const rows = [...root.querySelectorAll('[data-ttd-id]')].filter(el => original(el) && inside(el));
  const targets = targetChoices(root).filter(t => inside(t.el)).map(t => ({ key: keyOf(t.el), label: t.label, el: t.el }));
  // Favor an actual content group over appending publications below the last year.
  const preferred = targets.find(t => t.el.matches('.review-list')) ||
    targets.find(t => t.el.tagName === 'H4') || targets.find(t => t.el.matches('.card')) || targets[0];
  return { entry, rows, targets, preferred };
}

export function initBatch(api) {
  const $ = id => document.getElementById(id);
  document.body.insertAdjacentHTML('beforeend', `
  <dialog id="ttd-batch" class="ttd-dialog ttd-batch" aria-labelledby="ttd-batch-title">
    <div class="ttd-dialog-head"><h2 id="ttd-batch-title">模块批量编辑</h2><button type="button" data-batch-close aria-label="关闭批量编辑">×</button></div>
    <p id="ttd-batch-description">在同一窗口修改多条中英文、连续新增内容，最后一次保存。未改动的条目保持原样。</p>
    <div class="ttd-batch-tools">
      <label for="ttd-batch-target">新增内容放入</label><select id="ttd-batch-target"></select>
      <div class="ttd-admin-actions"><button type="button" id="ttd-batch-add">＋新增一条</button><button type="button" id="ttd-batch-add-five">＋新增 5 条</button></div>
      <details id="ttd-batch-paste"><summary>一次粘贴多条内容</summary>
        <label for="ttd-batch-paste-text">输入原文；多行课题建议用空行分隔条目</label>
        <textarea id="ttd-batch-paste-text" rows="4" placeholder="第一条内容\n\n第二条内容"></textarea>
        <label for="ttd-batch-separator">如何区分每一条</label><select id="ttd-batch-separator"><option value="blank">空行分隔（保留条目内换行）</option><option value="line">每行一条</option></select>
        <button type="button" id="ttd-batch-paste-add">拆分并加入下方草稿</button>
      </details>
      <div class="ttd-format"><span>选中文字后：</span><button type="button" data-batch-format="bold"><b>加粗</b></button><button type="button" data-batch-format="italic"><i>斜体</i></button><button type="button" data-batch-format="createLink">链接</button><button type="button" data-batch-format="removeFormat">清除格式</button></div>
    </div>
    <div id="ttd-batch-rows"></div>
    <div class="ttd-batch-footer">
      <p id="ttd-batch-count" role="status" aria-live="polite"></p>
      <p id="ttd-batch-status" class="ttd-message" role="status" aria-live="polite"></p>
      <div class="ttd-dialog-actions"><button type="button" id="ttd-batch-export">导出当前草稿</button><button type="button" data-batch-close>取消</button><button type="button" id="ttd-batch-save" class="ttd-primary">全部保存并同步</button></div>
    </div>
  </dialog>`);
  let draft = null;
  const message = (text, error = false) => { $('ttd-batch-status').textContent = text; $('ttd-batch-status').classList.toggle('ttd-error', error); };
  const live = ctx => draft === ctx && api.state().generation === ctx.generation && !!api.state().user;
  function value(row) {
    return { zh: normalized(row.zh.innerHTML), en: normalized(row.en.innerHTML) };
  }
  function changed(row) {
    const now = value(row);
    return row.deleted || now.zh !== row.initial.zh || now.en !== row.initial.en;
  }
  function counts() {
    const c = { edited: 0, added: 0, deleted: 0 };
    for (const row of draft?.rows || []) {
      if (row.id && row.deleted) c.deleted++;
      else if (!row.id && !row.deleted && (textOf(value(row).zh) || textOf(value(row).en))) c.added++;
      else if (row.id && changed(row)) c.edited++;
    }
    return c;
  }
  function updateCount() {
    const c = counts();
    $('ttd-batch-count').textContent = `已修改 ${c.edited} 条 · 新增 ${c.added} 条 · 待删除 ${c.deleted} 条`;
  }
  function setBusy(busy) {
    api.setBusy(busy);
    $('ttd-batch').querySelectorAll('button,select,input,textarea').forEach(el => { el.disabled = busy; });
    for (const row of draft?.rows || []) {
      row.zh.contentEditable = String(!busy && !row.deleted);
      row.en.contentEditable = String(!busy && !row.deleted);
      row.auto.disabled = busy || row.deleted;
    }
  }
  function makeRow(el = null, seed = '', targetKey = null) {
    const ctx = draft;
    const initial = el ? splitBlock(el, ctx.snapshot) : { zh: seed, en: '', pending: false };
    const row = { id: el?.dataset.ttdId || null, initial: { zh: normalized(initial.zh), en: normalized(initial.en), pending: initial.pending }, deleted: false };
    // A seeded pasted row is a new addition, not an unchanged original.
    if (!el) row.initial = { zh: '', en: '', pending: false };
    const fieldId = 'ttd-batch-row-' + crypto.randomUUID();
    const box = document.createElement('div'); box.className = 'ttd-batch-row'; box.dataset.rowId = row.id || fieldId;
    const header = document.createElement('div'); header.className = 'ttd-batch-row-head';
    const caption = document.createElement('strong');
    caption.textContent = el ? ((/^H[1-4]$/.test(el.tagName) ? '标题 · ' : '') + (textOf(initial.zh).slice(0,70) || '空白内容')) : '新增内容';
    header.append(caption);
    const removable = !el || el.matches('p,.review-list>div');
    if (removable) {
      const remove = document.createElement('button'); remove.type = 'button'; remove.dataset.batchDelete = 'true'; remove.className = 'ttd-danger'; remove.textContent = '移除本条';
      remove.onclick = () => {
        if (!draft || api.state().saving) return;
        row.deleted = !row.deleted; box.classList.toggle('ttd-batch-deleted', row.deleted);
        remove.textContent = row.deleted ? '撤销移除' : '移除本条';
        row.fields.hidden = row.deleted; row.autoLabel.hidden = row.deleted;
        row.zh.contentEditable = row.en.contentEditable = String(!row.deleted);
        row.note.textContent = row.deleted ? '仅在本次草稿中移除；点击“全部保存并同步”后生效。' : '';
        updateCount();
      }; header.append(remove);
    }
    box.append(header);
    if (!el) {
      const label = document.createElement('label'); label.textContent = '所属位置'; label.htmlFor = fieldId + '-target';
      row.target = document.createElement('select'); row.target.id = label.htmlFor;
      for (const t of ctx.targets) row.target.add(new Option(t.label, t.key));
      row.target.value = targetKey || $('ttd-batch-target').value;
      box.append(label, row.target);
    }
    row.fields = document.createElement('div'); row.fields.className = 'ttd-batch-fields';
    for (const [lang,labelText,html] of [['zh','中文 / 原文',initial.zh],['en','英文',initial.en]]) {
      const col = document.createElement('div');
      const label = document.createElement('label'); label.textContent = labelText; label.id = fieldId + '-' + lang + '-label'; label.htmlFor = fieldId + '-' + lang;
      const field = document.createElement('div'); field.id = label.htmlFor; field.className = 'ttd-rich';
      field.dataset.lang = lang; field.contentEditable = 'true'; field.setAttribute('role','textbox'); field.setAttribute('aria-multiline','true'); field.setAttribute('aria-labelledby',label.id);
      field.innerHTML = clean(html, true); field.addEventListener('input', updateCount);
      field.addEventListener('paste', event => { event.preventDefault(); document.execCommand('insertText',false,event.clipboardData.getData('text/plain')); });
      row[lang] = field; col.append(label,field); row.fields.append(col);
    }
    row.autoLabel = document.createElement('label'); row.autoLabel.className = 'ttd-check';
    row.auto = document.createElement('input'); row.auto.type = 'checkbox'; row.auto.checked = true;
    row.autoLabel.append(row.auto, document.createTextNode('中文变化时自动更新英文；手动填写的英文优先'));
    row.note = document.createElement('p'); row.note.className = 'ttd-batch-row-note';
    if (initial.pending) row.note.textContent = '此条英文待更新。';
    box.append(row.fields,row.autoLabel,row.note); $('ttd-batch-rows').append(box);
    row.box = box; ctx.rows.push(row); return row;
  }
  function addRows(number, texts = []) {
    if (!draft || api.state().saving) return;
    const key = $('ttd-batch-target').value;
    if (!draft.targets.some(t => t.key === key)) { message('请先选择新增内容的所属位置。',true); return; }
    if (number > 200) { message('一次粘贴最多 200 条，请分批加入。',true); return; }
    let first;
    for (let i=0; i<number; i++) {
      const span = document.createElement('div'); span.textContent = texts[i] || '';
      const row = makeRow(null,span.innerHTML.replace(/\n/g,'<br>'),key); first ||= row;
    }
    updateCount(); first?.zh.focus(); first?.box.scrollIntoView({block:'nearest'});
    message('可连续填写多条；未填写的新增空行不会保存。');
  }
  function reset() {
    if (draft) { draft.rows.length = 0; draft.snapshot.replaceChildren(); }
    draft = null;
    $('ttd-batch-rows').replaceChildren(); $('ttd-batch-target').replaceChildren();
    $('ttd-batch-paste-text').value = ''; $('ttd-batch-paste').open = false;
    $('ttd-batch-title').textContent = '模块批量编辑'; $('ttd-batch-count').textContent = ''; message('');
    $('ttd-batch').close();
  }
  function close() {
    if (api.state().saving) return;
    const c=counts();
    if ((c.edited || c.added || c.deleted || $('ttd-batch-paste-text').value.trim()) && !confirm('放弃本模块尚未保存的批量修改吗？')) return;
    reset();
  }
  function open(key) {
    const s=api.state();
    if (!s.page || !s.user || s.saving || s.editor || draft) return;
    try {
      const snapshot=fragment(serialize(s.root)); const scope=batchScope(snapshot,key);
      draft={snapshot,key,targets:scope.targets,rows:[],version:s.page.version,title:s.page.title,generation:s.generation};
      $('ttd-batch-title').textContent='批量编辑 · '+scope.entry.label;
      $('ttd-batch-target').replaceChildren(...scope.targets.map(t=>new Option(t.label,t.key)));
      if (scope.preferred) $('ttd-batch-target').value=scope.preferred.key;
      scope.rows.forEach(el=>makeRow(el)); updateCount(); setBusy(false);
      message('所有修改先保留在此窗口；“全部保存并同步”只提交一次，未改动条目保持原样。');
      $('ttd-batch').showModal();
    } catch (error) { reset(); api.error('ttd-manager-status',error); }
  }
  async function save() {
    const ctx=draft;
    if (!ctx || api.state().saving || !live(ctx)) return;
    const c=counts();
    if (!c.edited && !c.added && !c.deleted) { message('没有需要保存的改动。'); return; }
    if ($('ttd-batch-paste-text').value.trim()) { message('粘贴区还有未加入的文字。请先“拆分并加入下方草稿”，或清空粘贴区。',true); return; }
    const jobs=[];
    for (const row of ctx.rows) {
      const now=value(row);
      if (!row.id && (row.deleted || (!textOf(now.zh) && !textOf(now.en)))) continue;
      if (!row.deleted && row.id && !changed(row)) continue;
      if (!row.deleted && !textOf(now.zh)) { message('有条目缺少原文。请填写原文，或用“移除本条”删除。',true); row.zh.focus(); return; }
      if (row.deleted) { jobs.push({row,deleted:true}); continue; }
      const manual=now.en!==row.initial.en && now.en!==row.generatedEn;
      jobs.push({row,...now,manual,sourceChanged:now.zh!==row.initial.zh,pending:row.initial.pending});
    }
    if (c.deleted && !confirm(`本次将删除 ${c.deleted} 条内容及其英文，同时保存其他修改。确定继续吗？`)) return;
    setBusy(true);
    try {
      // Check for a stale draft before incurring translation calls. The PATCH also checks it atomically.
      const meta=await api.cloud.page(true);
      if (!live(ctx)) return;
      if (String(meta.version)!==String(ctx.version)) throw new Error('另一台设备已经更新了主页。本次未保存，草稿仍保留。请先“导出当前草稿”，再关闭窗口刷新云端内容。');
      let translationFailed=false, pendingCount=0, step=0;
      const snapshot=fragment(serialize(ctx.snapshot));
      for (const job of jobs) {
        if (!live(ctx)) return;
        const {row}=job;
        const el=row.id?snapshot.querySelector('[data-ttd-id="'+CSS.escape(row.id)+'"]'):null;
        if (row.id && !el) throw new Error('无法定位原条目，已停止保存；请保留草稿并刷新重试。');
        if (job.deleted) { pairNode(el,snapshot)?.remove(); el.remove(); continue; }
        if (!job.manual && row.generatedFor && row.generatedFor !== job.zh && !job.sourceChanged) {
          // The user restored the original source after a failed save: discard a stale generated translation.
          job.en = row.initial.en; row.en.innerHTML = row.initial.en;
          row.generatedEn = undefined; row.generatedFor = undefined;
        }
        if (job.manual) job.pending=false;
        else if ((job.sourceChanged || row.initial.pending) && hasChinese(job.zh) && row.auto.checked) {
          message(`正在处理英文 ${++step}… 所有内容处理后统一保存。`);
          if (row.generatedFor===job.zh) { job.en=row.generatedEn; job.pending=false; }
          else if (translationFailed) { job.en=''; job.pending=true; }
          else {
            try {
              job.en=await api.translate(job.zh);
              if (!live(ctx)) return;
              if (!textOf(job.en)) throw new Error('翻译未返回完整内容。');
              job.pending=false; row.generatedFor=job.zh; row.generatedEn=normalized(job.en); row.en.innerHTML=row.generatedEn;
            } catch (error) {
              if (!live(ctx)) return;
              if (error.status===401 || error.status===403) throw error;
              // Do not make the same failing provider call repeatedly for a large module.
              translationFailed=true; job.en=''; job.pending=true;
            }
          }
        } else if (job.sourceChanged && !job.manual) { job.en=''; job.pending=false; }
        if (job.pending) pendingCount++;
        row.note.textContent=job.pending?'原文将保存；英文待更新，可稍后在内容管理中补齐。':'';
        if (el) { setBlock(el,snapshot,job.zh,job.en,job.pending); updateCaptionLinks(snapshot,el,job.zh,job.en,job.pending); }
        else {
          const key=row.target.value;
          const target=targetChoices(snapshot).find(t=>keyOf(t.el)===key)?.el;
          if (!ctx.targets.some(t=>t.key===key) || !target) throw new Error('新增内容的所属位置已失效，未保存。');
          insertContent(snapshot,target,'paragraph',job.zh,job.en,job.pending,'end');
        }
      }
      if (!live(ctx)) return;
      if (serialize(snapshot).length>600000) throw new Error('主页内容超过容量限制，本次尚未保存。请减少本次新增内容。');
      message('正在将所有修改一次保存到云端…');
      const saved=await api.persist(snapshot,ctx.title,ctx.version,ctx.generation);
      if (!live(ctx) || !saved) return;
      reset();
      api.onSaved(`已统一保存：修改 ${c.edited} 条，新增 ${c.added} 条，删除 ${c.deleted} 条。`+(pendingCount?`其中 ${pendingCount} 条英文待更新，可在内容管理中补齐。`:''));
    } catch (error) {
      if (live(ctx)) api.error('ttd-batch-status',error);
    } finally {
      if (ctx.generation===api.state().generation) { setBusy(false); updateCount(); }
    }
  }
  $('ttd-batch-add').onclick=()=>addRows(1);
  $('ttd-batch-add-five').onclick=()=>addRows(5);
  $('ttd-batch-paste-add').onclick=()=>{
    const raw=$('ttd-batch-paste-text').value.replace(/\r\n?/g,'\n');
    const items=raw.split($('ttd-batch-separator').value==='line'?/\n/:/\n[\t ]*\n+/).map(t=>t.trim()).filter(Boolean);
    if (!items.length) { message('请先粘贴需要新增的内容。',true); return; }
    if (items.length>200) { message('一次最多加入 200 条，请分批粘贴。',true); return; }
    addRows(items.length,items); $('ttd-batch-paste-text').value='';
  };
  $('ttd-batch-save').onclick=save;
  $('ttd-batch-export').onclick=()=>{
    if (!draft || api.state().saving) return;
    // Human-readable recovery copy, not a full-page backup; never contains authentication secrets.
    const lines=['模块批量编辑草稿（尚未保存到云端）',$('ttd-batch-title').textContent,'基于主页版本：'+draft.version,''];
    for (const [i,row] of draft.rows.entries()) {
      const text=html=>{const el=fragment(html);el.querySelectorAll('br').forEach(br=>br.replaceWith('\n'));return el.textContent;};
      lines.push(`${i+1}. ${row.deleted?'待删除':row.id?'已有条目':'新增条目'}`,'原文：'+text(value(row).zh),'英文：'+text(value(row).en),'');
    }
    if ($('ttd-batch-paste-text').value.trim()) lines.push('尚未加入的粘贴内容：',$('ttd-batch-paste-text').value);
    const url=URL.createObjectURL(new Blob([lines.join('\n')],{type:'text/plain;charset=utf-8'}));
    const a=document.createElement('a');a.href=url;a.download='ttd-module-draft.txt';a.click();setTimeout(()=>URL.revokeObjectURL(url),30000);
    message('草稿已导出为文本，含私有内容，请妥善保管。这不是完整主页备份。');
  };
  $('ttd-batch').querySelectorAll('[data-batch-close]').forEach(b=>{b.onclick=close;});
  $('ttd-batch').addEventListener('cancel',event=>{event.preventDefault();close();});
  $('ttd-batch').querySelectorAll('[data-batch-format]').forEach(b=>{
    b.onmousedown=event=>event.preventDefault();
    b.onclick=()=>{
      const selection=window.getSelection();
      const field=selection?.anchorNode?.parentElement?.closest('#ttd-batch .ttd-rich');
      if (!field || api.state().saving) return;
      let link=null;
      if (b.dataset.batchFormat==='createLink') { link=prompt('请输入 https:// 开头的网址：');if(!link||!/^https?:\/\//i.test(link))return; }
      document.execCommand(b.dataset.batchFormat,false,link);updateCount();
    };
  });
  return { open, reset, isOpen:()=>!!draft };
}
