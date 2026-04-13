'use client';

import { NodeViewWrapper } from '@tiptap/react';
import React, { useRef, useEffect, useState } from 'react';

const SIZE_OPTIONS = ['25%', '50%', '75%', '100%', '125%', '150%', '200%'];

export default function ResizableImageComponent({ node: { attrs }, updateAttributes, selected }: any) {
  const width = attrs.width || '100%';
  const widthNum = parseInt(width);
  const scale = widthNum > 100 ? widthNum / 100 : 1;

  const renderRef = useRef<HTMLDivElement>(null);
  const [extraSpace, setExtraSpace] = useState(0);

  useEffect(() => {
    if (!renderRef.current || scale <= 1) {
      setExtraSpace(0);
      return;
    }
    const measure = () => {
      if (renderRef.current) {
        setExtraSpace(renderRef.current.offsetHeight * (scale - 1));
      }
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(renderRef.current);
    return () => ro.disconnect();
  }, [scale, attrs.src]);

  return (
    <NodeViewWrapper
      className="resizable-image-wrapper"
      style={{
        paddingBottom: extraSpace > 0 ? `${extraSpace}px` : undefined,
      }}
    >
      <div className="image-container" contentEditable={false}>
        {selected && (
          <div className="image-toolbar">
            {SIZE_OPTIONS.map(size => (
              <button
                key={size}
                className={`size-btn ${width === size ? 'active' : ''}`}
                onClick={() => updateAttributes({ width: size })}
              >
                {size}
              </button>
            ))}
          </div>
        )}
        <div
          ref={renderRef}
          style={{
            transform: scale > 1 ? `scale(${scale})` : 'none',
            transformOrigin: 'top left',
            width: widthNum <= 100 ? width : '100%',
          }}
        >
          <img
            src={attrs.src}
            alt={attrs.alt || ''}
            title={attrs.title || ''}
            style={{ display: 'block', width: '100%', borderRadius: '12px' }}
          />
        </div>
      </div>

      <style jsx>{`
        .resizable-image-wrapper {
          display: block;
          margin: 16px 0;
        }
        .image-container {
          display: block;
        }
        .image-toolbar {
          display: flex;
          gap: 4px;
          padding: 6px 8px;
          background: rgba(255, 255, 255, 0.92);
          border: 1px solid var(--border);
          border-radius: 8px;
          margin-bottom: 6px;
          flex-wrap: wrap;
          backdrop-filter: blur(10px);
          -webkit-backdrop-filter: blur(10px);
        }
        .size-btn {
          padding: 3px 10px;
          border: 1px solid var(--border);
          border-radius: 6px;
          background: var(--background);
          color: var(--foreground);
          font-size: 0.75rem;
          cursor: pointer;
          font-family: inherit;
        }
        .size-btn:hover {
          background: var(--accent);
        }
        .size-btn.active {
          background: var(--primary);
          color: white;
          border-color: var(--primary);
        }
      `}</style>
    </NodeViewWrapper>
  );
}
