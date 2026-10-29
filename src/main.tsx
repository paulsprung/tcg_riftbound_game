import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App.tsx';
import { initFoilStyle } from './card/foilStyle.ts';
import { initHoloVersion } from './card/holoVersion.ts';
import { initEffects } from './card/effects.ts';
import { initScale } from './lobby/scale.ts';
import { loadSession } from './net/session.ts';
// the fonts are served from this site, not Google's (GDPR): free stand-ins for Riftbound's
// commercial faces, Faustina for Beaufort for LOL, DM Sans for TT Norms Pro Compact,
// Instrument Sans for Lorimer No 2, Proza Libre for Arpona
import '@fontsource-variable/dm-sans/standard.css';
import '@fontsource-variable/faustina';
import '@fontsource-variable/instrument-sans/standard.css';
import '@fontsource-variable/instrument-sans/standard-italic.css';
import '@fontsource/proza-libre/800.css';
import './styles/app.css';

initHoloVersion();
initFoilStyle();
initEffects();
initScale();
void loadSession();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
