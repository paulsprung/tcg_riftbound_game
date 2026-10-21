import { setFoilStyle, useFoilStyle } from './foilStyle.ts';
import { HOLO_VERSIONS, setHoloVersion, useHoloVersion } from './holoVersion.ts';

/** The Holo A/B/C and Foil Subtle/Vivid switches: in the header, and again
    inside the inspector, which covers the header while it is open. */
export function HoloSwitches({ compact = false }: { compact?: boolean }) {
  const version = useHoloVersion();
  const style = useFoilStyle();
  return (
    <>
      <div className="foil-toggle" role="group" aria-label="Holo version">
        <span className="foil-toggle__label">Holo</span>
        {HOLO_VERSIONS.map((v) => (
          <button key={v.id} type="button" aria-pressed={version === v.id} onClick={() => setHoloVersion(v.id)} title={v.title}>
            {v.label}
          </button>
        ))}
      </div>
      <div className="foil-toggle" role="group" aria-label="Foil style">
        {!compact && <span className="foil-toggle__label">Foil</span>}
        {(['subtle', 'vivid'] as const).map((f) => (
          <button key={f} type="button" aria-pressed={style === f} onClick={() => setFoilStyle(f)}
            title={f === 'subtle' ? 'English printing: warmer, gentler foil' : 'Chinese printing: stronger rainbow'}>
            {f === 'subtle' ? 'Subtle' : 'Vivid'}
          </button>
        ))}
      </div>
    </>
  );
}
