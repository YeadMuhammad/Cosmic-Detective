// src/components/ScaleContainer.tsx
import React, { useEffect, useRef, useState } from 'react';

interface ScaleContainerProps {
  children: React.ReactNode;
  width?: number;  // Base design width (e.g., 1440)
  height?: number; // Base design height (e.g., 900)
}

export const ScaleContainer: React.FC<ScaleContainerProps> = ({
  children,
  width = 1440,
  height = 900,
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(1);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const updateScale = () => {
      const parent = container.parentElement;
      if (!parent) return;

      const parentWidth = parent.clientWidth;
      const parentHeight = parent.clientHeight;

      const scaleX = parentWidth / width;
      const scaleY = parentHeight / height;
      
      // 'contain' scaling: fits the entire poster inside the screen without clipping or scrolling
      setScale(Math.min(scaleX, scaleY));
    };

    updateScale();

    const resizeObserver = new ResizeObserver(updateScale);
    resizeObserver.observe(container.parentElement || container);

    window.addEventListener('resize', updateScale);
    return () => {
      resizeObserver.disconnect();
      window.removeEventListener('resize', updateScale);
    };
  }, [width, height]);

  return (
    <div 
      ref={containerRef} 
      className="w-full h-full overflow-hidden flex items-center justify-center relative select-none"
    >
      <div
        style={{
          width: `${width}px`,
          height: `${height}px`,
          transform: `scale(${scale})`,
          transformOrigin: 'center center',
          flexShrink: 0,
        }}
        className="relative flex flex-col items-center justify-center"
      >
        {children}
      </div>
    </div>
  );
};