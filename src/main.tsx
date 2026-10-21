import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App.tsx';
import { initFoilStyle } from './card/foilStyle.ts';
import { initHoloVersion } from './card/holoVersion.ts';
import './styles/app.css';

initHoloVersion();
initFoilStyle();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
