import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App.tsx';
import { initFoilStyle } from './card/foilStyle.ts';
import { initHoloVersion } from './card/holoVersion.ts';
import { initEffects } from './card/effects.ts';
import { loadSession } from './net/session.ts';
import './styles/app.css';

initHoloVersion();
initFoilStyle();
initEffects();
void loadSession();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
