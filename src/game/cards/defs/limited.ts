/*
 * Cards the rules supply rather than a set: the blank battlefield of
 * Limited play, a battlefield with no rules text that a Sealed or Draft
 * deck may use in any number, even in place of one it opened (TR 602.3.d).
 */
import { battlefield } from '../../dsl/builders.ts';

export const LIMITED_DEFS = [
  battlefield('blank-battlefield', '', []),
];
