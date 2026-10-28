// src/components/ResponsiveCanvas.tsx
import React, { useEffect, useRef } from 'react';

interface ResponsiveCanvasProps {
  renderContent: (ctx: CanvasRenderingContext2D, width: number, height: number) => void;
  designWidth?: number;
  designHeight?: number;
}

export const ResponsiveCanvas: React.FC<ResponsiveCanvasProps> = ({
  renderContent,
  designWidth = 1920,
  designHeight = 1080,
}) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const handleResize = () => {
      const parent = canvas.parentElement;
      if (!parent) return;

      const displayWidth = parent.clientWidth;
      const displayHeight = parent.clientHeight;
      const dpr = window.devicePixelRatio || 1;

      // 1. Set actual canvas memory size for sharp rendering
      canvas.width = displayWidth * dpr;
      canvas.height = displayHeight * dpr;

      // 2. Set display size via CSS
      canvas.style.width = `${displayWidth}px`;
      canvas.style.height = `${displayHeight}px`;

      // 3. Compute scale factor (maintains aspect ratio, 'contain' behavior)
      const scaleX = displayWidth / designWidth;
      const scaleY = displayHeight / designHeight;
      const scale = Math.min(scaleX, scaleY);

      ctx.save();
      ctx.scale(dpr * scale, dpr * scale);

      // 4. Center the composition if screen aspect ratio differs
      const offsetX = (displayWidth / scale - designWidth) / 2;
      const offsetY = (displayHeight / scale - designHeight) / 2;
      ctx.translate(offsetX, offsetY);

      // 5. Clear and invoke drawing logic
      ctx.clearRect(0, 0, designWidth, designHeight);
      renderContent(ctx, designWidth, designHeight);

      ctx.restore();
    };

    handleResize();
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, [renderContent, designWidth, designHeight]);

  return (
    <div className="w-full h-full flex items-center justify-center overflow-hidden bg-black">
      <canvas ref={canvasRef} className="block" />
    </div>
  );
};