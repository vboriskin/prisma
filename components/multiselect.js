'use strict';
/* ============================================================
   MULTISELECT COMPONENT — v8_0 ES module
   ============================================================ */

import { WORK_TYPES } from '../constants.js';

export const Multiselect = {
  _open: null,
  // getOptions: optional array or function returning array; falls back to WORK_TYPES
  create(currentValues, onChange, getOptions) {
    const opts = typeof getOptions === 'function' ? getOptions()
                : Array.isArray(getOptions)        ? getOptions
                : WORK_TYPES;
    const container=document.createElement('div'); container.className='ms-container';
    // V17 P11 (QA A1 + designer §4) — make the trigger a button with proper
    // aria semantics so screen-readers / keyboard users can reach and operate
    // the multiselect.
    const display=document.createElement('div'); display.className='ms-display';
    display.setAttribute('role','button');
    display.setAttribute('tabindex','0');
    display.setAttribute('aria-haspopup','listbox');
    display.setAttribute('aria-expanded','false');
    const chipsWrap=document.createElement('span'); chipsWrap.className='ms-chips';
    const arrow=document.createElement('span'); arrow.className='ms-arrow'; arrow.textContent='▾';
    function renderChips() {
      chipsWrap.innerHTML='';
      if (!currentValues||!currentValues.length) {
        const ph=document.createElement('span'); ph.className='ms-placeholder'; ph.textContent='Выбрать...'; chipsWrap.appendChild(ph);
      } else {
        currentValues.forEach(v=>{ const c=document.createElement('span'); c.className='ms-chip'; c.textContent=v; chipsWrap.appendChild(c); });
      }
    }
    renderChips();
    display.appendChild(chipsWrap); display.appendChild(arrow);
    const dd=document.createElement('div'); dd.className='ms-dropdown hidden';
    dd.setAttribute('role','listbox');
    dd.setAttribute('aria-multiselectable','true');
    dd.style.cssText='position:fixed;z-index:9999;';
    document.body.appendChild(dd);
    opts.forEach(opt=>{
      const lbl=document.createElement('label'); lbl.className='ms-option';
      const cb=document.createElement('input'); cb.type='checkbox'; cb.value=opt;
      cb.checked=(currentValues||[]).includes(opt);
      cb.addEventListener('change',()=>{
        if(cb.checked){if(!currentValues.includes(opt))currentValues.push(opt);}
        else{const i=currentValues.indexOf(opt);if(i>-1)currentValues.splice(i,1);}
        renderChips(); if(onChange)onChange(currentValues.slice());
      });
      lbl.appendChild(cb); lbl.appendChild(document.createTextNode(' '+opt)); dd.appendChild(lbl);
    });
    function openDrop() {
      if (Multiselect._open&&Multiselect._open!==dd) {
        Multiselect._open.classList.add('hidden');
        if(Multiselect._open._disp){
          Multiselect._open._disp.classList.remove('open');
          Multiselect._open._disp.setAttribute('aria-expanded','false');
        }
      }
      const r=display.getBoundingClientRect();
      dd.style.left=r.left+'px'; dd.style.top=(r.bottom+2)+'px'; dd.style.minWidth=r.width+'px';
      dd.classList.remove('hidden'); display.classList.add('open');
      display.setAttribute('aria-expanded','true');
      Multiselect._open=dd; dd._disp=display;
    }
    function closeDrop() {
      dd.classList.add('hidden'); display.classList.remove('open');
      display.setAttribute('aria-expanded','false');
      if(Multiselect._open===dd)Multiselect._open=null;
    }
    display.addEventListener('click',e=>{ e.stopPropagation(); dd.classList.contains('hidden')?openDrop():closeDrop(); });
    // V17 P11 (QA A1) — keyboard support: Enter/Space toggles, Esc closes.
    display.addEventListener('keydown',e=>{
      if (e.key==='Enter'||e.key===' ') { e.preventDefault(); dd.classList.contains('hidden')?openDrop():closeDrop(); }
      else if (e.key==='Escape' && !dd.classList.contains('hidden')) { e.preventDefault(); closeDrop(); display.focus(); }
    });
    container._cleanup=()=>dd.remove();
    container.appendChild(display);
    return container;
  },
  closeAll() {
    document.querySelectorAll('.ms-dropdown').forEach(d=>d.classList.add('hidden'));
    document.querySelectorAll('.ms-display').forEach(d=>{
      d.classList.remove('open');
      d.setAttribute('aria-expanded','false');
    });
    Multiselect._open=null;
  },
};
document.addEventListener('click',()=>Multiselect.closeAll());
// V17 P11 (QA A1 + designer §4) — global Esc to close any open multiselect.
// Idempotent guard prevents handler accumulation across module reloads.
if (!document._q2MsEscBound) {
  document._q2MsEscBound = true;
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && Multiselect._open) Multiselect.closeAll();
  });
}
