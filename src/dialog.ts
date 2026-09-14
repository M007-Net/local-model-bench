import {useEffect,useRef} from 'react';

const FOCUSABLE='a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),summary,[tabindex]:not([tabindex="-1"])';

/**
 * Modal behaviour the markup cannot express on its own: move focus into the
 * dialog, keep Tab inside it, close on Escape, and put focus back where it was
 * when the dialog goes away. `role="dialog"` and `aria-modal` only tell a
 * screen reader what the element is; neither stops the browser from tabbing
 * straight past it into the page behind.
 *
 * Returns a ref to attach to the dialog element.
 */
export function useModalDialog<T extends HTMLElement>(onClose:()=>void){
 const ref=useRef<T|null>(null);
 // Kept in a ref so a parent that re-creates its close handler on every render
 // does not tear down and reinstall the key listener each time.
 const close=useRef(onClose);close.current=onClose;

 useEffect(()=>{
  const opener=document.activeElement as HTMLElement|null;
  const focusable=()=>Array.from(ref.current?.querySelectorAll<HTMLElement>(FOCUSABLE)??[]).filter(el=>el.offsetParent!==null||el===document.activeElement);
  // Prefer the first real control over the close button, so a keyboard user
  // lands on the thing they came to edit.
  const first=focusable();
  (first.find(el=>!el.hasAttribute('aria-label')||!/^close/i.test(el.getAttribute('aria-label')||''))??first[0]??ref.current)?.focus();

  const onKeyDown=(event:KeyboardEvent)=>{
   if(event.key==='Escape'){event.preventDefault();close.current();return;}
   if(event.key!=='Tab')return;
   const items=focusable();
   if(!items.length){event.preventDefault();ref.current?.focus();return;}
   const edge=event.shiftKey?items[0]:items[items.length-1];
   // Also catches focus that has escaped the dialog entirely, which is what
   // happens when the browser moves on to its own chrome and back.
   if(document.activeElement===edge||!ref.current?.contains(document.activeElement)){
    event.preventDefault();
    (event.shiftKey?items[items.length-1]:items[0]).focus();
   }
  };
  document.addEventListener('keydown',onKeyDown,true);
  return ()=>{
   document.removeEventListener('keydown',onKeyDown,true);
   // The opener can be gone by now, for instance a row the dialog deleted.
   if(opener&&document.contains(opener))opener.focus();
  };
 },[]);

 return ref;
}
