import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App.tsx';
import { initFoilStyle } from './card/foilStyle.ts';
import { initHoloVersion } from './card/holoVersion.ts';
import { initEffects } from './card/effects.ts';
import './styles/app.css';

initHoloVersion();
initFoilStyle();
initEffects();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
