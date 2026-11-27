# ManiPad

Contributors: see [Visão, referências e decisões](VISAO_E_DECISOES.md) (in Portuguese) for the project's direction, requirements, and decision rationale.

ManiPad is a tablet-friendly collaborative canvas for online tutoring. It combines freehand drawing, math manipulatives, two-sided chips, cards, dice, counters, pasted images, and pawns in temporary share-by-link rooms. Drawer objects can be tapped for collision-aware placement or dragged directly to a chosen board position.

## Private hands

Each participant can keep a hand of cards that only they can see, like holding cards at a real table.

1. Open **Things** and tap **My hand** (under *Tabletop*). A rectangle in your color, labeled *Your hand*, appears at the bottom of your view. You can drag it or resize it with the handles. Each person can have one hand.
2. Drag cards into it, or drag from a deck straight into it to draw a card into your hand. Cards in a hand are always face down: you see their faces (marked with 👁), everyone else sees the backs plus a count (*Leo's hand · 3 cards*).
3. To play a card, drag it out of your hand onto the table. It stays face down until you tap it to flip it.
4. Anyone can put a card into someone else's hand (to deal or give a card), but only the owner — or the tutor — can take cards out of it, move it, resize it or delete it. Cards in a hand do not stack.

If the owner leaves, their hand stays on the board (*(away)*) and remains hidden; they see it again when they come back from the same browser. The tutor can delete it, or give an empty hand to someone else (select it, then *Give to*).

Privacy is enforced by the server, not just drawn: each participant receives their own snapshot, and the faces of cards in someone else's hand — as well as face-down cards and the order of every deck — are never sent to their browser. See `server/visibility.ts` and `server/permissions.ts`.

## Imported card decks (Naipe)

Card decks made in [Naipe](https://luccoelho.github.io/TCC/) can be brought to the board: open **Things** and tap **Import deck** (under *Tabletop*), then pick the `.json` file Naipe exports (there is a sample in `example/`). A face-down deck with all the cards appears, with the first card on top; it shuffles, deals, stacks and goes into hands like the regular deck.

Cards keep the proportions of the Naipe blueprint and show their fields in order: the first text as the title, then the art area, longer texts, and short values (e.g. *Custo 3 · Poder 2/4*) at the bottom. Images and icons are placeholders for now, because the export does not carry the image files.

## Decks from images

Any pictures can become a deck: open **Things** and tap **Deck from images**, then pick one or more image files. Each image becomes one card, in file-name order (*card 2* comes before *card 10*), with the first one on top of a face-down deck. Cards take the shape of the first image; the others are fitted inside it without cropping. Up to 60 images at a time; the browser shrinks them before sending. To try it, pick the fraction cards in `example/imagens/`.

## Run locally

Requires Node.js 20 or newer.

```bash
npm install
npm run dev
```

Open `http://localhost:5173`. The Vite client proxies API and Socket.IO traffic to the Node server on port 3000.

## Production

```bash
npm run build
npm start
```

The production server serves both the compiled client and realtime API on `PORT` (default `3000`). A single-process Dockerfile is included for Render, Railway, or Fly.io. Rooms are intentionally stored in memory and expire 30 minutes after the last participant leaves.

## Verification

```bash
npm test
npx playwright install chromium webkit
npm run test:e2e
```

The server is authoritative for room permissions, revisions, card shuffles, card draws, and dice rolls. Socket payloads are validated with Zod before mutations are applied. Snapshots are filtered per participant so hidden card faces never leave the server; a participant's id is tied to a secret kept in their browser, so nobody can join as someone else to see their hand.
