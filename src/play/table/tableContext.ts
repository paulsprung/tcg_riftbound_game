import { createContext, useContext } from 'react';
import type { ObjId } from '../../game/index.ts';
import type { CardSlot } from '../model/board.ts';
import { NO_FX, type Fx } from '../model/fx.ts';

/*
 * What every card and lane on the table may want without prop drilling:
 * the animation batch (model/fx.ts) and a tutorial's highlights
 * (tutorial/coach.ts).
 */
export interface TableLook {
  fx: Fx;
  coachObjs: ReadonlySet<ObjId>;
  coachLanes: ReadonlySet<number | 'base'>;
  coachKeys: ReadonlySet<string>;
  /** The pointer is over a card the viewer can read: the rail shows it big. */
  hover?: (slot: CardSlot) => void;
}

export const TableLookContext = createContext<TableLook>({
  fx: NO_FX, coachObjs: new Set(), coachLanes: new Set(), coachKeys: new Set(),
});

export const useTableLook = () => useContext(TableLookContext);
