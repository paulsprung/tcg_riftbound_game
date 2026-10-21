import { useEffect, useRef, useState, type CSSProperties } from 'react';
import type { Card } from '../data/types.ts';
import { isReadable, useCardImage } from '../data/images.ts';
import type { Finish } from '../pack/generate.ts';
import { CardBack } from './CardBack.tsx';
import { HoloCanvas, type HoloCanvasHandle } from './HoloCanvas.tsx';
import { useFoilStyle } from './foilStyle.ts';
import { lookFor, useHoloVersion } from './holoVersion.ts';
import { createTilt } from './tilt.ts';
import './holo.css';
import './holo-classic.css';

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
  const foilStyle = useFoilStyle();
  const look = lookFor(useHoloVersion(), finish);
  const classic = look === 'a';

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
  // the ultimate's groove is its ice, not marbling
  const marbled = finish === 'etched' || finish === 'signature';
  const copy = (extra: string) => (
    <img className={`${imgClass} is-loaded ${extra}`} src={src} alt="" draggable={false} />
  );
  const useGl = gl && glOk !== false && !!src && isReadable(src);
  const glShown = useGl && glOk === true;

  return (
    <div
      ref={scene}
      className={`hc ${className}`}
      data-finish={finish}
      data-holo={look}
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
              <HoloCanvas ref={holo} src={src} finish={finish} rarity={card.rarity} style={foilStyle} version={look}
                className={`${imgClass} hc__gl${glShown ? ' is-loaded' : ''}`} onReady={setGlOk} />
            )}
            {/* CSS foil (holo.css). cut: the ink in the etched lines darkens
                while the card is handled. shine: one colour-dodge group whose
                light is multiplied by a copy of the art (the key), so it
                blooms where the ink is light and black stays black; the groove
                cuts the marbling (or the ultimate's ice facets) into it, the
                ridge lights each line's flank. ice: the ultimate's cracked-ice
                flashes. glit: glitter flakes, added on top. The .hc__hold
                copies keep the marbling off the figure. */}
            {/* Version A: the original CSS foil (holo-classic.css). */}
            {classic && !glShown && ETCHED.includes(finish) && loaded && (
              <span className="hcc-etch" aria-hidden>
                <img className={imgClass + ' is-loaded'} src={src} alt="" draggable={false} />
                <span className="hcc-etch-tint" />
              </span>
            )}
            {classic && !glShown && (
              <>
                {finish === 'ultimate' && <span className="hc__fx hcc-cosmos" aria-hidden />}
                <span className="hc__fx hcc-prism" aria-hidden />
                <span className="hc__fx hcc-foil" aria-hidden />
                <span className="hc__fx hcc-sparkle" aria-hidden />
                <span className="hc__fx hcc-band" aria-hidden />
                <span className="hc__fx hcc-glare" aria-hidden />
              </>
            )}
            {!classic && !glShown && loaded && marbled && (
              <span className="hc__fx hc__cut" aria-hidden>{copy('hc__hold')}</span>
            )}
            {!classic && !glShown && loaded && finish !== 'none' && (
              <span className="hc__fx hc__shine" aria-hidden>
                {copy('hc__key')}
                {ETCHED.includes(finish) && <span className="hc__groove">{marbled && copy('hc__hold')}</span>}
                {marbled && <span className="hc__ridge">{copy('hc__hold')}</span>}
              </span>
            )}
            {!classic && !glShown && loaded && finish === 'ultimate' && (
              <span className="hc__fx hc__ice" aria-hidden>
                <span className="hc__ice-f" />
                {copy('hc__key')}
              </span>
            )}
            {!classic && !glShown && loaded && finish !== 'none' && glitter && (
              <span className="hc__fx hc__glit" aria-hidden><span className="hc__flash" /></span>
            )}
            {!classic && !glShown && loaded && finish === 'signature' && (
              <span className="hc__fx hc__sig hc__sig--auto" aria-hidden>
                <img className={`${imgClass} is-loaded`} src={src} alt="" draggable={false} />
              </span>
            )}
            {!classic && !glShown && <span className="hc__fx hc__glare" aria-hidden />}
          </div>
          <div className="hc__face hc__face--back">
            <CardBack rune={/rune/i.test(card.type)} />
            <span className={`hc__fx ${classic ? 'hcc-band' : 'hc__band'}`} aria-hidden />
            <span className={`hc__fx ${classic ? 'hcc-glare' : 'hc__glare'}`} aria-hidden />
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
 * The SVG filter version A's etched foil uses: an edge detector over the
 * card art. Rendered once, near the app root.
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
