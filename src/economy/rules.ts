/*
 * The economy's numbers, shared by the app and the server (server/economy.ts),
 * which is the one that applies them once you are signed in.
 */

export const PACK_PRICE = 200;
export const DAILY_COINS = 100;
export const DAY = 86_400_000;
export const SHOWCASE_SIZE = 5;
/** The tutorial's reward: one booster of each set the shop sells. */
export const TUTORIAL_PACKS = ['ogn', 'sfd', 'unl', 'rad', 'ven'] as const;
/** Coins a new account starts with, besides its starter deck and booster. */
export const STARTER_COINS = 0;
/** Packs bought at once, at most. */
export const MAX_BUY = 10;

// ---- online matches ----
/** Coins for a win and for a loss, casual and ranked alike. */
export const WIN_COINS = 50;
export const LOSS_COINS = 20;
/** On top, once a day: the first win. */
export const FIRST_WIN_COINS = 50;
/** A match shorter than this (turns) pays nothing: a quick concession is not a game. */
export const MIN_REWARD_TURNS = 3;

// ---- the marketplace ----
/** The market's cut of a sale (a coin sink): the seller gets the price less this. */
export const MARKET_FEE = 0.05;
/** A listing comes down after this many days, the cards back to the seller. */
export const LISTING_DAYS = 14;
/** Active listings per player, at most. */
export const MAX_LISTINGS = 50;
export const MAX_PRICE = 1_000_000;
/** Trading opens for an account this old (days) with this many finished online matches:
    fresh accounts can't funnel their free packs and coins into another. */
export const MARKET_MIN_DAYS = 3;
export const MARKET_MIN_MATCHES = 5;
