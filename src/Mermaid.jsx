import { useEffect, useState, useRef } from 'react';
import mermaid from 'mermaid';

mermaid.initialize({
  startOnLoad: false,
  theme: "default",
  securityLevel: "strict",
  themeCSS: `
    g.classGroup rect {
      fill: #282a36;
      stroke: #6272a4;
    } 
    g.classGroup text {
      fill: #f8f8f2;
    }
    g.classGroup line {
      stroke: #f8f8f2;
      stroke-width: 0.5;
    }
    .classLabel .box {
      stroke: #21222c;
      stroke-width: 3;
      fill: #21222c;
      opacity: 1;
    }
    .classLabel .label {
      fill: #f1fa8c;
    }
    .relation {
      stroke: #ff79c6;
      stroke-width: 1;
    }
    #compositionStart, #compositionEnd {
      fill: #bd93f9;
      stroke: #bd93f9;
      stroke-width: 1;
    }
    #aggregationEnd, #aggregationStart {
      fill: #21222c;
      stroke: #50fa7b;
      stroke-width: 1;
    }
    #dependencyStart, #dependencyEnd {
      fill: #00bcd4;
      stroke: #00bcd4;
      stroke-width: 1;
    } 
    #extensionStart, #extensionEnd {
      fill: #f8f8f2;
      stroke: #f8f8f2;
      stroke-width: 1;
    }`,
  fontFamily: '"helvetica neue", arial, helvetica, "lucida grande", sans-serif',
  fontSize: 14,
});


export default function MermaidChart({ chart }) {
  const mermaidRef = useRef(null);
  const [id] = useState(`mermaidChar${Math.random().toString(10).substring(2)}`);
  const [rerender, setRerender] = useState(0);

  useEffect(() => {
    let resizeObserver;
    if (mermaidRef && mermaidRef.current) {
      resizeObserver = new ResizeObserver(() => { setRerender(v => v + 1); });
      resizeObserver.observe(mermaidRef.current);
    }
    return () => resizeObserver?.disconnect();
  }, [mermaidRef]);

  useEffect(() => {
    if (mermaidRef && mermaidRef.current) {
      async function fn() {
        try {
          const { svg, bindFunctions } = await mermaid.render(id, chart, mermaidRef.current);
          mermaidRef.current.innerHTML = svg;
          bindFunctions?.(mermaidRef.current);
        } catch (e) {
          mermaidRef.current.innerText = `${e}\n${chart}`
        }
      }
      fn();
    }
  }, [chart, mermaidRef, id, rerender]);

  return <div ref={mermaidRef}></div>
};