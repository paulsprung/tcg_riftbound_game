import { descriptor, GRADER, ratio, SUBGRADES, type Slab } from './grading.ts';

const NAMES = { centering: 'Centering', corners: 'Corners', edges: 'Edges', surface: 'Surface' };

/** The grader's report: four subgrades and the overall grade. `shown`
    reveals the rows one at a time while a card is being graded. */
export function GradeReport({ slab, shown = SUBGRADES.length, final = true }: {
  slab: Slab;
  shown?: number;
  final?: boolean;
}) {
  return (
    <div className="report">
      <dl className="report__rows">
        {SUBGRADES.map((k, i) => (
          <div key={k} className={`report__row${i < shown ? ' is-in' : ''}`}>
            <dt>
              {NAMES[k]}
              {k === 'centering' && <span className="muted small"> L/R {ratio(slab.lr)} · T/B {ratio(slab.tb)}</span>}
            </dt>
            <dd>
              <span className="report__bar"><span style={{ width: `${i < shown ? slab.sub[k] * 10 : 0}%` }} /></span>
              <b>{i < shown ? slab.sub[k].toFixed(1) : '–'}</b>
            </dd>
          </div>
        ))}
      </dl>
      <div className={`report__final${final ? ' is-in' : ''}`} data-pristine={slab.pristine ? '' : undefined}>
        <span className="report__final-num">{final ? slab.grade : '?'}</span>
        <span>
          <b>{final ? descriptor(slab) : 'Grading…'}</b>
          <span className="muted small">{GRADER.name} · Cert {slab.cert}</span>
        </span>
      </div>
    </div>
  );
}
