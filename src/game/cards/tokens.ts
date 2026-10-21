/*
 * The token templates of [187]. Tokens are not cards [185]: they are created
 * on the board or the chain and cease to exist anywhere else [186]. The
 * spell or ability that makes one gives some of its characteristics; these
 * are the rest. All are domainless [185.3.b] and have no cost, which counts
 * as 0 [185.3.a.1].
 *
 * A token object's DefId is its TokenId ('recruit'); no card's DefId is one
 * of these (tested). cards.json supplies only art for tokens
 * (ORACLE.tokenArt), never their rules.
 */
import type { CardType, KeywordId, TokenId } from '../state/types.ts';

export interface TokenTemplate {
  id: TokenId;
  name: string;
  type: Extract<CardType, 'unit' | 'gear' | 'battlefield'>;
  might?: number;
  tags: string[];
  /** Keywords it has, in printed order. */
  keywords: KeywordId[];
  /** Its abilities in rules notation (oracle.ts), keywords included; '' if
      it has none. */
  text: string;
  rule: string;
}

export const TOKENS: Record<TokenId, TokenTemplate> = {
  recruit: { id: 'recruit', name: 'Recruit', type: 'unit', might: 1, tags: ['Recruit'], keywords: [], text: '',
    rule: '187.1' },
  sprite: { id: 'sprite', name: 'Sprite', type: 'unit', might: 3, tags: ['Fae'], keywords: ['temporary'],
    text: '[Temporary]', rule: '187.2' },
  sandSoldier: { id: 'sandSoldier', name: 'Sand Soldier', type: 'unit', might: 2, tags: ['Shurima'], keywords: [],
    text: '', rule: '187.3' },
  mech: { id: 'mech', name: 'Mech', type: 'unit', might: 3, tags: ['Mech'], keywords: [], text: '', rule: '187.4' },
  gold: { id: 'gold', name: 'Gold', type: 'gear', tags: [], keywords: [],
    text: '[Reaction][>] Kill this, [E]: [Add] [A].', rule: '187.5' },
  reflection: { id: 'reflection', name: 'Reflection', type: 'unit', might: 0, tags: [], keywords: [], text: '',
    rule: '187.6' },
  bird: { id: 'bird', name: 'Bird', type: 'unit', might: 1, tags: ['Bird'], keywords: ['deflect'], text: '[Deflect]',
    rule: '187.7' },
  brush: { id: 'brush', name: 'Brush', type: 'battlefield', tags: [], keywords: [],
    text: 'Bird, Cat, Dog, Poro, and Ivern units here have +1 [M].\n'
      + 'When you score here, you may replace this with the battlefield it replaced.', rule: '187.8' },
  baronPit: { id: 'baronPit', name: 'Baron Pit', type: 'battlefield', tags: [], keywords: [],
    text: 'Units can move here from anywhere.', rule: '187.9' },
  tentacle: { id: 'tentacle', name: 'Tentacle', type: 'unit', might: 1, tags: ['Bilgewater'], keywords: [], text: '',
    rule: '187.10' },
  shadowClone: { id: 'shadowClone', name: 'Shadow Clone', type: 'unit', might: 0, tags: [], keywords: [],
    text: 'When I attack, you may banish a unit from your trash. If you do, give me [Assault 4] this turn.',
    rule: '187.11' },
  bomb: { id: 'bomb', name: 'Bomb', type: 'gear', tags: [], keywords: ['deploy', 'deathknell'],
    text: '[Deploy]\n[Deathknell][>] Deal 2 to an enemy unit here and kill all other Bombs you control here.',
    rule: '187.12' },
};

export const TOKEN_IDS = Object.keys(TOKENS) as TokenId[];
