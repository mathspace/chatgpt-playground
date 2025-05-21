import "./Modal.css";
import { useCallback } from "react";

export function Modal({ onCancel, width, children, contentClassName }) {
  const stopProp = useCallback(e => e.stopPropagation(), []);
  return <div onMouseDown={onCancel} className="modal">
    <div
      onMouseDown={stopProp}
      onClick={stopProp}
      className={`content ${contentClassName}`}
      style={{ width: width }}
    >{children}</div>
  </div>;
}