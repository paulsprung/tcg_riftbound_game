import { useEffect, useRef, useState, useSyncExternalStore, type CSSProperties } from 'react';
import type { Card } from '../data/types.ts';
import { isReadable, useCardImage } from '../data/images.ts';
import type { Finish } from '../pack/generate.ts';
import { CardBack } from './CardBack.tsx';
import { HoloCanvas, type HoloCanvasHandle } from './HoloCanvas.tsx';
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
  /** Draw the foil with the WebGL shader (big views only; falls back to CSS
      when WebGL or a same-origin image is not available). */
  gl?: boolean;
  onClick?: () => void;
  className?: string;
  style?: CSSProperties;
}

const ETCHED: Finish[] = ['etched', 'signature', 'ultimate'];

/** The header's Subtle/Vivid switch, which lives on <html data-foil>. */
function subscribeFoil(cb: () => void) {
  const mo = new MutationObserver(cb);
  mo.observe(document.documentElement, { attributes: true, attributeFilter: ['data-foil'] });
  return () => mo.disconnect();
}
const readFoil = () => (document.documentElement.dataset.foil === 'vivid' ? 'vivid' : 'subtle');

export function HoloCard({
  card, finish, width, faceDown = false, tilt = 'hover', gyro = false, thick = false,
  upright = false, imageWidth, gl = false, onClick, className = '', style,
}: HoloCardProps) {
  const scene = useRef<HTMLDivElement>(null);
  const holo = useRef<HoloCanvasHandle>(null);
  const [loaded, setLoaded] = useState(false);
  const [broken, setBroken] = useState(false);
  // null: not tried yet; true: the shader draws the card; false: CSS foil
  const [glOk, setGlOk] = useState<boolean | null>(null);
  const foilStyle = useSyncExternalStore(subscribeFoil, readFoil, readFoil);

  useEffect(() => {
    if (tilt === 'off' || !scene.current) return;
    const t = createTilt(scene.current, { idle: tilt === 'idle', gyro, onFrame: (s) => holo.current?.update(s) });
    return () => t.destroy();
  }, [tilt, gyro]);

  useEffect(() => { setLoaded(false); setBroken(false); setGlOk(null); }, [card.id]);

  const landscape = card.orientation === 'landscape';
  const sideways = landscape && !upright;
  const px = typeof width === 'number' ? width : 260;
  const image = useCardImage(card, imageWidth ?? Math.min(744, Math.ceil(px * (window.devicePixelRatio || 1) / 50) * 50));
  const src = image.src;
  const failed = broken || image.failed;
  const imgClass = `hc__img${sideways ? ' hc__img--sideways' : ''}`;
  const glitter = (finish === 'holo' && card.rarity === 'epic') || ETCHED.includes(finish);
  const useGl = gl && glOk !== false && !!src && isReadable(src);
  const glShown = useGl && glOk === true;

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
            {src && !failed ? (
              <img
                className={`${imgClass}${loaded ? ' is-loaded' : ''}`}
                src={src}
                alt=""
                draggable={false}
                decoding="async"
                loading="lazy"
                onLoad={() => setLoaded(true)}
                onError={() => setBroken(true)}
              />
            ) : failed || !card.image ? (
              <div className="hc__fallback">
                <strong>{card.name}</strong>
                <span>{card.type} · {card.code}</span>
              </div>
            ) : (
              <div className="hc__loading" aria-hidden />
            )}
            {useGl && (
              <HoloCanvas ref={holo} src={src} finish={finish} rarity={card.rarity} style={foilStyle}
                className={`${imgClass} hc__gl${glShown ? ' is-loaded' : ''}`} onReady={setGlOk} />
            )}
            {/* CSS foil (holo.css): one colour-dodge group whose light is
                multiplied by a copy of the art, so the shine blooms where the
                ink is light and black stays black. */}
            {!glShown && finish !== 'none' && loaded && (
              <span className="hc__fx hc__shine" aria-hidden>
                {finish === 'ultimate' && <span className="hc__ice" />}
                <img className={imgClass + ' is-loaded hc__key'} src={src} alt="" draggable={false} />
                {ETCHED.includes(finish) && <span className="hc__groove" />}
                {glitter && <span className="hc__flash" />}
              </span>
            )}
            {!glShown && finish === 'signature' && loaded && (
              <span className="hc__fx hc__sig hc__sig--auto" aria-hidden>
                <img className={imgClass + ' is-loaded'} src={src} alt="" draggable={false} />
              </span>
            )}
            {!glShown && <span className="hc__fx hc__glare" aria-hidden />}
          </div>
          <div className="hc__face hc__face--back">
            <CardBack rune={/rune/i.test(card.type)} />
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
