import { useEffect, useRef, useState } from 'react';
import { hashEncode } from './AppStateCodec.js';

// copyToClipboard copies the given text to the clipboard by some hacky means.
export function copyToClipboard(text) {
  const el = document.createElement('textarea');
  el.value = text;
  el.style.position = "fixed";
  el.style.top = "-2000px";
  document.body.appendChild(el);
  try {
    el.select();
    document.execCommand('copy');
  } finally {
    document.body.removeChild(el);
  }
};

export function LoadButton({ children = "Load", enabled = true, setAppState }) {
  const inputRef = useRef(null);
  const buttonRef = useRef(null);
  const [loadStarted, setLoadStarted] = useState(false);
  const handleEscape = (e) => {
    if (e.defaultPrevented) {
      return;
    }
    let key = e.key || e.keyCode;
    if (key === 'Escape' || key === 'Esc' || key === 27) {
      setLoadStarted(false);
    }
  };
  const load = () => {
    const v = inputRef.current.value;
    setLoadStarted(false);
    try {
      if (setAppState(JSON.parse(v)) && buttonRef.current) {
        buttonRef.current.classList.add('done');
        setTimeout(() => buttonRef.current.classList.remove('done'), 1000);
      }
    } catch (e) {
      alert("Failed to load from clipboard: " + e);
    }
  };
  useEffect(() => {
    if (loadStarted) {
      inputRef.current.value = '';
      inputRef.current.focus();
    }
  }, [loadStarted]);
  return (
    <>
      <button
        disabled={!enabled}
        ref={buttonRef}
        onClick={() => setLoadStarted(true)}
        style={{ display: loadStarted ? "none" : "" }}
      >{children}</button>
      <input
        ref={inputRef}
        onBlur={() => setLoadStarted(false)}
        onKeyDown={handleEscape}
        onInput={load}
        type="text"
        placeholder="Press Ctrl/Cmd+V"
        style={{ width: "10em", display: loadStarted ? "" : "none" }}
      />
    </>
  );
}

export function SaveButton({ children = "Save", appState, autorun }) {
  const save = e => {
    try {
      copyToClipboard(JSON.stringify(appState, null, 2));
      e.target.classList.add('done');
      setTimeout(() => e.target.classList.remove('done'), 1000);
    } catch (e) {
      alert("Failed to copy to clipboard: " + e);
    }
  };
  return (
    <button onClick={save}>{children}</button>
  );
}

export function CopyLinkButton({ children = "Copy Link", appState, autorun }) {
  const copy = e => {
    try {
      const url =
        window.location.href.split('#')[0] + '#' + hashEncode(appState);
      copyToClipboard(url);
      e.target.classList.add('done');
      setTimeout(() => e.target.classList.remove('done'), 1000);
    } catch (e) {
      alert("Failed to copy to clipboard: " + e);
    }

  };
  return (
    <button onClick={copy}>{children}</button>
  );
}
