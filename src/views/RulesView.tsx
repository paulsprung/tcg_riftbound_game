/** Points at Riot's official rules for now; the interactive guide comes with
    the play table. */
export function RulesView() {
  return (
    <section className="prose">
      <div className="page-head">
        <h1>Rules</h1>
        <p className="muted">Riot's official documents are the source of truth for every ruling.</p>
      </div>
      <ul className="link-list">
        <li>
          <a href="https://playriftbound.com/en-us/rules-hub/" target="_blank" rel="noreferrer">Rules Hub</a>
          <span className="muted"> · Core Rules and Tournament Rules, always the latest version</span>
        </li>
        <li>
          <a href="https://playriftbound.com/en-us/news/rules-and-releases/gameplay-guide-core-rules/" target="_blank" rel="noreferrer">
            How to play: core rules and gameplay guide
          </a>
          <span className="muted"> · Riot's beginner walkthrough</span>
        </li>
        <li>
          <a href="https://www.riftboundfaq.com/reference" target="_blank" rel="noreferrer">Riftbound FAQ</a>
          <span className="muted"> · community hyperlinked copy of the rules (unofficial)</span>
        </li>
      </ul>
      <p className="muted">
        Coming next: a step-by-step guide built into the simulator, a deck builder and a play table.
      </p>
    </section>
  );
}
