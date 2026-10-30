import { useEffect, useState } from 'react';
import { Lobby } from '../lobby/Lobby.tsx';

/*
 * '#privacy' and '#imprint'. What the privacy notice says must match what
 * the server keeps (server/privacy.ts); the operator's details are set on
 * the server (OPERATOR_* in .env, served at /api/site). The site is run
 * from Austria, free and selling nothing: the Media Act's disclosure for a
 * small website (§ 25 (5) MedienG) asks for a name and the town, no street.
 */

type Operator = { name: string; place: string; email: string; hosting: string };
type Site = { operator: Operator; cloudflare: boolean };
const UNSET: Site = { operator: { name: '[Name of the operator]', place: '[Town, Austria]', email: '[contact e-mail]', hosting: '' }, cloudflare: true };

function useSite(): Site {
  const [site, setSite] = useState<Site>(UNSET);
  useEffect(() => {
    fetch('/api/site').then((r) => (r.ok ? r.json() : null))
      .then((d: { operator: Operator | null; cloudflare?: boolean } | null) => { if (d?.operator) setSite({ operator: d.operator, cloudflare: d.cloudflare ?? true }); })
      .catch(() => undefined);
  }, []);
  return site;
}

export function LegalView({ page }: { page: 'privacy' | 'imprint' }) {
  const { operator: OPERATOR, cloudflare } = useSite();
  return (
    <Lobby>
      <article className="legal lb-scroll">
        {page === 'imprint' ? (
          <>
            <h1>Legal notice</h1>
            <p>Disclosure under § 25 of the Austrian Media Act (MedienG).</p>
            <p>Owner and publisher: {OPERATOR.name}, {OPERATOR.place}<br />Contact: {OPERATOR.email}</p>
            <p>What the site is: a private, non-commercial fan site for playing the Riftbound trading card game. Nothing is sold; coins and packs are only part of the game and cannot be bought with money.</p>
            <p>This site was created under Riot Games' “Legal Jibber Jabber” policy using assets owned by Riot Games. Riot Games does not endorse or sponsor this project. Riftbound, League of Legends and all card art are © Riot Games.</p>
          </>
        ) : (
          <>
            <h1>Privacy</h1>
            <h2>Who is responsible</h2>
            <p>{OPERATOR.name}, {OPERATOR.place} (see the <a href="#imprint">legal notice</a>). Contact, also for every request below: {OPERATOR.email}.</p>

            <h2>What we keep, and why</h2>
            <ul>
              <li><b>Your Discord account:</b> its id, your display name and your avatar, given by Discord when you sign in (scope “identify”: no e-mail, no friends, no servers). For your account and so other players see who they play. Art. 6 (1) (b) GDPR.</li>
              <li><b>Your game account:</b> coins, cards, packs, graded cards, showcase, decks, ratings. That is the game itself. Art. 6 (1) (b).</li>
              <li><b>A record of coins and packs</b> that come and go (purchases, rewards, gifts by admins with their reason), kept two years, against fraud and for disputes. Art. 6 (1) (f).</li>
              <li><b>Matches:</b> who played, the result and the full replay. The replay is deleted after 90 days, the result stays in your match history.</li>
              <li><b>Marketplace:</b> your listings and sales. Buyer and seller are removed from a sale after one year; the price stays for price history.</li>
              <li><b>Tournaments:</b> your sign-up, your deck for it, your pairings and your place.</li>
              <li><b>Friends:</b> who you are friends with and open requests. Friends see your name, avatar and whether you are online, looking for a match or in a game.</li>
              <li><b>A session cookie</b> (rift_session) that keeps you signed in, 30 days; the server keeps only a hash of it. A short-lived cookie (rift_oauth_state) protects the sign-in. Both are needed for the service: no consent banner (§ 165 (3) TKG 2021).</li>
              <li><b>In your browser</b> (local storage): your display settings and, without an account, your local collection. They never leave your device.</li>
            </ul>
            <p>Nothing else: no e-mail address, no IP address in our database, no tracking, no ads, no analytics.</p>

            <h2>Other services</h2>
            <ul>
              <li><b>Discord</b> (Discord Inc., USA) for signing in, only when you choose to. Discord's own privacy policy applies there.</li>
              {cloudflare && <li><b>Cloudflare</b> (Cloudflare Inc.) carries the traffic to our server and protects it from attacks; it processes your IP address for that, under a data processing agreement and the EU-US Data Privacy Framework.</li>}
              <li>{OPERATOR.hosting ? <><b>{OPERATOR.hosting}</b> hosts the server and the database.</> : <>The server and the database run on the operator's own machine.</>}</li>
            </ul>
            <p>Card pictures, symbols, fonts and avatars are served from our own server: your browser does not contact Riot, Google or Discord for them.</p>

            <h2>Your rights</h2>
            <p>You can see and download everything we keep about you and delete your account at any time, on your <a href="#profile">profile</a>. Deleting removes your account and everything in it; in other players' match and tournament history you become “Deleted player”. You also have the right to rectification, restriction and objection (Art. 16, 18, 21 GDPR), and to complain to a data protection authority; in Austria that is the Datenschutzbehörde (dsb.gv.at).</p>
          </>
        )}
      </article>
    </Lobby>
  );
}
