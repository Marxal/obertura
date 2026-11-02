// Replaying thousands of games without chess.js.
//
// WHY. chess.js checks every move for legality, which costs about 0.1 ms on a laptop
// and several times that on a phone. Home's boards replay your whole game history, so
// 3000 games took 40 seconds on a slowed-down test phone, with the screen frozen.
//
// Stored games are already legal, so all this needs is to follow the pieces. It is
// about a hundred times faster and gives the SAME KEY as positionKey(chess.fen()),
// which fast-replay.selftest.ts holds it to over thousands of random games.
//
// THE ONE THING IT ASKS CHESS.JS. A position's key only includes the en passant square
// when the capture is really legal, and a pin can make it illegal. That only comes up
// when a double step lands beside an enemy pawn, which is rare, so those few positions
// are handed to chess.js and remembered.

import { Chess } from 'chess.js';

const START_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
const A8 = 0;
const H8 = 7;
const A1 = 56;
const H1 = 63;
const E1 = 60;
const E8 = 4;

/** 0 is a8, 63 is h1: the order a FEN is written in. */
function squareIndex(name: string): number {
  return (name.charCodeAt(0) - 97) + (56 - name.charCodeAt(1)) * 8;
}

function squareName(index: number): string {
  return String.fromCharCode(97 + (index % 8)) + String(8 - Math.floor(index / 8));
}

const epMemo = new Map<string, string>();
const EP_MEMO_MAX = 5000;

/** The en passant field chess.js would write for this position. */
function legalEp(partial: string, candidate: string): string {
  const asked = `${partial} ${candidate}`;
  const known = epMemo.get(asked);
  if (known !== undefined) return known;
  let ep = '-';
  try {
    ep = new Chess(`${asked} 0 1`).fen().split(' ')[3];
  } catch {
    ep = '-';
  }
  if (epMemo.size >= EP_MEMO_MAX) epMemo.clear();
  epMemo.set(asked, ep);
  return ep;
}

export class FastBoard {
  private squares: string[] = [];
  private whiteToMove = true;
  private castling = '';
  private ep = '-';

  constructor(fen: string = START_FEN) {
    const [placement, turn, castling, ep] = fen.split(' ');
    for (const ch of placement) {
      if (ch === '/') continue;
      const empty = Number(ch);
      if (empty) for (let i = 0; i < empty; i++) this.squares.push('');
      else this.squares.push(ch);
    }
    this.whiteToMove = turn !== 'b';
    this.castling = castling && castling !== '-' ? castling : '';
    this.ep = ep ?? '-';
  }

  private placement(): string {
    let out = '';
    let empty = 0;
    for (let i = 0; i < 64; i++) {
      const piece = this.squares[i];
      if (piece) {
        if (empty) { out += empty; empty = 0; }
        out += piece;
      } else {
        empty++;
      }
      if (i % 8 === 7) {
        if (empty) { out += empty; empty = 0; }
        if (i !== 63) out += '/';
      }
    }
    return out;
  }

  /** The same string as positionKey(chess.fen()). */
  key(): string {
    return `${this.placement()} ${this.whiteToMove ? 'w' : 'b'} ${this.castling || '-'} ${this.ep}`;
  }

  /**
   * Follow one move. False when there is no piece of the right colour to move, which
   * is how a damaged game ends its replay. It does NOT otherwise check legality.
   */
  play(uci: string): boolean {
    const from = squareIndex(uci.slice(0, 2));
    let to = squareIndex(uci.slice(2, 4));
    if (!(from >= 0 && from < 64 && to >= 0 && to < 64)) return false;
    const piece = this.squares[from];
    if (!piece) return false;
    const isWhite = piece === piece.toUpperCase();
    if (isWhite !== this.whiteToMove) return false;

    const kind = piece.toLowerCase();
    let placed = piece;
    let newEp = '-';

    if (kind === 'k') {
      // Lichess writes castling as king-takes-rook; the rook is on the far square.
      const target = this.squares[to];
      const ontoOwnRook = target && target.toLowerCase() === 'r' && (target === target.toUpperCase()) === isWhite;
      const distance = (to % 8) - (from % 8);
      if (ontoOwnRook || Math.abs(distance) === 2) {
        const kingside = distance > 0;
        const row = from - (from % 8);
        to = row + (kingside ? 6 : 2);
        const rookFrom = row + (kingside ? 7 : 0);
        const rookTo = row + (kingside ? 5 : 3);
        this.squares[rookTo] = this.squares[rookFrom];
        this.squares[rookFrom] = '';
      }
    } else if (kind === 'p') {
      const row = Math.floor(to / 8);
      if (row === 0 || row === 7) {
        const promoted = uci[4] || 'q';
        placed = isWhite ? promoted.toUpperCase() : promoted.toLowerCase();
      }
      // A pawn moving sideways onto an empty square: en passant.
      if (from % 8 !== to % 8 && !this.squares[to]) {
        this.squares[to + (isWhite ? 8 : -8)] = '';
      }
      if (Math.abs(to - from) === 16) newEp = this.epAfterDoubleStep(from, to, isWhite);
    }

    this.squares[to] = placed;
    this.squares[from] = '';
    this.updateCastling(from, to, kind);
    this.whiteToMove = !this.whiteToMove;

    if (newEp !== '-') {
      this.ep = '-';
      this.ep = legalEp(`${this.placement()} ${this.whiteToMove ? 'w' : 'b'} ${this.castling || '-'}`, newEp);
    } else {
      this.ep = '-';
    }
    return true;
  }

  /** The square behind a double step, if an enemy pawn stands beside where it lands. */
  private epAfterDoubleStep(from: number, to: number, isWhite: boolean): string {
    const enemy = isWhite ? 'p' : 'P';
    const file = to % 8;
    const beside = (file > 0 && this.squares[to - 1] === enemy)
      || (file < 7 && this.squares[to + 1] === enemy);
    return beside ? squareName((from + to) / 2) : '-';
  }

  private updateCastling(from: number, to: number, kind: string): void {
    if (!this.castling) return;
    let rights = this.castling;
    if (kind === 'k') rights = rights.replace(from === E1 ? /[KQ]/g : from === E8 ? /[kq]/g : /$^/, '');
    for (const corner of [from, to]) {
      if (corner === H1) rights = rights.replace('K', '');
      if (corner === A1) rights = rights.replace('Q', '');
      if (corner === H8) rights = rights.replace('k', '');
      if (corner === A8) rights = rights.replace('q', '');
    }
    this.castling = rights;
  }
}

/**
 * The position key BEFORE each of a game's first `maxPlies` moves. Shorter than asked
 * when the game is, or when a damaged move stops the replay: that move isn't counted.
 */
export function positionKeysAlong(ucis: string[], maxPlies: number): string[] {
  const board = new FastBoard();
  const out: string[] = [];
  const plies = Math.min(ucis.length, maxPlies);
  for (let i = 0; i < plies; i++) {
    const key = board.key();
    if (!board.play(ucis[i])) break;
    out.push(key);
  }
  return out;
}

/** The position key after one move from a position, or null if it can't be played. */
export function keyAfterMove(fen: string, uci: string): string | null {
  const board = new FastBoard(fen);
  return board.play(uci) ? board.key() : null;
}
