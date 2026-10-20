/** A generic card back: a gold rune sigil on deep indigo. Drawn, not an asset. */
export function CardBack() {
  return (
    <div className="cb">
      <svg className="cb__sigil" viewBox="0 0 100 140" aria-hidden>
        <defs>
          <linearGradient id="cb-gold" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor="#f7e3a3" />
            <stop offset=".5" stopColor="#c99a3e" />
            <stop offset="1" stopColor="#7a5520" />
          </linearGradient>
        </defs>
        <rect x="5" y="5" width="90" height="130" rx="5" fill="none" stroke="url(#cb-gold)" strokeWidth="1.2" />
        <rect x="9" y="9" width="82" height="122" rx="3" fill="none" stroke="url(#cb-gold)" strokeWidth=".4" opacity=".6" />
        <g transform="translate(50 70)" fill="none" stroke="url(#cb-gold)">
          <circle r="30" strokeWidth=".8" />
          <circle r="25" strokeWidth=".3" opacity=".7" />
          <polygon points="0,-34 29.4,-17 29.4,17 0,34 -29.4,17 -29.4,-17" strokeWidth=".9" />
          <polygon points="0,-20 17.3,10 -17.3,10" strokeWidth="1.1" />
          <polygon points="0,20 17.3,-10 -17.3,-10" strokeWidth="1.1" />
          <circle r="5" fill="url(#cb-gold)" stroke="none" />
          <path d="M0 -44 V -36 M0 36 V 44 M-38 -22 l7 4 M38 -22 l-7 4 M-38 22 l7 -4 M38 22 l-7 -4" strokeWidth=".8" />
        </g>
        <text x="50" y="122" textAnchor="middle" className="cb__word">RIFTBOUND</text>
      </svg>
    </div>
  );
}
