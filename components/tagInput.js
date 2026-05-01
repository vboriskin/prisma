'use strict';
/* ============================================================
   TAG INPUT COMPONENT — v8_0 ES module
   ============================================================ */

import { state } from '../state.js';

// Tag color palette
export const TAG_PALETTE = ['#4f46e5','#059669','#d97706','#dc2626','#7c3aed','#0284c7','#db2777','#65a30d','#ea580c','#0891b2','#9333ea','#16a34a'];

export function tagColor(tag) {
  let h = 0;
  for (let i = 0; i < tag.length; i++) h = ((h << 5) - h) + tag.charCodeAt(i);
  return TAG_PALETTE[Math.abs(h) % TAG_PALETTE.length];
}

export function getUniqueTagValues(colKey) {
  const vals=new Set();
  state.rows.forEach(r=>{ const v=r[colKey]; if(!v)return; String(v).split(/[|,]/).map(s=>s.trim()).filter(Boolean).forEach(s=>vals.add(s)); });
  return [...vals].sort();
}

export function getUniqueTextValues(colKey) {
  const vals=new Set();
  state.rows.forEach(r=>{ if(r[colKey])vals.add(String(r[colKey]).trim()); });
  return [...vals].sort();
}

export function getEmployeeNames() {
  return state.employees.map(e=>String(e.fio||'').trim()).filter(Boolean).sort((a,b)=>a.localeCompare(b,'ru'));
}

export function createTagInput(initialTags, onChange, getSuggestions) {
  const wrap=document.createElement('div'); wrap.className='tag-input-wrap';
  let tags=[...(initialTags||[])];
  let suggDrop=null;
  if (getSuggestions) {
    suggDrop=document.createElement('div'); suggDrop.className='tag-suggest-drop hidden';
    suggDrop.style.cssText='position:fixed;z-index:9999;';
    document.body.appendChild(suggDrop);
    wrap._cleanup=()=>suggDrop.remove();
  }
  function renderTags() {
    wrap.innerHTML='';
    tags.forEach((tag,i)=>{
      const item=document.createElement('span'); item.className='tag-item'; item.textContent=tag;
      const c=tagColor(tag); item.style.cssText=`background:${c}20;color:${c};border:1px solid ${c}40`;
      const rm=document.createElement('span'); rm.className='tag-remove'; rm.textContent='×';
      rm.addEventListener('click',e=>{ e.stopPropagation(); tags.splice(i,1); renderTags(); if(onChange)onChange(tags.slice()); });
      item.appendChild(rm); wrap.appendChild(item);
    });
    const inp=document.createElement('input'); inp.className='tag-input-field'; inp.placeholder=tags.length?'':'Тег...'; inp.type='text';
    function addTag(v) {
      v=v.trim().replace(/,$/,'');
      if(v&&!tags.includes(v)){tags.push(v);renderTags();if(onChange)onChange(tags.slice());}
      else inp.value='';
      if(suggDrop)suggDrop.classList.add('hidden');
    }
    if (getSuggestions) {
      inp.addEventListener('input',()=>{
        const q=inp.value.trim().toLowerCase();
        const suggs=getSuggestions().filter(s=>!tags.includes(s)&&(q?s.toLowerCase().includes(q):true)).slice(0,10);
        if(!suggs.length){suggDrop.classList.add('hidden');return;}
        const r=inp.getBoundingClientRect();
        suggDrop.style.left=r.left+'px'; suggDrop.style.top=(r.bottom+2)+'px'; suggDrop.style.minWidth=Math.max(160,r.width)+'px';
        suggDrop.innerHTML=suggs.map(s=>`<div class="tag-suggest-item" data-val="${s.replace(/"/g,'&quot;')}">${s}</div>`).join('');
        suggDrop.querySelectorAll('.tag-suggest-item').forEach(item=>{ item.addEventListener('mousedown',e=>{e.preventDefault();addTag(item.dataset.val);inp.value='';}); });
        suggDrop.classList.remove('hidden');
      });
      inp.addEventListener('focus',()=>inp.dispatchEvent(new Event('input')));
      inp.addEventListener('blur',()=>setTimeout(()=>suggDrop.classList.add('hidden'),150));
    }
    inp.addEventListener('keydown',e=>{
      if((e.key==='Enter'||e.key===',')&&inp.value.trim()){e.preventDefault();addTag(inp.value);}
      if(e.key==='Backspace'&&!inp.value&&tags.length){tags.pop();renderTags();if(onChange)onChange(tags.slice());}
      if(e.key==='Escape'&&suggDrop)suggDrop.classList.add('hidden');
    });
    // V17 P9 (QA edge-case 2) — split pasted text by `, ; \t \n` so the
    // user can paste «BE, FE, QA» and get three tags, not one merged.
    inp.addEventListener('paste', (e) => {
      const text = e.clipboardData?.getData('text') || '';
      if (!/[,;\t\n]/.test(text)) return;       // no separators → default behaviour
      e.preventDefault();
      text.split(/[,;\t\n]+/).map(s => s.trim()).filter(Boolean).forEach(addTag);
      inp.value = '';
    });
    if(!getSuggestions){inp.addEventListener('blur',()=>{if(inp.value.trim())addTag(inp.value);});}
    wrap.appendChild(inp);
  }
  renderTags();
  return wrap;
}
