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

export const STARTER_DEFS: CardDef[] = [...OGS_DEFS, ...OGN_DEFS, ...SFD_DEFS, ...UNL_DEFS, ...RAD_DEFS];
