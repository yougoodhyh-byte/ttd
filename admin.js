import { initBatch } from './batch.js?v=20261001.1';
import { clean, fragment, decorate, splitBlock, setBlock, serialize, targetChoices, textOf } from './editor.js?v=20260930.2';
import { outline, findEntry, deleteEntry, moveEntry, transferEntry, updateCaptionLinks } from './structure.js?v=20260930.2';
const labels = { section:'一级栏目', subsection:'二级栏目', card:'卡片', group:'分组 / 年份', navigation:'导航', item:'内容' };
export function initAdmin(api) {
  const $ = id => document.getElementById(id);
  const button = document.createElement('button'); button.id='ttd-manage'; button.type='button'; button.textContent='内容管理';
  $('ttd-add').before(button);
  document.body.insertAdjacentHTML('beforeend', `
  <dialog id="ttd-manager" class="ttd-dialog ttd-manager" aria-labelledby="ttd-manager-title">
    <div class="ttd-dialog-head"><h2 id="ttd-manager-title">内容管理</h2><button type="button" data-admin-close="ttd-manager" aria-label="关闭内容管理">×</button></div>
    <p>全部内容保存在 Supabase。修改、排序、删除和恢复都可在此完成，无需进入 GitHub。</p>
    <div class="ttd-columns"><div><label for="ttd-scope">查看范围</label><select id="ttd-scope"></select></div><div><label for="ttd-search">搜索中英文内容</label><input id="ttd-search" type="search" placeholder="论文标题、课程、课题、期刊…"></div></div>
    <div class="ttd-admin-actions"><button type="button" id="ttd-manager-add">新增内容</button><button type="button" id="ttd-new-section">新增一级栏目</button><button type="button" id="ttd-pending">补齐待更新英文</button><button type="button" id="ttd-history-open">历史版本</button><button type="button" id="ttd-export">导出备份</button><button type="button" id="ttd-import">导入备份</button></div>
    <input type="file" id="ttd-import-file" accept="application/json,.json" hidden>
    <p id="ttd-manager-status" class="ttd-message" role="status" aria-live="polite"></p>
    <div id="ttd-items"></div>
  </dialog>
  <dialog id="ttd-history" class="ttd-dialog" aria-labelledby="ttd-history-title">
    <div class="ttd-dialog-head"><h2 id="ttd-history-title">历史版本与恢复</h2><button type="button" data-admin-close="ttd-history" aria-label="关闭历史版本">×</button></div>
    <p>修改和删除前由数据库自动保留完整快照。恢复会另存为新版本，不会清空其他历史记录。</p>
    <p id="ttd-history-status" class="ttd-message" role="status" aria-live="polite"></p><div id="ttd-history-list"></div><button type="button" id="ttd-history-more">加载更早版本</button>
  </dialog>
  <dialog id="ttd-history-preview" class="ttd-dialog" aria-labelledby="ttd-preview-title">
    <div class="ttd-dialog-head"><h2 id="ttd-preview-title">版本预览</h2><button type="button" data-admin-close="ttd-history-preview" aria-label="关闭版本预览">×</button></div>
    <p id="ttd-preview-status" class="ttd-message" role="status"></p><p id="ttd-preview-info"></p><pre id="ttd-preview-text" class="ttd-preview-text"></pre>
    <div class="ttd-dialog-actions"><button type="button" data-admin-close="ttd-history-preview">取消</button><button type="button" id="ttd-restore" class="ttd-primary">恢复此版本</button></div>
  </dialog>
  <dialog id="ttd-move" class="ttd-dialog" aria-labelledby="ttd-move-title">
    <div class="ttd-dialog-head"><h2 id="ttd-move-title">移动到其他栏目</h2><button type="button" data-admin-close="ttd-move" aria-label="取消移动">×</button></div>
    <p id="ttd-move-status" class="ttd-message" role="status"></p><label for="ttd-move-target">目标栏目 / 年份 / 课程分类</label><select id="ttd-move-target"></select>
    <div class="ttd-dialog-actions"><button type="button" data-admin-close="ttd-move">取消</button><button type="button" id="ttd-move-save" class="ttd-primary">移动并同步</button></div>
  </dialog>`);
  let historyOffset=0, historyRows=[], preview=null, move=null;
  const batch = initBatch({...api, onSaved(text) { refreshContents(); status(text); }});
  const status = (text, error=false, id='ttd-manager-status') => { $(id).textContent=text; $(id).classList.toggle('ttd-error',error); };
  const ready = () => { const s=api.state(); if (!s.page || !s.user) throw new Error('请先登录。'); if (s.saving || s.editor || batch.isOpen()) throw new Error('请先完成当前编辑。'); return s; };
  function busy(value) { api.setBusy(value); document.querySelectorAll('#ttd-manager button,#ttd-history button,#ttd-history-preview button,#ttd-move button').forEach(b=>{b.disabled=value;}); }
  async function action(fn, success, id='ttd-manager-status') {
    let ticket;
    try {
      const state=ready(); ticket=state.generation; busy(true); const result=await fn(state);
      if (api.state().generation!==ticket || !api.state().user) return;
      refreshContents(); if (success) status(success,false,id); return result;
    } catch (error) { if (ticket===undefined || ticket===api.state().generation) api.error(id,error); }
    finally { if (ticket===api.state().generation) busy(false); }
  }
  function scopeOptions() {
    const old=$('ttd-scope').value, s=api.state(); $('ttd-scope').replaceChildren(new Option('全部内容','all'),new Option('导航、页眉与页脚','layout'));
    outline(s.root).filter(e=>e.kind==='section').forEach(e=>$('ttd-scope').add(new Option(e.label,e.key)));
    $('ttd-scope').value=[...$('ttd-scope').options].some(o=>o.value===old)?old:'all';
  }
  function refreshContents() {
    if (!$('ttd-manager').open || !api.state().page) return;
    scopeOptions(); const s=api.state(), term=$('ttd-search').value.trim().toLocaleLowerCase(), scope=$('ttd-scope').value;
    const entries=outline(s.root).filter(e=>(scope==='all'||e.scope===scope)&&(e.label+' '+(e.heading?.textContent||'')).toLocaleLowerCase().includes(term));
    const box=$('ttd-items'); box.replaceChildren();
    for (const entry of entries) {
      const row=document.createElement('div'); row.className='ttd-item'; row.dataset.key=entry.key;
      const description=document.createElement('div'); description.className='ttd-item-description';
      const tag=document.createElement('small'); tag.textContent=labels[entry.kind]+(entry.heading?.dataset.ttdPending==='true'?' · 英文待更新':'');
      const text=document.createElement('div'); text.textContent=entry.label; text.className='ttd-item-label'; text.title=entry.label;
      description.append(tag,text); row.append(description);
      const controls=document.createElement('div'); controls.className='ttd-item-controls';
      const addButton=(label,command)=>{const b=document.createElement('button');b.type='button';b.textContent=label;b.dataset.command=command;b.setAttribute('aria-label',label+'：'+entry.label.slice(0,65));controls.append(b);};
      addButton('编辑','edit');
      if (['section','subsection','card','group'].includes(entry.kind)) { addButton('批量编辑','batch'); addButton('在此新增','add'); }
      addButton('上移','up'); addButton('下移','down');
      if (entry.kind==='item' && entry.el.matches('p,.review-list>div')) addButton('移动到','transfer');
      addButton(['section','subsection','card','group'].includes(entry.kind)?'整组删除':'删除','delete');
      row.append(controls);box.append(row);
    }
    if (!entries.length) { const p=document.createElement('p');p.textContent='没有匹配内容，可调整搜索或新增内容。';box.append(p); }
  }
  function openAdd(entry,kind='paragraph') {
    api.edit(); const target=targetChoices(api.state().root).find(t=>t.el===entry?.el);
    if (target) $('ttd-target').value=target.value;
    $('ttd-kind').value=kind;
  }
  $('ttd-manager-add').onclick=()=>{const entry=findEntry(api.state().root,$('ttd-scope').value);openAdd(entry);};
  $('ttd-new-section').onclick=()=>openAdd(null,'section');
  $('ttd-items').onclick=event=>{
    const cmd=event.target.closest('[data-command]'),row=cmd?.closest('[data-key]');if(!cmd||!row||api.state().saving)return;
    const entry=findEntry(api.state().root,row.dataset.key); if(!entry)return;
    if(cmd.dataset.command==='batch'){batch.open(entry.key);return;}
    if(cmd.dataset.command==='edit'){if(entry.heading)api.edit(entry.heading);return;}
    if(cmd.dataset.command==='add'){openAdd(entry);return;}
    if(cmd.dataset.command==='transfer'){
      const state=ready(); move={key:entry.key,version:state.page.version};
      $('ttd-move-target').replaceChildren();targetChoices(state.root).forEach(t=>$('ttd-move-target').add(new Option(t.label,t.value)));
      $('ttd-move').showModal();return;
    }
    if(cmd.dataset.command==='delete'){
      const group=['section','subsection','card','group'].includes(entry.kind);
      if(!confirm((group?'将删除这一整组及其所有下属内容和对应导航：':'将删除此条内容及其英文：')+'\n'+entry.label.slice(0,160)+'\n可从历史版本恢复。确定继续吗？'))return;
    }
    action(async s=>{const snap=fragment(serialize(s.root));if(cmd.dataset.command==='delete')deleteEntry(snap,entry.key);else moveEntry(snap,entry.key,cmd.dataset.command);await api.persist(snap,s.page.title,s.page.version,s.generation);},'已保存到云端；原版本已自动保留。');
  };
  $('ttd-move-save').onclick=()=>action(async s=>{
    if (!move || move.version!==s.page.version) throw new Error('页面版本已改变，请重新选择移动目标。');
    const snap=fragment(serialize(s.root)),target=targetChoices(snap)[Number($('ttd-move-target').value)]?.el;
    transferEntry(snap,move.key,target);await api.persist(snap,s.page.title,s.page.version,s.generation);$('ttd-move').close();move=null;
  },'已移动并同步。','ttd-move-status');
  async function loadHistory(reset=false) {
    await action(async s=>{
      if(reset){historyOffset=0;historyRows=[];$('ttd-history-list').replaceChildren();}
      const rows=await api.cloud.request('/rest/v1/ttd_page_revisions?select=version,title,updated_at,archived_at&order=version.desc&limit=20&offset='+historyOffset);
      if(s.generation!==api.state().generation)return;
      historyRows.push(...rows);historyOffset+=rows.length;$('ttd-history-more').hidden=rows.length<20;
      for(const record of rows){const row=document.createElement('div');row.className='ttd-history-row';
        const text=document.createElement('span');text.textContent='版本 '+record.version+' · '+new Date(record.updated_at).toLocaleString();
        const b=document.createElement('button');b.type='button';b.textContent='预览 / 恢复';b.dataset.version=record.version;row.append(text,b);$('ttd-history-list').append(row);}
    },'当前版本 '+api.state().page?.version+'；恢复前可先预览正文。','ttd-history-status');
  }
  $('ttd-history-open').onclick=()=>{$('ttd-history').showModal();loadHistory(true);};
  $('ttd-history-more').onclick=()=>loadHistory();
  function showPreview(data,version,source){
    preview={...data,expectedVersion:version,source};$('ttd-preview-status').textContent='';$('ttd-preview-info').textContent=(source==='import'?'待导入备份':'历史版本 '+data.version)+' · '+data.title;
    const doc=fragment(data.body);doc.querySelectorAll('br').forEach(br=>br.replaceWith('\n'));doc.querySelectorAll('p,h1,h2,h3,h4,section').forEach(el=>el.append('\n'));
    $('ttd-preview-text').textContent=doc.textContent; $('ttd-history-preview').showModal();
  }
  $('ttd-history-list').onclick=event=>{
    const b=event.target.closest('[data-version]');if(!b)return;
    action(async s=>{const rows=await api.cloud.request('/rest/v1/ttd_page_revisions?select=version,title,body&version=eq.'+encodeURIComponent(b.dataset.version));
      if(s.generation!==api.state().generation)return;if(!rows?.[0])throw new Error('未找到该版本。');showPreview(rows[0],s.page.version,'history');
    },'','ttd-history-status');
  };
  $('ttd-restore').onclick=()=>{
    if(!preview||!confirm('将以预览内容替换当前主页。当前版本也会自动保留，确定恢复吗？'))return;
    action(async s=>{if(preview.expectedVersion!==s.page.version)throw new Error('另一设备已更新主页，请重新打开预览后再恢复。');
      const snap=fragment(preview.body);decorate(snap);await api.persist(snap,preview.title,preview.expectedVersion,s.generation);
      if(s.generation===api.state().generation){preview=null;$('ttd-preview-text').textContent='';$('ttd-history-preview').close();$('ttd-history').close();}
    },'已恢复为新的云端版本。','ttd-preview-status');
  };
  $('ttd-export').onclick=()=>{
    try{const s=ready();const data={format:'ttd-private-homepage',schemaVersion:1,exportedAt:new Date().toISOString(),title:s.page.title,body:serialize(s.root),version:s.page.version};
      const url=URL.createObjectURL(new Blob([JSON.stringify(data,null,2)],{type:'application/json'}));const a=document.createElement('a');a.href=url;a.download='homepage-backup-v'+s.page.version+'.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),30000);
      status('备份已导出。文件含完整私有正文，请妥善保管，不要上传到公开仓库。');
    }catch(error){status(error.message,true);}
  };
  $('ttd-import').onclick=()=>$('ttd-import-file').click();
  $('ttd-import-file').onchange=()=>action(async s=>{
    const file=$('ttd-import-file').files[0];$('ttd-import-file').value='';if(!file)return;
    if(file.size>4000000)throw new Error('备份文件过大。');let data;try{data=JSON.parse(await file.text());}catch{throw new Error('请选择本站导出的 JSON 备份。');}
    if(s.generation!==api.state().generation)return;
    if(data.format!=='ttd-private-homepage'||data.schemaVersion!==1||typeof data.body!=='string'||typeof data.title!=='string'||!data.title.trim()||data.title.length>200||data.body.length>600000)throw new Error('备份格式不正确，现有内容未改变。');
    const snap=fragment(data.body);if(!snap.querySelector('header nav'))throw new Error('备份缺少主页导航结构，已停止导入。');
    showPreview({...data,body:serialize(snap)},s.page.version,'import');
  },'');
  $('ttd-pending').onclick=()=>action(async s=>{
    const snap=fragment(serialize(s.root)),all=[...snap.querySelectorAll('[data-ttd-pending=true]')];
    const items=all.filter(el=>{
      if(el.tagName!=='A'||!el.closest('header'))return true;
      const target=[...snap.querySelectorAll('[id]')].find(n=>'#'+n.id===el.getAttribute('href'));
      return !target?.querySelector(':scope>h1[data-ttd-pending],:scope>h2[data-ttd-pending],:scope>h3[data-ttd-pending]');
    });
    if(!items.length){status('当前没有待更新的英文。');return;}
    // Prepare the local model in this user gesture; provider configuration is checked in translate().
    const limit=items.slice(0,20); let done=0;
    for(const el of limit){const value=splitBlock(el,snap);status('正在更新英文 '+(done+1)+' / '+limit.length+'…');
      const en=await api.translate(value.zh);if(s.generation!==api.state().generation)return;
      setBlock(el,snap,value.zh,en,false);updateCaptionLinks(snap,el,value.zh,en,false);done++;
    }
    await api.persist(snap,s.page.title,s.page.version,s.generation);status('已补齐 '+done+' 条英文'+(items.length>20?'，再次点击可继续。':'。'));
  },'');
  for(const b of document.querySelectorAll('[data-admin-close]')) b.onclick=()=>{if(!api.state().saving)$(b.dataset.adminClose).close();};
  for(const id of ['ttd-manager','ttd-history','ttd-history-preview','ttd-move']) $(id).addEventListener('cancel',e=>{if(api.state().saving)e.preventDefault();});
  $('ttd-scope').onchange=refreshContents;$('ttd-search').oninput=refreshContents;
  button.onclick=()=>{if(!api.state().page)return;$('ttd-manager').showModal();status('点击模块旁的“批量编辑”，可同时修改或新增多条，一次保存。');refreshContents();};
  return {refreshContents,hasDraft:batch.isOpen,reset(){batch.reset();historyRows=[];preview=null;move=null;historyOffset=0;for(const id of ['ttd-items','ttd-history-list','ttd-preview-info','ttd-preview-text','ttd-manager-status','ttd-history-status','ttd-preview-status','ttd-move-status'])$(id).replaceChildren();$('ttd-scope').replaceChildren();$('ttd-search').value='';$('ttd-import-file').value='';busy(false);}};
}
