// Sample data for these comps: sixteen uncovered openings from data/tree.json, shaped like the state the app gets from the server.
// Each opening also carries its moves one by one (plies); the app can get the same by splitting the `moves` it already has.
window.SAMPLE = {
 "nodes": [
  {
   "id": "kp",
   "parent": "start",
   "name": "King's Pawn Opening",
   "side": "w",
   "plies": [
    "e4"
   ],
   "moves": "1.e4",
   "lastMove": "1.e4",
   "fen": "rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR",
   "eco": "B00",
   "target": 6,
   "status": "done",
   "count": 6,
   "adviceMission": false,
   "struggling": null
  },
  {
   "id": "open",
   "parent": "kp",
   "name": "Open Game",
   "side": "b",
   "plies": [
    "e4",
    "e5"
   ],
   "moves": "1.e4 e5",
   "lastMove": "1...e5",
   "fen": "rnbqkbnr/pppp1ppp/8/4p3/4P3/8/PPPP1PPP/RNBQKBNR",
   "eco": "C20",
   "target": 6,
   "status": "done",
   "count": 6,
   "adviceMission": false,
   "struggling": null
  },
  {
   "id": "knight",
   "parent": "open",
   "name": "King's Knight Opening",
   "side": "w",
   "plies": [
    "e4",
    "e5",
    "Nf3"
   ],
   "moves": "1.e4 e5 2.Nf3",
   "lastMove": "2.Nf3",
   "fen": "rnbqkbnr/pppp1ppp/8/4p3/4P3/5N2/PPPP1PPP/RNBQKB1R",
   "eco": "C40",
   "target": 6,
   "status": "done",
   "count": 6,
   "adviceMission": false,
   "struggling": null
  },
  {
   "id": "nc6",
   "parent": "knight",
   "name": "King's Knight: Normal Variation",
   "side": "b",
   "plies": [
    "e4",
    "e5",
    "Nf3",
    "Nc6"
   ],
   "moves": "1.e4 e5 2.Nf3 Nc6",
   "lastMove": "2...Nc6",
   "fen": "r1bqkbnr/pppp1ppp/2n5/4p3/4P3/5N2/PPPP1PPP/RNBQKB1R",
   "eco": "C44",
   "target": 6,
   "status": "done",
   "count": 6,
   "adviceMission": false,
   "struggling": null
  },
  {
   "id": "italian",
   "parent": "nc6",
   "name": "Italian Game",
   "side": "w",
   "plies": [
    "e4",
    "e5",
    "Nf3",
    "Nc6",
    "Bc4"
   ],
   "moves": "1.e4 e5 2.Nf3 Nc6 3.Bc4",
   "lastMove": "3.Bc4",
   "fen": "r1bqkbnr/pppp1ppp/2n5/4p3/2B1P3/5N2/PPPP1PPP/RNBQK2R",
   "eco": "C50",
   "target": 6,
   "status": "active",
   "count": 4,
   "adviceMission": false,
   "struggling": null
  },
  {
   "id": "ruy",
   "parent": "nc6",
   "name": "Ruy Lopez",
   "side": "w",
   "plies": [
    "e4",
    "e5",
    "Nf3",
    "Nc6",
    "Bb5"
   ],
   "moves": "1.e4 e5 2.Nf3 Nc6 3.Bb5",
   "lastMove": "3.Bb5",
   "fen": "r1bqkbnr/pppp1ppp/2n5/1B2p3/4P3/5N2/PPPP1PPP/RNBQK2R",
   "eco": "C60",
   "target": 6,
   "status": "parked",
   "count": 2,
   "adviceMission": false,
   "struggling": null
  },
  {
   "id": "sicilian",
   "parent": "kp",
   "name": "Sicilian Defense",
   "side": "b",
   "plies": [
    "e4",
    "c5"
   ],
   "moves": "1.e4 c5",
   "lastMove": "1...c5",
   "fen": "rnbqkbnr/pp1ppppp/8/2p5/4P3/8/PPPP1PPP/RNBQKBNR",
   "eco": "B20",
   "target": 8,
   "status": "done",
   "count": 8,
   "adviceMission": false,
   "struggling": {
    "score": 31,
    "games": 16
   }
  },
  {
   "id": "french",
   "parent": "kp",
   "name": "French Defense",
   "side": "b",
   "plies": [
    "e4",
    "e6"
   ],
   "moves": "1.e4 e6",
   "lastMove": "1...e6",
   "fen": "rnbqkbnr/pppp1ppp/4p3/8/4P3/8/PPPP1PPP/RNBQKBNR",
   "eco": "C00",
   "target": 6,
   "status": "done",
   "count": 6,
   "adviceMission": false,
   "struggling": null
  },
  {
   "id": "scandi",
   "parent": "kp",
   "name": "Scandinavian Defense",
   "side": "b",
   "plies": [
    "e4",
    "d5"
   ],
   "moves": "1.e4 d5",
   "lastMove": "1...d5",
   "fen": "rnbqkbnr/ppp1pppp/8/3p4/4P3/8/PPPP1PPP/RNBQKBNR",
   "eco": "B01",
   "target": 6,
   "status": "done",
   "count": 6,
   "adviceMission": false,
   "struggling": null
  },
  {
   "id": "scandi-accept",
   "parent": "scandi",
   "name": "Scandinavian: 2.exd5",
   "side": "w",
   "plies": [
    "e4",
    "d5",
    "exd5"
   ],
   "moves": "1.e4 d5 2.exd5",
   "lastMove": "2.exd5",
   "fen": "rnbqkbnr/ppp1pppp/8/3P4/8/8/PPPP1PPP/RNBQKBNR",
   "eco": "B01",
   "target": 6,
   "status": "done",
   "count": 6,
   "adviceMission": false,
   "struggling": null
  },
  {
   "id": "qp",
   "parent": "start",
   "name": "Queen's Pawn Opening",
   "side": "w",
   "plies": [
    "d4"
   ],
   "moves": "1.d4",
   "lastMove": "1.d4",
   "fen": "rnbqkbnr/pppppppp/8/8/3P4/8/PPP1PPPP/RNBQKBNR",
   "eco": "A40",
   "target": 6,
   "status": "done",
   "count": 6,
   "adviceMission": false,
   "struggling": null
  },
  {
   "id": "closed",
   "parent": "qp",
   "name": "Closed Game",
   "side": "b",
   "plies": [
    "d4",
    "d5"
   ],
   "moves": "1.d4 d5",
   "lastMove": "1...d5",
   "fen": "rnbqkbnr/ppp1pppp/8/3p4/3P4/8/PPP1PPPP/RNBQKBNR",
   "eco": "D00",
   "target": 6,
   "status": "done",
   "count": 6,
   "adviceMission": false,
   "struggling": null
  },
  {
   "id": "london",
   "parent": "closed",
   "name": "London System",
   "side": "w",
   "plies": [
    "d4",
    "d5",
    "Bf4"
   ],
   "moves": "1.d4 d5 2.Bf4",
   "lastMove": "2.Bf4",
   "fen": "rnbqkbnr/ppp1pppp/8/3p4/3P1B2/8/PPP1PPPP/RN1QKBNR",
   "eco": "D00",
   "target": 6,
   "status": "parked",
   "count": 1,
   "adviceMission": false,
   "struggling": null
  },
  {
   "id": "giuoco",
   "parent": "italian",
   "name": "Giuoco Piano",
   "side": "b",
   "plies": [
    "e4",
    "e5",
    "Nf3",
    "Nc6",
    "Bc4",
    "Bc5"
   ],
   "moves": "1.e4 e5 2.Nf3 Nc6 3.Bc4 Bc5",
   "lastMove": "3...Bc5",
   "fen": "r1bqk1nr/pppp1ppp/2n5/2b1p3/2B1P3/5N2/PPPP1PPP/RNBQK2R",
   "eco": "C50",
   "target": 6,
   "status": "done",
   "count": 6,
   "adviceMission": true,
   "struggling": null
  },
  {
   "id": "twoknights",
   "parent": "italian",
   "name": "Two Knights Defense",
   "side": "b",
   "plies": [
    "e4",
    "e5",
    "Nf3",
    "Nc6",
    "Bc4",
    "Nf6"
   ],
   "moves": "1.e4 e5 2.Nf3 Nc6 3.Bc4 Nf6",
   "lastMove": "3...Nf6",
   "fen": "r1bqkb1r/pppp1ppp/2n2n2/4p3/2B1P3/5N2/PPPP1PPP/RNBQK2R",
   "eco": "C55",
   "target": 8,
   "status": "active",
   "count": 3,
   "adviceMission": false,
   "struggling": null
  },
  {
   "id": "sic-nf3",
   "parent": "sicilian",
   "name": "Sicilian: 2.Nf3",
   "side": "w",
   "plies": [
    "e4",
    "c5",
    "Nf3"
   ],
   "moves": "1.e4 c5 2.Nf3",
   "lastMove": "2.Nf3",
   "fen": "rnbqkbnr/pp1ppppp/8/2p5/4P3/5N2/PPPP1PPP/RNBQKB1R",
   "eco": "B27",
   "target": 6,
   "status": "done",
   "count": 6,
   "adviceMission": false,
   "struggling": null
  }
 ],
 "fog": [
  {
   "parent": "nc6",
   "side": "w",
   "skip": 0
  },
  {
   "parent": "knight",
   "side": "b",
   "skip": 0
  },
  {
   "parent": "knight",
   "side": "b",
   "skip": 0
  },
  {
   "parent": "open",
   "side": "b",
   "skip": 1
  },
  {
   "parent": "closed",
   "side": "w",
   "skip": 0
  },
  {
   "parent": "giuoco",
   "side": "w",
   "skip": 0
  },
  {
   "parent": "giuoco",
   "side": "w",
   "skip": 0
  },
  {
   "parent": "twoknights",
   "side": "w",
   "skip": 0
  },
  {
   "parent": "ruy",
   "side": "b",
   "skip": 0
  },
  {
   "parent": "nc6",
   "side": "w",
   "skip": 1
  },
  {
   "parent": "open",
   "side": "w",
   "skip": 0
  },
  {
   "parent": "open",
   "side": "w",
   "skip": 0
  },
  {
   "parent": "open",
   "side": "w",
   "skip": 0
  },
  {
   "parent": "open",
   "side": "b",
   "skip": 1
  },
  {
   "parent": "sic-nf3",
   "side": "b",
   "skip": 0
  },
  {
   "parent": "sicilian",
   "side": "w",
   "skip": 0
  },
  {
   "parent": "french",
   "side": "b",
   "skip": 1
  },
  {
   "parent": "kp",
   "side": "b",
   "skip": 0
  },
  {
   "parent": "scandi-accept",
   "side": "b",
   "skip": 0
  },
  {
   "parent": "kp",
   "side": "b",
   "skip": 0
  },
  {
   "parent": "qp",
   "side": "b",
   "skip": 0
  },
  {
   "parent": "qp",
   "side": "b",
   "skip": 0
  },
  {
   "parent": "start",
   "side": "w",
   "skip": 0
  },
  {
   "parent": "start",
   "side": "w",
   "skip": 0
  },
  {
   "parent": "start",
   "side": "b",
   "skip": 1
  }
 ]
}
