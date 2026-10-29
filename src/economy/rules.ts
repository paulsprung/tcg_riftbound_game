/*
 * The economy's numbers, shared by the app and the server (server/economy.ts),
 * which is the one that applies them once you are signed in.
 */

export const PACK_PRICE = 100;
export const DAILY_COINS = 50;
export const DAY = 86_400_000;
export const SHOWCASE_SIZE = 5;
/** The tutorial's reward: one booster of each set the shop sells. */
export const TUTORIAL_PACKS = ['ogn', 'sfd', 'unl', 'rad', 'ven'] as const;
/** Coins a new account starts with, besides its starter deck and booster. */
export const STARTER_COINS = 0;
/** Packs bought at once, at most. */
export const MAX_BUY = 10;
