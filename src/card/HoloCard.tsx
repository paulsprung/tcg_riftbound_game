import { useEffect, useRef, useState, type CSSProperties } from 'react';
import type { Card } from '../data/types.ts';
import { imageAt } from '../data/useCardDb.ts';
import type { Finish } from '../pack/generate.ts';
import { CardBack } from './CardBack.tsx';
import { createTilt } from './tilt.ts';
import './holo.css';

export interface HoloCardProps {
  card: Card;
  finish: Finish;
  /** Rendered width: px, or any CSS length (e.g. '100%' to fill a grid cell). */
  width: number | string;
  /** Show the back. Toggling it flips the card over in 3D. */
  faceDown?: boolean;
  /** hover: reacts to the pointer; idle: also sways on its own; off: static. */
  tilt?: 'hover' | 'idle' | 'off';
  gyro?: boolean;
  /** Give the card visible thickness (for the big inspect view). */
  thick?: boolean;
  /** Show a landscape card (battlefield) the readable way round instead of
      sideways in a portrait frame, the way it sits in a binder. */
  upright?: boolean;
  /** Width to request from the image server. */
  imageWidth?: number;
  onClick?: () => void;
  className?: string;
  style?: CSSProperties;
}

const ETCHED: Finish[] = ['etched', 'signature', 'ultimate'];

export function HoloCard({
  card, finish, width, faceDown = false, tilt = 'hover', gyro = false, thick = false,
  upright = false, imageWidth, onClick, className = '', style,
}: HoloCardProps) {
  const scene = useRef<HTMLDivElement>(null);
  const [loaded, setLoaded] = useState(false);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (tilt === 'off' || !scene.current) return;
    const t = createTilt(scene.current, { idle: tilt === 'idle', gyro });
    return () => t.destroy();
  }, [tilt, gyro]);

  useEffect(() => { setLoaded(false); setFailed(false); }, [card.id]);

  const landscape = card.orientation === 'landscape';
  const sideways = landscape && !upright;
  const px = typeof width === 'number' ? width : 260;
  const src = imageAt(card, imageWidth ?? Math.min(744, Math.ceil(px * (window.devicePixelRatio || 1) / 50) * 50));
  const imgClass = `hc__img${sideways ? ' hc__img--sideways' : ''}`;

  return (
    <div
      ref={scene}
      className={`hc ${className}`}
      data-finish={finish}
      data-rarity={card.rarity}
      data-tilt={tilt}
      data-upright={landscape && upright ? '' : undefined}
      data-thick={thick ? '' : undefined}
      data-face-down={faceDown ? '' : undefined}
      style={{ width, ...style }}
      onClick={onClick}
      role={onClick ? 'button' : undefined}
      tabIndex={onClick ? 0 : undefined}
      onKeyDown={onClick ? (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onClick(); } } : undefined}
      aria-label={faceDown ? 'Face-down card' : `${card.name}, ${card.rarity}`}
    >
      <div className="hc__shadow" />
      <div className="hc__card">
        <div className="hc__inner">
          <div className="hc__face hc__face--front">
            {!failed && src ? (
              <img
                className={`${imgClass}${loaded ? ' is-loaded' : ''}`}
                src={src}
                alt=""
                draggable={false}
                decoding="async"
                loading="lazy"
                onLoad={() => setLoaded(true)}
                onError={() => setFailed(true)}
              />
            ) : (
              <div className="hc__fallback">
                <strong>{card.name}</strong>
                <span>{card.type} · {card.code}</span>
              </div>
            )}
            {ETCHED.includes(finish) && loaded && (
              <span className="hc__etch" aria-hidden>
                <img className={imgClass + ' is-loaded'} src={src} alt="" draggable={false} />
                <span className="hc__etch-tint" />
              </span>
            )}
            {finish === 'ultimate' && <span className="hc__fx hc__cosmos" aria-hidden />}
            <span className="hc__fx hc__prism" aria-hidden />
            <span className="hc__fx hc__foil" aria-hidden />
            <span className="hc__fx hc__sparkle" aria-hidden />
            <span className="hc__fx hc__band" aria-hidden />
            <span className="hc__fx hc__glare" aria-hidden />
          </div>
          <div className="hc__face hc__face--back">
            <CardBack />
            <span className="hc__fx hc__band" aria-hidden />
            <span className="hc__fx hc__glare" aria-hidden />
          </div>
          {thick && (
            <>
              <span className="hc__edge hc__edge--top" />
              <span className="hc__edge hc__edge--bottom" />
              <span className="hc__edge hc__edge--left" />
              <span className="hc__edge hc__edge--right" />
            </>
          )}
        </div>
      </div>
    </div>
  );
}

/**
 * The SVG filter the etched foil uses: an edge detector over the card art,
 * so the etched lines follow each card's own linework the way Riot's
 * alt-art and overnumbered foils do. Rendered once, near the app root.
 */
export function FoilDefs() {
  return (
    <svg width="0" height="0" style={{ position: 'absolute' }} aria-hidden focusable="false">
      <filter id="rb-etch" colorInterpolationFilters="sRGB" x="0" y="0" width="100%" height="100%">
        <feColorMatrix type="saturate" values="0" result="grey" />
        <feConvolveMatrix in="grey" order="3" kernelMatrix="-1 -1 -1 -1 8 -1 -1 -1 -1" preserveAlpha="true" result="edges" />
        <feComponentTransfer in="edges">
          <feFuncR type="linear" slope="5" intercept="-0.12" />
          <feFuncG type="linear" slope="5" intercept="-0.12" />
          <feFuncB type="linear" slope="5" intercept="-0.12" />
        </feComponentTransfer>
      </filter>
    </svg>
  );
}
