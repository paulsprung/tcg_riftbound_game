import { symbolFor } from '../data/cardInfo.ts';
import type { CardDb } from '../data/types.ts';

const MIGHT_FALLBACK = 'https://assetcdn.rgpub.io/public/live/riot-shared/player-experiences/riot-glyphs/rb/latest/might.svg';

/** Rules text with Riot's symbol codes (:rb_energy_1:, :rb_rune_fury:,
    :rb_might:, ...) drawn as symbols and [Keywords] as tags. */
export function RulesText({ text, db }: { text: string; db: CardDb }) {
  const parts = text.split(/(:rb_[a-z0-9_]+:|\[[^\]]+\])/g);
  const symbol = (code: string, key: number) => {
    const energy = /^:rb_energy_(\d+):$/.exec(code);
    if (energy) return <span key={key} className="sym sym--energy" title={`${energy[1]} energy`}>{energy[1]}</span>;
    const rune = /^:rb_rune_([a-z]+):$/.exec(code);
    if (rune) {
      const d = symbolFor(db, 'domains', rune[1]);
      if (rune[1] === 'rainbow' || !d) return <span key={key} className="sym sym--rainbow" title="Power of any domain" />;
      return <img key={key} className="sym-img" src={d.icon} alt={`${d.label} power`} title={`${d.label} power`} />;
    }
    if (code === ':rb_might:') {
      const src = db.symbols?.glyphs?.might ?? MIGHT_FALLBACK;
      return <img key={key} className="sym-img sym-img--glyph" src={src} alt="Might" title="Might" />;
    }
    if (code === ':rb_exhaust:') return <span key={key} className="sym sym--exhaust" title="Exhaust">⟳</span>;
    return <span key={key} className="sym">{code.slice(4, -1)}</span>;
  };
  return (
    <p className="rules-text">
      {parts.map((p, i) => {
        if (p.startsWith(':rb_')) return symbol(p, i);
        if (p === '[>]') return <span key={i} className="kw-arrow" aria-label="then">▸</span>;
        if (/^\[.*\]$/.test(p)) return <span key={i} className="kw">{p.slice(1, -1)}</span>;
        return p.split('\n').map((line, j) => (j ? [<br key={`${i}-${j}`} />, line] : line));
      })}
    </p>
  );
}
