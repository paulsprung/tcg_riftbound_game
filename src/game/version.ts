/**
 * The engine's behaviour version. Every game record stores it, and a record
 * whose version differs is shown as a log but not replayed (§4.9). Bump it
 * on any change that can make the same seed and answers play out
 * differently: a rules fix, a new default in RulesConfig, a changed option
 * order.
 */
export const ENGINE_VERSION = '0.4.0-sfd';
