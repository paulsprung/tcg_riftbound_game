/*
 * The definitions of the starter decks' cards (§13), one module per product,
 * oldest first: a card is defined with the first starter that has it.
 */
import type { CardDef } from '../../dsl/ast.ts';
import { OGN_DEFS } from './ogn.ts';
import { RAD_DEFS } from './rad.ts';
import { OGS_DEFS } from './ogs.ts';
import { SFD_DEFS } from './sfd.ts';
import { UNL_DEFS } from './unl.ts';
import { OGN_SET_DEFS } from './ogn-set.ts';
import { SFD_SET_DEFS } from './sfd-set.ts';
import { UNL_SET_DEFS } from './unl-set.ts';
import { RAD_SET_DEFS } from './rad-set.ts';
import { VEN_SET_DEFS } from './ven-set.ts';

export const STARTER_DEFS: CardDef[] = [...OGS_DEFS, ...OGN_DEFS, ...SFD_DEFS, ...UNL_DEFS, ...RAD_DEFS];

/** The definitions of the sets' other cards (all cards executable). */
export const SET_DEFS: CardDef[] = [...OGN_SET_DEFS, ...SFD_SET_DEFS, ...UNL_SET_DEFS, ...RAD_SET_DEFS, ...VEN_SET_DEFS];
