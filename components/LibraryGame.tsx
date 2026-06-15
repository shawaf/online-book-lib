"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { sections, Book } from "@/data/books";
import BookDetailModal from "./BookDetailModal";

// ─── Constants ────────────────────────────────────────────────────────────────

const SECTION_WIDTH = 380;
const TOTAL_WIDTH = sections.length * SECTION_WIDTH + 200;
const FLOOR_Y = 520;
const PLAYER_H = 70;
const WALK_SPEED = 4;
const SHELF_INTERACT_DISTANCE = 160;
const BOOK_INTERACT_DISTANCE = 55;

// ─── Seeded layout (no Math.random in draw loop) ──────────────────────────────

interface FillerBook { w: number; h: number; colorIdx: number; }
interface ShelfLayout { bookHeights: number[]; fillerBooks: FillerBook[][]; }
const FILLER_COLORS = ["#4a2c2a", "#2c3e50", "#1a3a1a", "#3d2b1f", "#2a2a4a"];

function seededRand(seed: number) {
  const x = Math.sin(seed + 1) * 10000;
  return x - Math.floor(x);
}

const shelfLayouts: ShelfLayout[] = sections.map((section, si) => {
  const shelfWidth = 300;
  const booksPerShelf = Math.ceil(section.books.length / 3);
  const bookHeights = section.books.map((_b, bi) => 90 + seededRand(si * 100 + bi) * 20);
  const fillerBooks: FillerBook[][] = [0, 1, 2].map((shelfIdx) => {
    const shelfBooks = section.books.slice(shelfIdx * booksPerShelf, (shelfIdx + 1) * booksPerShelf);
    let usedWidth = 8 + shelfBooks.reduce((acc, b) => acc + (b.thickness === 3 ? 28 : b.thickness === 2 ? 20 : 14) + 3, 0);
    const fillers: FillerBook[] = [];
    let seed = si * 1000 + shelfIdx * 100;
    while (usedWidth < shelfWidth - 20) {
      const w = 12 + Math.floor(seededRand(seed++) * 10);
      const h = 70 + Math.floor(seededRand(seed++) * 30);
      const colorIdx = Math.floor(seededRand(seed++) * FILLER_COLORS.length);
      fillers.push({ w, h, colorIdx });
      usedWidth += w + 2;
    }
    return fillers;
  });
  return { bookHeights, fillerBooks };
});

// ─── Room layout (large interactive books) ────────────────────────────────────

interface RoomBook { x: number; row: number; bookIdx: number; }
const ROOM_BOOK_SPACING = 110;
const ROOM_START_X = 220;

function buildRoomLayout(bookCount: number): RoomBook[] {
  const booksPerRow = Math.ceil(bookCount / 2);
  return Array.from({ length: bookCount }, (_, i) => ({
    x: ROOM_START_X + (i % booksPerRow) * ROOM_BOOK_SPACING,
    row: Math.floor(i / booksPerRow),
    bookIdx: i,
  }));
}

const roomLayouts = sections.map((s) => buildRoomLayout(s.books.length));

// ─── Physics constants ────────────────────────────────────────────────────────

const GRAVITY          = 0.9;    // px/frame² (screen-down)
const CORR_JUMP1_VEL   = 17;     // corridor first jump, px/frame upward
const CORR_JUMP2_VEL   = 26;     // corridor double-jump burst
const ROOM_JUMP1_VEL   = -15;    // room first jump (negative = up in screen coords)
const ROOM_JUMP2_VEL   = -13;    // room second air jump
const SHELF_T_Y        = 330;    // top shelf platform, screen Y
const SHELF_B_Y        = 475;    // bottom shelf platform, screen Y

function getShelfXRange(sectionIdx: number) {
  const booksPerRow = Math.ceil(sections[sectionIdx].books.length / 2);
  return { sx: ROOM_START_X - 55, ex: ROOM_START_X + booksPerRow * ROOM_BOOK_SPACING + 65 };
}

// ─── Game state ───────────────────────────────────────────────────────────────

type GameMode = "corridor" | "room";

interface GameState {
  mode: GameMode;
  transitionAlpha: number;
  transitioning: boolean;
  transitionDir: 1 | -1;
  transitionCallback: (() => void) | null;

  // ── Corridor ──
  playerX: number;
  playerDir: 1 | -1;
  walkFrame: number;
  cameraX: number;

  // Corridor jump  (Y measured pixels-above-floor, positive = up)
  jumpY: number;
  jumpVelY: number;         // positive = moving up
  jumpsLeft: number;        // 2 = both available, 1 = first used, 0 = none
  jumpNearestSection: number; // locked in when first jump fires

  // ── Room ──
  roomSectionIdx: number;
  roomPlayerX: number;
  roomPlayerY: number;      // screen Y of feet (higher = lower on screen)
  roomVelY: number;         // screen velocity, positive = falling
  roomPlayerDir: 1 | -1;
  roomWalkFrame: number;
  roomCameraX: number;
  roomJumpsLeft: number;    // 2 = fresh
  roomOnGround: boolean;
  nearBookIdx: number;
}

// ─── Draw helpers ─────────────────────────────────────────────────────────────

function drawPlayer(
  ctx: CanvasRenderingContext2D,
  x: number,
  floorY: number,
  dir: 1 | -1,
  walkFrame: number,
  walking: boolean,
  sx = 1,   // horizontal scale (squash/stretch)
  sy = 1    // vertical scale
) {
  const bobY = walking ? Math.sin(walkFrame * 0.3) * 3 : 0;
  const legSwing = walking ? Math.sin(walkFrame * 0.3) * 15 : 0;
  const armSwing = walking ? Math.sin(walkFrame * 0.3 + Math.PI) * 12 : 0;

  ctx.save();
  // Anchor to feet — scale around the foot position so squash/stretch looks correct
  ctx.translate(x, floorY);
  ctx.scale(sx * dir, sy);
  ctx.translate(0, -(PLAYER_H / 2) + bobY);

  // Shadow (drawn on the actual floor, counter-scaled so it's flat)
  ctx.save();
  ctx.translate(0, PLAYER_H / 2 - 2);
  ctx.scale(1 / sx, 1 / sy); // undo stretch so shadow is always elliptical
  ctx.scale(1, 0.25);
  ctx.fillStyle = "rgba(0,0,0,0.3)";
  ctx.beginPath();
  ctx.ellipse(0, 0, 20, 10, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();

  ctx.fillStyle = "#f5f0e8";
  ctx.beginPath(); ctx.roundRect(-14, -15, 28, 50, 3); ctx.fill();
  ctx.strokeStyle = "#ddd5c4"; ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(-5, -10); ctx.lineTo(-5, 30); ctx.moveTo(5, -10); ctx.lineTo(5, 30); ctx.stroke();
  ctx.fillStyle = "#8b6914"; ctx.fillRect(-14, 18, 28, 5);

  [-1, 1].forEach((side, i) => {
    ctx.save();
    ctx.translate(side * 6, 30);
    ctx.rotate(((side === 1 ? legSwing : -legSwing) * Math.PI) / 180);
    ctx.fillStyle = i === 0 ? "#e8e0d0" : "#ddd5c4";
    ctx.beginPath(); ctx.roundRect(-5, 0, 10, 28, 2); ctx.fill();
    ctx.fillStyle = "#3d2000";
    ctx.beginPath(); ctx.roundRect(-6, 26, 14, 7, 2); ctx.fill();
    ctx.restore();
  });

  [-1, 1].forEach((side) => {
    ctx.save();
    ctx.translate(side * 14, -5);
    ctx.rotate(((side === 1 ? armSwing : -armSwing) * Math.PI) / 180);
    ctx.fillStyle = "#f5f0e8";
    ctx.beginPath(); ctx.roundRect(-4, 0, 8, 22, 2); ctx.fill();
    ctx.fillStyle = "#d4a56a";
    ctx.beginPath(); ctx.ellipse(0, 24, 5, 6, 0, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
  });

  ctx.fillStyle = "#d4a56a"; ctx.beginPath(); ctx.ellipse(0, -22, 13, 15, 0, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = "#5c3a1e"; ctx.beginPath(); ctx.ellipse(0, -10, 8, 7, 0, 0, Math.PI); ctx.fill();
  ctx.fillStyle = "#2c5f2e";
  ctx.beginPath(); ctx.ellipse(0, -32, 12, 6, 0, 0, Math.PI * 2); ctx.fill();
  ctx.fillRect(-12, -36, 24, 6);
  ctx.beginPath(); ctx.ellipse(0, -36, 12, 5, 0, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = "#fff"; ctx.beginPath(); ctx.ellipse(5, -22, 3, 2.5, 0, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = "#2c1a0e"; ctx.beginPath(); ctx.ellipse(6, -22, 1.5, 1.5, 0, 0, Math.PI * 2); ctx.fill();

  ctx.restore();
}

// ─── Corridor drawing ─────────────────────────────────────────────────────────

function drawCorridorBackground(ctx: CanvasRenderingContext2D, cameraX: number, canvasW: number) {
  const grad = ctx.createLinearGradient(0, 0, 0, 100);
  grad.addColorStop(0, "#1a0a00"); grad.addColorStop(1, "#3d1f00");
  ctx.fillStyle = grad; ctx.fillRect(0, 0, canvasW, 100);

  for (let i = 0; i < sections.length + 1; i++) {
    const lampX = i * SECTION_WIDTH + SECTION_WIDTH / 2 - cameraX;
    if (lampX < -60 || lampX > canvasW + 60) continue;
    ctx.strokeStyle = "#888"; ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.moveTo(lampX, 0); ctx.lineTo(lampX, 40); ctx.stroke();
    ctx.fillStyle = "#ffe8a3";
    ctx.beginPath(); ctx.ellipse(lampX, 45, 14, 10, 0, 0, Math.PI * 2); ctx.fill();
    const glow = ctx.createRadialGradient(lampX, 80, 0, lampX, 80, 200);
    glow.addColorStop(0, "rgba(255,220,100,0.18)"); glow.addColorStop(1, "rgba(255,220,100,0)");
    ctx.fillStyle = glow; ctx.fillRect(lampX - 200, 40, 400, 400);
  }

  ctx.fillStyle = "#2a1300"; ctx.fillRect(0, 100, canvasW, FLOOR_Y - 100);

  ctx.strokeStyle = "#5c2d0015"; ctx.lineWidth = 1;
  for (let i = 0; i < Math.ceil(TOTAL_WIDTH / 40) + 2; i++) {
    const px = i * 40 - (cameraX % 40);
    for (let j = 0; j < 12; j++) {
      const py = 110 + j * 34;
      ctx.beginPath();
      ctx.moveTo(px, py); ctx.lineTo(px + 20, py + 17);
      ctx.lineTo(px + 40, py); ctx.lineTo(px + 20, py - 17);
      ctx.closePath(); ctx.stroke();
    }
  }

  const floorGrad = ctx.createLinearGradient(0, FLOOR_Y, 0, FLOOR_Y + 80);
  floorGrad.addColorStop(0, "#5c3d1a"); floorGrad.addColorStop(1, "#3d2610");
  ctx.fillStyle = floorGrad; ctx.fillRect(0, FLOOR_Y, canvasW, 80);
  ctx.strokeStyle = "#4a2e1044"; ctx.lineWidth = 1;
  for (let i = 0; i < Math.ceil(canvasW / 60) + 2; i++) {
    ctx.strokeRect(i * 60 - (cameraX % 60), FLOOR_Y, 60, 60);
  }
}

function drawCorridorSection(
  ctx: CanvasRenderingContext2D,
  sectionIndex: number,
  cameraX: number,
  nearSection: boolean,
  layout: ShelfLayout
) {
  const section = sections[sectionIndex];
  const sx = sectionIndex * SECTION_WIDTH - cameraX + 40;

  if (sectionIndex > 0) {
    ctx.strokeStyle = "#8b5e3c88"; ctx.lineWidth = 4;
    ctx.beginPath(); ctx.moveTo(sx - 40, 100); ctx.lineTo(sx - 40, FLOOR_Y); ctx.stroke();
    ctx.beginPath(); ctx.arc(sx - 40, 100, 30, 0, Math.PI, true); ctx.stroke();
  }

  const signX = sx + 60;
  ctx.globalAlpha = nearSection ? 1 : 0.7;
  ctx.fillStyle = section.color;
  ctx.beginPath(); ctx.roundRect(signX, 108, 230, 44, 8); ctx.fill();
  ctx.fillStyle = "#fff"; ctx.font = "bold 13px Georgia"; ctx.textAlign = "left";
  ctx.fillText(`${section.icon} ${section.title}`, signX + 10, 125);
  ctx.font = "12px Georgia"; ctx.fillStyle = "#ffffffbb";
  ctx.fillText(section.titleAr, signX + 10, 142);

  if (nearSection) {
    ctx.strokeStyle = section.lightColor; ctx.lineWidth = 2;
    ctx.setLineDash([4, 4]); ctx.strokeRect(signX - 2, 106, 234, 48); ctx.setLineDash([]);
  }
  ctx.globalAlpha = 1;

  const shelfX = sx + 20, shelfTop = 160, shelfWidth = 300, shelfHeight = FLOOR_Y - shelfTop;
  ctx.fillStyle = "#3d1f00"; ctx.fillRect(shelfX, shelfTop, shelfWidth, shelfHeight);
  ctx.fillStyle = "#7c4a1c";
  ctx.fillRect(shelfX - 8, shelfTop - 8, 8, shelfHeight + 16);
  ctx.fillRect(shelfX + shelfWidth, shelfTop - 8, 8, shelfHeight + 16);
  ctx.fillRect(shelfX - 8, shelfTop - 8, shelfWidth + 16, 10);

  const booksPerShelf = Math.ceil(section.books.length / 3);
  [0, 1, 2].forEach((shelfIdx) => {
    const shelfY = shelfTop + shelfIdx * (shelfHeight / 3);
    ctx.fillStyle = "#8b5e3c";
    ctx.fillRect(shelfX - 4, shelfY + shelfHeight / 3 - 8, shelfWidth + 8, 10);

    let bookX = shelfX + 8;
    section.books.slice(shelfIdx * booksPerShelf, (shelfIdx + 1) * booksPerShelf).forEach((book, bi) => {
      const bookW = book.thickness === 3 ? 28 : book.thickness === 2 ? 20 : 14;
      const bookH = layout.bookHeights[shelfIdx * booksPerShelf + bi] ?? 95;
      const bookBottom = shelfY + shelfHeight / 3 - 8;
      ctx.fillStyle = book.color;
      ctx.fillRect(bookX, bookBottom - bookH, bookW, bookH);
      const sg = ctx.createLinearGradient(bookX, 0, bookX + bookW, 0);
      sg.addColorStop(0, "rgba(255,255,255,0.25)"); sg.addColorStop(0.3, "rgba(255,255,255,0.08)"); sg.addColorStop(1, "rgba(0,0,0,0.2)");
      ctx.fillStyle = sg; ctx.fillRect(bookX, bookBottom - bookH, bookW, bookH);
      ctx.fillStyle = "rgba(255,215,0,0.4)";
      ctx.fillRect(bookX + 3, bookBottom - bookH + 8, bookW - 6, 1.5);
      ctx.fillRect(bookX + 3, bookBottom - bookH + 14, bookW - 6, 1.5);
      if (bookW > 16) {
        ctx.fillStyle = "rgba(255,215,0,0.3)";
        ctx.beginPath(); ctx.ellipse(bookX + bookW / 2, bookBottom - bookH * 0.65, 4, 5, 0, 0, Math.PI * 2); ctx.fill();
      }
      bookX += bookW + 3;
    });

    const fillerBottom = shelfY + shelfHeight / 3 - 8;
    layout.fillerBooks[shelfIdx].forEach((filler) => {
      ctx.fillStyle = FILLER_COLORS[filler.colorIdx];
      ctx.fillRect(bookX, fillerBottom - filler.h, filler.w, filler.h);
      const fg = ctx.createLinearGradient(bookX, 0, bookX + filler.w, 0);
      fg.addColorStop(0, "rgba(255,255,255,0.1)"); fg.addColorStop(1, "rgba(0,0,0,0.15)");
      ctx.fillStyle = fg; ctx.fillRect(bookX, fillerBottom - filler.h, filler.w, filler.h);
      bookX += filler.w + 2;
    });
  });

  if (nearSection) {
    ctx.globalAlpha = 0.7 + 0.3 * Math.sin(Date.now() / 300);
    ctx.fillStyle = section.lightColor;
    ctx.font = "bold 13px Georgia"; ctx.textAlign = "center";
    ctx.fillText("E / Enter  — Enter Section", shelfX + shelfWidth / 2, FLOOR_Y + 50);
    ctx.globalAlpha = 1;
  }
}

function drawMinimap(ctx: CanvasRenderingContext2D, canvasW: number, playerX: number) {
  const mmW = 200, mmH = 30, mmX = canvasW / 2 - 100, mmY = 12;
  ctx.fillStyle = "rgba(0,0,0,0.6)";
  ctx.beginPath(); ctx.roundRect(mmX, mmY, mmW, mmH, 6); ctx.fill();
  sections.forEach((s, i) => {
    const px = mmX + (i / sections.length) * mmW;
    const sw = mmW / sections.length;
    ctx.fillStyle = s.color + "88"; ctx.fillRect(px + 1, mmY + 2, sw - 2, mmH - 4);
    if (i > 0) {
      ctx.strokeStyle = "#ffffff22"; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(px, mmY + 2); ctx.lineTo(px, mmY + mmH - 2); ctx.stroke();
    }
  });
  const pct = playerX / TOTAL_WIDTH;
  ctx.fillStyle = "#fff";
  ctx.beginPath(); ctx.arc(mmX + pct * mmW, mmY + mmH / 2, 4, 0, Math.PI * 2); ctx.fill();
}

// ─── Room drawing ─────────────────────────────────────────────────────────────

function drawRoomBackground(
  ctx: CanvasRenderingContext2D,
  sectionIdx: number,
  cameraX: number,
  canvasW: number,
  canvasH: number
) {
  const section = sections[sectionIdx];

  // Warm wall
  const wallGrad = ctx.createLinearGradient(0, 0, 0, canvasH);
  wallGrad.addColorStop(0, "#1a0800");
  wallGrad.addColorStop(0.5, "#2d1200");
  wallGrad.addColorStop(1, "#1a0800");
  ctx.fillStyle = wallGrad; ctx.fillRect(0, 0, canvasW, canvasH);

  // Geometric Islamic tile pattern
  ctx.strokeStyle = section.color + "18"; ctx.lineWidth = 1;
  const tileSize = 50;
  for (let i = 0; i < Math.ceil(canvasW / tileSize) + 2; i++) {
    for (let j = 0; j < Math.ceil(canvasH / tileSize) + 1; j++) {
      const tx = i * tileSize - (cameraX % tileSize);
      const ty = j * tileSize;
      ctx.strokeRect(tx, ty, tileSize, tileSize);
      ctx.beginPath();
      ctx.moveTo(tx + tileSize / 2, ty);
      ctx.lineTo(tx + tileSize, ty + tileSize / 2);
      ctx.lineTo(tx + tileSize / 2, ty + tileSize);
      ctx.lineTo(tx, ty + tileSize / 2);
      ctx.closePath(); ctx.stroke();
    }
  }

  // Chandeliers
  for (let i = 0; i < 4; i++) {
    const chandX = i * (canvasW / 3) + canvasW / 6 - (cameraX % (canvasW / 3));
    if (chandX < -80 || chandX > canvasW + 80) continue;
    ctx.strokeStyle = "#aaa"; ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.moveTo(chandX, 0); ctx.lineTo(chandX, 35); ctx.stroke();
    ctx.fillStyle = "#ffd97033";
    ctx.beginPath(); ctx.ellipse(chandX, 60, 30, 12, 0, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = "#ffe066";
    for (let k = -2; k <= 2; k++) {
      ctx.beginPath(); ctx.arc(chandX + k * 11, 60, 4, 0, Math.PI * 2); ctx.fill();
    }
    const cg = ctx.createRadialGradient(chandX, 100, 0, chandX, 100, 220);
    cg.addColorStop(0, `${section.lightColor}22`); cg.addColorStop(1, "transparent");
    ctx.fillStyle = cg; ctx.fillRect(chandX - 220, 40, 440, canvasH);
  }

  // Section banner at top
  ctx.fillStyle = section.color + "cc";
  ctx.fillRect(0, 0, canvasW, 55);
  ctx.fillStyle = "#fff"; ctx.font = "bold 18px Georgia"; ctx.textAlign = "center";
  ctx.fillText(`${section.icon}  ${section.title}  ·  ${section.titleAr}`, canvasW / 2, 32);

  // Floor
  const floorGrad = ctx.createLinearGradient(0, FLOOR_Y, 0, canvasH);
  floorGrad.addColorStop(0, "#4a2e0e"); floorGrad.addColorStop(1, "#2a1800");
  ctx.fillStyle = floorGrad; ctx.fillRect(0, FLOOR_Y, canvasW, canvasH - FLOOR_Y);
  ctx.strokeStyle = "#3d2200"; ctx.lineWidth = 1;
  for (let i = 0; i < Math.ceil(canvasW / 80) + 2; i++) {
    ctx.strokeRect(i * 80 - (cameraX % 80), FLOOR_Y, 80, 60);
  }

  // Exit door on left
  const doorX = 60 - cameraX;
  if (doorX > -80 && doorX < canvasW + 20) {
    ctx.fillStyle = "#3d1f00";
    ctx.beginPath(); ctx.roundRect(doorX - 25, FLOOR_Y - 120, 50, 120, [8, 8, 0, 0]); ctx.fill();
    ctx.strokeStyle = "#8b5e3c"; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.roundRect(doorX - 25, FLOOR_Y - 120, 50, 120, [8, 8, 0, 0]); ctx.stroke();
    ctx.fillStyle = "#ffd700"; ctx.beginPath(); ctx.arc(doorX + 10, FLOOR_Y - 60, 4, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = "#ffffff88"; ctx.font = "10px Georgia"; ctx.textAlign = "center";
    ctx.fillText("EXIT", doorX, FLOOR_Y - 130);
  }
}

function drawRoomShelf(
  ctx: CanvasRenderingContext2D,
  sectionIdx: number,
  cameraX: number,
  nearBookIdx: number
) {
  const section = sections[sectionIdx];
  const roomBooks = roomLayouts[sectionIdx];
  const booksPerRow = Math.ceil(section.books.length / 2);

  // Two shelf rows
  const rows = [
    { shelfY: 330, bookH: 130, bookBottom: 330 },
    { shelfY: 475, bookH: 110, bookBottom: 475 },
  ];

  rows.forEach(({ shelfY, bookH, bookBottom }, rowIdx) => {
    const rowStartX = ROOM_START_X - cameraX - 40;
    const rowEndX = rowStartX + booksPerRow * ROOM_BOOK_SPACING + 60;

    // Shelf back panel
    ctx.fillStyle = "#2a1400";
    ctx.fillRect(rowStartX, shelfY - bookH - 8, rowEndX - rowStartX, bookH + 18);
    // Shelf plank
    ctx.fillStyle = "#8b5e3c";
    ctx.fillRect(rowStartX - 10, shelfY, rowEndX - rowStartX + 20, 12);
    // Shelf side panels
    ctx.fillStyle = "#7c4a1c";
    ctx.fillRect(rowStartX - 12, shelfY - bookH - 8, 10, bookH + 20);
    ctx.fillRect(rowEndX - 2, shelfY - bookH - 8, 10, bookH + 20);

    // Books on this row
    const booksOnRow = roomBooks.filter((rb) => rb.row === rowIdx);
    booksOnRow.forEach((rb) => {
      const book = section.books[rb.bookIdx];
      if (!book) return;
      const bx = rb.x - cameraX;
      if (bx < -100 || bx > ctx.canvas.width / window.devicePixelRatio + 100) return;

      const isNear = rb.bookIdx === nearBookIdx;
      const bookW = book.thickness === 3 ? 55 : book.thickness === 2 ? 42 : 32;
      const bt = bookBottom - bookH - (isNear ? 12 : 0); // lift when near

      // Glow behind near book
      if (isNear) {
        const gl = ctx.createRadialGradient(bx + bookW / 2, bt + bookH / 2, 0, bx + bookW / 2, bt + bookH / 2, 80);
        gl.addColorStop(0, section.lightColor + "55");
        gl.addColorStop(1, "transparent");
        ctx.fillStyle = gl;
        ctx.fillRect(bx - 40, bt - 20, bookW + 80, bookH + 40);
      }

      // Book body
      ctx.fillStyle = book.color;
      ctx.beginPath(); ctx.roundRect(bx, bt, bookW, bookH, 2); ctx.fill();

      // Spine gradient
      const sg = ctx.createLinearGradient(bx, 0, bx + bookW, 0);
      sg.addColorStop(0, "rgba(255,255,255,0.2)");
      sg.addColorStop(0.15, "rgba(255,255,255,0.06)");
      sg.addColorStop(1, "rgba(0,0,0,0.25)");
      ctx.fillStyle = sg;
      ctx.beginPath(); ctx.roundRect(bx, bt, bookW, bookH, 2); ctx.fill();

      // Gold lines
      ctx.fillStyle = "rgba(255,215,0,0.5)";
      ctx.fillRect(bx + 4, bt + 10, bookW - 8, 2);
      ctx.fillRect(bx + 4, bt + bookH - 14, bookW - 8, 2);

      // Rotated Arabic title on spine
      ctx.save();
      ctx.translate(bx + bookW / 2, bt + bookH / 2);
      ctx.rotate(-Math.PI / 2);
      ctx.fillStyle = "rgba(255,255,255,0.85)";
      ctx.font = `bold ${bookW > 40 ? 10 : 8}px Georgia`;
      ctx.textAlign = "center";
      const title = book.titleAr.length > 16 ? book.titleAr.slice(0, 15) + "…" : book.titleAr;
      ctx.fillText(title, 0, 0);
      ctx.restore();

      // Near book: title tooltip floating above — box sized to content
      if (isNear) {
        const pad = 14;
        const lineH = 16;
        const lines = [
          { text: book.titleAr, font: "bold 11px Georgia", color: "#ffd700" },
          { text: book.title,   font: "bold 11px Georgia", color: "#ffffff" },
          { text: book.author,  font: "10px Georgia",      color: section.lightColor },
        ];
        // Measure widest line
        let maxW = 0;
        lines.forEach(l => {
          ctx.font = l.font;
          maxW = Math.max(maxW, ctx.measureText(l.text).width);
        });
        const boxW = maxW + pad * 2;
        const boxH = lines.length * lineH + pad;
        const cx = bx + bookW / 2;
        const boxX = cx - boxW / 2;
        const boxY = bt - boxH - 8;

        ctx.fillStyle = "rgba(0,0,0,0.78)";
        ctx.beginPath(); ctx.roundRect(boxX, boxY, boxW, boxH, 6); ctx.fill();

        lines.forEach((l, i) => {
          ctx.font = l.font;
          ctx.fillStyle = l.color;
          ctx.textAlign = "center";
          ctx.fillText(l.text, cx, boxY + pad + i * lineH);
        });
        // "Press E" badge
        const pulseAlpha = 0.8 + 0.2 * Math.sin(Date.now() / 250);
        ctx.globalAlpha = pulseAlpha;
        ctx.fillStyle = section.color;
        ctx.beginPath(); ctx.roundRect(bx, bt + bookH + 6, bookW, 22, 4); ctx.fill();
        ctx.fillStyle = "#fff"; ctx.font = "bold 10px Georgia";
        ctx.fillText("E / Enter", bx + bookW / 2, bt + bookH + 21);
        ctx.globalAlpha = 1;
      }
    });
  });
}

// ─── Ladder ───────────────────────────────────────────────────────────────────

const LADDER_INTERVAL = 15;
const LADDER_RAIL_W   = 7;   // half-width between rails
const RUNG_GAP        = 16;
const CLIMB_SPEED     = 2.8;

type GsClimb = GameState & {
  roomClimbing?:  boolean;
  climbDir?:      1 | -1;   // 1 = down, -1 = up
  climbFrame?:    number;
  climbLadderX?:  number;   // world X
  climbTargetY?:  number;
  dropFrames?:    number;
  dropMode?:      "one" | "all";
};

function getLadderXs(sectionIdx: number): number[] {
  const bpr = Math.ceil(sections[sectionIdx].books.length / 2);
  const xs: number[] = [];
  // Place ladder in the gap BETWEEN book (li-1) and book li.
  // Max book width = 55 px, ROOM_BOOK_SPACING = 110 → gap = 55 px.
  // Gap starts at: ROOM_START_X + (li-1)*spacing + 55
  // Gap ends at:   ROOM_START_X + li*spacing
  // Midpoint:      ROOM_START_X + li*spacing - spacing/4  (≈ centre of the 55 px gap)
  for (let li = LADDER_INTERVAL; li < bpr; li += LADDER_INTERVAL)
    xs.push(ROOM_START_X + li * ROOM_BOOK_SPACING - Math.round(ROOM_BOOK_SPACING / 4));
  return xs;
}

function nearestLadder(sectionIdx: number, playerX: number): number | null {
  for (const lx of getLadderXs(sectionIdx))
    if (Math.abs(playerX - lx) < 28) return lx;
  return null;
}

function drawLadders(
  ctx: CanvasRenderingContext2D,
  sectionIdx: number,
  cameraX: number,
  canvasW: number,
  playerWorldX: number,
  section: { lightColor: string }
) {
  for (const lwx of getLadderXs(sectionIdx)) {
    const lx = lwx - cameraX;
    if (lx < -40 || lx > canvasW + 40) continue;

    const isNear = Math.abs(playerWorldX - lwx) < 28;

    // Background glow when player is close
    if (isNear) {
      const glow = ctx.createLinearGradient(lx, SHELF_T_Y, lx, FLOOR_Y);
      glow.addColorStop(0, section.lightColor + "44");
      glow.addColorStop(1, section.lightColor + "11");
      ctx.fillStyle = glow;
      ctx.fillRect(lx - 18, SHELF_T_Y, 36, FLOOR_Y - SHELF_T_Y);
    }

    // Shadow behind rails for depth
    ctx.strokeStyle = "rgba(0,0,0,0.45)";
    ctx.lineWidth = 10;
    ctx.beginPath(); ctx.moveTo(lx - LADDER_RAIL_W + 2, SHELF_T_Y); ctx.lineTo(lx - LADDER_RAIL_W + 2, FLOOR_Y); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(lx + LADDER_RAIL_W + 2, SHELF_T_Y); ctx.lineTo(lx + LADDER_RAIL_W + 2, FLOOR_Y); ctx.stroke();

    // Rails — gradient for wood feel
    const railGrad = ctx.createLinearGradient(lx - LADDER_RAIL_W, 0, lx + LADDER_RAIL_W, 0);
    railGrad.addColorStop(0, "#7c4a1c");
    railGrad.addColorStop(0.4, "#bc8c5a");
    railGrad.addColorStop(1, "#6b3f18");
    ctx.strokeStyle = isNear ? "#d4a56a" : "#9c6030";
    ctx.lineWidth = isNear ? 7 : 5;
    ctx.beginPath(); ctx.moveTo(lx - LADDER_RAIL_W, SHELF_T_Y); ctx.lineTo(lx - LADDER_RAIL_W, FLOOR_Y); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(lx + LADDER_RAIL_W, SHELF_T_Y); ctx.lineTo(lx + LADDER_RAIL_W, FLOOR_Y); ctx.stroke();

    // Rungs with highlight + shadow
    for (let ry = SHELF_T_Y + RUNG_GAP; ry < FLOOR_Y; ry += RUNG_GAP) {
      // Shadow
      ctx.strokeStyle = "rgba(0,0,0,0.3)"; ctx.lineWidth = 4;
      ctx.beginPath(); ctx.moveTo(lx - LADDER_RAIL_W, ry + 2); ctx.lineTo(lx + LADDER_RAIL_W, ry + 2); ctx.stroke();
      // Rung
      ctx.strokeStyle = isNear ? "#e8c080" : "#b8844a"; ctx.lineWidth = 3;
      ctx.beginPath(); ctx.moveTo(lx - LADDER_RAIL_W, ry); ctx.lineTo(lx + LADDER_RAIL_W, ry); ctx.stroke();
      // Highlight
      ctx.strokeStyle = "rgba(255,255,255,0.18)"; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(lx - LADDER_RAIL_W, ry - 1); ctx.lineTo(lx + LADDER_RAIL_W, ry - 1); ctx.stroke();
    }

    // Bracket caps at top & bottom
    ctx.fillStyle = isNear ? "#e8c080" : "#9c6030";
    ctx.fillRect(lx - LADDER_RAIL_W - 3, SHELF_T_Y - 4, (LADDER_RAIL_W + 3) * 2, 5);
    ctx.fillRect(lx - LADDER_RAIL_W - 3, FLOOR_Y,       (LADDER_RAIL_W + 3) * 2, 5);

    // ↑↓ badge
    const pulse = 0.7 + 0.3 * Math.sin(Date.now() / 400);
    ctx.globalAlpha = isNear ? pulse : 0.55;
    ctx.fillStyle = isNear ? section.lightColor : "#ffd700";
    ctx.font = `bold ${isNear ? 13 : 11}px Georgia`;
    ctx.textAlign = "center";
    ctx.fillText("↑↓", lx, SHELF_T_Y - 8);
    ctx.globalAlpha = 1;
  }
}

// ─── Climbing player pose ──────────────────────────────────────────────────────

function drawPlayerClimbing(
  ctx: CanvasRenderingContext2D,
  x: number,   // screen X
  y: number,   // screen Y of feet
  climbFrame: number,
  dir: 1 | -1  // 1 = moving down, -1 = moving up
) {
  const t    = climbFrame * 0.18;
  const armL = Math.sin(t) * 22;        // left arm reach (degrees)
  const armR = Math.sin(t + Math.PI) * 22; // right arm (opposite phase)
  const legL = Math.sin(t + Math.PI) * 14;
  const legR = Math.sin(t) * 14;
  const bodyTilt = Math.sin(t * 0.5) * 3;  // subtle sway

  ctx.save();
  ctx.translate(x, y);
  ctx.rotate((bodyTilt * Math.PI) / 180);
  ctx.translate(0, -(PLAYER_H / 2));

  // Torso (facing forward — slight scale to look like climbing)
  ctx.fillStyle = "#f5f0e8";
  ctx.beginPath(); ctx.roundRect(-11, -12, 22, 42, 3); ctx.fill();
  ctx.strokeStyle = "#ddd5c4"; ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(-4, -8); ctx.lineTo(-4, 26); ctx.moveTo(4, -8); ctx.lineTo(4, 26); ctx.stroke();
  ctx.fillStyle = "#8b6914"; ctx.fillRect(-11, 16, 22, 4);

  // Left arm
  ctx.save();
  ctx.translate(-13, -4);
  ctx.rotate((armL * Math.PI) / 180);
  ctx.fillStyle = "#f5f0e8";
  ctx.beginPath(); ctx.roundRect(-4, 0, 8, 20, 2); ctx.fill();
  ctx.fillStyle = "#d4a56a"; ctx.beginPath(); ctx.ellipse(0, 21, 4, 5, 0, 0, Math.PI * 2); ctx.fill();
  ctx.restore();

  // Right arm
  ctx.save();
  ctx.translate(13, -4);
  ctx.rotate((armR * Math.PI) / 180);
  ctx.fillStyle = "#f5f0e8";
  ctx.beginPath(); ctx.roundRect(-4, 0, 8, 20, 2); ctx.fill();
  ctx.fillStyle = "#d4a56a"; ctx.beginPath(); ctx.ellipse(0, 21, 4, 5, 0, 0, Math.PI * 2); ctx.fill();
  ctx.restore();

  // Legs
  [-1, 1].forEach((side, i) => {
    ctx.save();
    ctx.translate(side * 5, 28);
    ctx.rotate(((side === 1 ? legL : legR) * Math.PI) / 180);
    ctx.fillStyle = i === 0 ? "#e8e0d0" : "#ddd5c4";
    ctx.beginPath(); ctx.roundRect(-4, 0, 9, 24, 2); ctx.fill();
    ctx.fillStyle = "#3d2000";
    ctx.beginPath(); ctx.roundRect(-5, 22, 12, 6, 2); ctx.fill();
    ctx.restore();
  });

  // Head
  ctx.fillStyle = "#d4a56a"; ctx.beginPath(); ctx.ellipse(0, -20, 12, 14, 0, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = "#5c3a1e"; ctx.beginPath(); ctx.ellipse(0, -9, 7, 6, 0, 0, Math.PI); ctx.fill();
  ctx.fillStyle = "#2c5f2e";
  ctx.beginPath(); ctx.ellipse(0, -30, 11, 5, 0, 0, Math.PI * 2); ctx.fill();
  ctx.fillRect(-11, -33, 22, 5);
  // Eyes
  ctx.fillStyle = "#fff"; ctx.beginPath(); ctx.ellipse(4, -20, 3, 2.5, 0, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = "#2c1a0e"; ctx.beginPath(); ctx.ellipse(5, -20, 1.5, 1.5, 0, 0, Math.PI * 2); ctx.fill();

  // Direction arrow above head while climbing
  ctx.globalAlpha = 0.75;
  ctx.fillStyle = "#ffd700";
  ctx.font = "bold 14px Georgia"; ctx.textAlign = "center";
  ctx.fillText(dir === -1 ? "↑" : "↓", 0, -44);
  ctx.globalAlpha = 1;

  ctx.restore();
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function LibraryGame() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const gameRef = useRef<GameState>({
    mode: "corridor",
    transitionAlpha: 1, transitioning: false, transitionDir: 1, transitionCallback: null,
    playerX: 100, playerDir: 1, walkFrame: 0, cameraX: 0,
    jumpY: 0, jumpVelY: 0, jumpsLeft: 2, jumpNearestSection: 0,
    roomSectionIdx: 0, roomPlayerX: 200, roomPlayerY: FLOOR_Y, roomVelY: 0,
    roomPlayerDir: 1, roomWalkFrame: 0, roomCameraX: 0,
    roomJumpsLeft: 2, roomOnGround: true, nearBookIdx: -1,
  });
  const keysRef    = useRef<Set<string>>(new Set());
  const rafRef     = useRef<number>(0);
  const [selectedBook, setSelectedBook] = useState<Book | null>(null);
  const [bookSectionIdx, setBookSectionIdx] = useState(0);
  const [showControls, setShowControls] = useState(true);
  const [uiMode, setUiMode] = useState<GameMode>("corridor");

  const startTransition = useCallback((cb: () => void) => {
    const g = gameRef.current;
    if (g.transitioning) return;
    g.transitioning = true; g.transitionDir = -1; g.transitionCallback = cb;
  }, []);

  const enterSection = useCallback((idx: number) => {
    startTransition(() => {
      const g = gameRef.current;
      g.mode = "room"; g.roomSectionIdx = idx;
      g.roomPlayerX = 200; g.roomPlayerY = FLOOR_Y; g.roomVelY = 0;
      g.roomPlayerDir = 1; g.roomCameraX = 0; g.roomOnGround = true;
      g.roomJumpsLeft = 2; g.nearBookIdx = -1;
      setUiMode("room");
    });
  }, [startTransition]);

  const exitSection = useCallback(() => {
    startTransition(() => {
      const g = gameRef.current;
      g.mode = "corridor";
      // Fall from the top of the corridor when re-entering
      g.jumpY = 420; g.jumpVelY = -6; g.jumpsLeft = 0;
      (g as GameState & { fallFromRoom?: boolean }).fallFromRoom = true;
      setUiMode("corridor");
    });
  }, [startTransition]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const resize = () => {
      canvas.width  = canvas.clientWidth  * window.devicePixelRatio;
      canvas.height = canvas.clientHeight * window.devicePixelRatio;
      ctx.scale(window.devicePixelRatio, window.devicePixelRatio);
    };
    resize();
    window.addEventListener("resize", resize);

    const onKey    = (e: KeyboardEvent) => keysRef.current.add(e.key);
    const onKeyUp  = (e: KeyboardEvent) => keysRef.current.delete(e.key);
    window.addEventListener("keydown", onKey);
    window.addEventListener("keyup",   onKeyUp);

    // ── Key handlers ──────────────────────────────────────────────────────────
    const onSpace = (e: KeyboardEvent) => {
      if (e.key !== " ") return;
      const g = gameRef.current;
      if (g.transitioning) return;

      if (g.mode === "corridor") {
        e.preventDefault();
        if (g.jumpsLeft === 2) {
          // First jump — find and lock nearest section
          let ni = 0, nd = Infinity;
          for (let i = 0; i < sections.length; i++) {
            const d = Math.abs(g.playerX - (i * SECTION_WIDTH + SECTION_WIDTH / 2 + 40));
            if (d < nd) { nd = d; ni = i; }
          }
          g.jumpNearestSection = ni;
          g.playerDir = (ni * SECTION_WIDTH + SECTION_WIDTH / 2 + 40) >= g.playerX ? 1 : -1;
          g.jumpVelY = CORR_JUMP1_VEL;
          g.jumpsLeft = 1;
        } else if (g.jumpsLeft === 1 && g.jumpY > 0) {
          // Double jump in air → burst toward section and enter
          g.jumpVelY = CORR_JUMP2_VEL;
          g.jumpsLeft = 0;
          // Enter section after brief burst (handled in loop when jumpY peaks)
        }
      }

      if (g.mode === "room" && g.roomJumpsLeft > 0) {
        e.preventDefault();
        g.roomVelY    = g.roomJumpsLeft === 2 ? ROOM_JUMP1_VEL : ROOM_JUMP2_VEL;
        g.roomOnGround = false;
        g.roomJumpsLeft--;
        // Visual double-jump burst — tiny star ring
        if (g.roomJumpsLeft === 0) {
          // trigger a quick flash stored in a ref (handled in draw)
          (g as GameState & { airJumpFlash?: number }).airJumpFlash = 8;
        }
      }
    };

    const onInteract = (e: KeyboardEvent) => {
      if (e.key !== "e" && e.key !== "E" && e.key !== "Enter") return;
      const g = gameRef.current;
      if (g.transitioning) return;
      if (g.mode === "corridor") {
        for (let i = 0; i < sections.length; i++) {
          const cx = i * SECTION_WIDTH + SECTION_WIDTH / 2 + 40;
          if (Math.abs(g.playerX - cx) < SHELF_INTERACT_DISTANCE) {
            e.preventDefault(); enterSection(i); return;
          }
        }
      }
      if (g.mode === "room" && g.nearBookIdx >= 0) {
        e.preventDefault();
        const book = sections[g.roomSectionIdx].books[g.nearBookIdx];
        if (book) { setBookSectionIdx(g.roomSectionIdx); setSelectedBook(book); }
      }
    };

    const onUp = (e: KeyboardEvent) => {
      if (e.key !== "ArrowUp" && e.key !== "w" && e.key !== "W") return;
      const g = gameRef.current as GsClimb;
      if (g.mode !== "room" || g.transitioning || g.roomClimbing) return;
      if (!g.roomOnGround) return;
      const lx = nearestLadder(g.roomSectionIdx, g.roomPlayerX);
      if (lx === null) return;
      e.preventDefault();
      let targetY: number | null = null;
      if (g.roomPlayerY >= FLOOR_Y - 5)           targetY = SHELF_B_Y;
      else if (g.roomPlayerY <= SHELF_B_Y + 5)    targetY = SHELF_T_Y;
      if (targetY === null) return;
      g.roomClimbing  = true;
      g.climbDir      = -1;
      g.climbFrame    = 0;
      g.climbLadderX  = lx;
      g.climbTargetY  = targetY;
      g.roomOnGround  = false;
      g.roomVelY      = 0;
    };

    const onDown = (e: KeyboardEvent) => {
      if (e.key !== "ArrowDown" && e.key !== "s" && e.key !== "S") return;
      const g = gameRef.current as GsClimb;
      if (g.mode !== "room" || g.transitioning || g.roomClimbing) return;
      if (!g.roomOnGround || g.roomPlayerY >= FLOOR_Y - 10) return;
      e.preventDefault();
      const lx = nearestLadder(g.roomSectionIdx, g.roomPlayerX);
      if (lx !== null) {
        // Ladder: smooth climb down one level
        let targetY: number | null = null;
        if (g.roomPlayerY <= SHELF_T_Y + 5)        targetY = SHELF_B_Y;
        else if (g.roomPlayerY <= SHELF_B_Y + 5)   targetY = FLOOR_Y;
        if (targetY === null) return;
        g.roomClimbing = true;
        g.climbDir     = 1;
        g.climbFrame   = 0;
        g.climbLadderX = lx;
        g.climbTargetY = targetY;
        g.roomOnGround = false;
        g.roomVelY     = 0;
      } else {
        // Away from ladder: physics drop one shelf
        const gc = g as GsClimb;
        gc.dropMode   = "one";
        gc.dropFrames = 20;
        g.roomOnGround = false;
        g.roomVelY     = 4;
      }
    };

    const onEscape = (e: KeyboardEvent) => {
      if (e.key === "Escape" && gameRef.current.mode === "room" && !gameRef.current.transitioning)
        exitSection();
    };

    window.addEventListener("keydown", onSpace);
    window.addEventListener("keydown", onInteract);
    window.addEventListener("keydown", onUp);
    window.addEventListener("keydown", onDown);
    window.addEventListener("keydown", onEscape);

    // ── Game loop ──────────────────────────────────────────────────────────────
    const loop = () => {
      const g   = gameRef.current;
      const gs  = g as GameState & { airJumpFlash?: number };
      const keys = keysRef.current;
      const W   = canvas.clientWidth;
      const H   = canvas.clientHeight;

      // Transition fade
      if (g.transitioning) {
        g.transitionAlpha += g.transitionDir * 0.06;
        if (g.transitionDir === -1 && g.transitionAlpha <= 0) {
          g.transitionAlpha = 0;
          g.transitionCallback?.(); g.transitionCallback = null;
          g.transitionDir = 1;
        } else if (g.transitionDir === 1 && g.transitionAlpha >= 1) {
          g.transitionAlpha = 1; g.transitioning = false;
        }
      }

      // ── CORRIDOR ────────────────────────────────────────────────────────────
      if (g.mode === "corridor") {
        const inAir = g.jumpY > 0 || g.jumpVelY > 0;

        // Walk (only on ground)
        let moved = false;
        if (!g.transitioning && !inAir) {
          if (keys.has("ArrowRight") || keys.has("d") || keys.has("D")) {
            g.playerX = Math.min(g.playerX + WALK_SPEED, TOTAL_WIDTH - 60);
            g.playerDir = 1; moved = true;
          }
          if (keys.has("ArrowLeft") || keys.has("a") || keys.has("A")) {
            g.playerX = Math.max(g.playerX - WALK_SPEED, 60);
            g.playerDir = -1; moved = true;
          }
        }
        if (moved) g.walkFrame++;

        // Jump physics (positive velY = moving up, jumpY = pixels above floor)
        if (inAir || g.jumpVelY > 0) {
          g.jumpVelY -= CORR_JUMP1_VEL / 14; // gravity (tuned to match jump vel)
          g.jumpY = Math.max(0, g.jumpY + g.jumpVelY);

          if (g.jumpsLeft === 0 && g.jumpVelY > 0) {
            // After double-jump burst, glide toward section
            const tx = g.jumpNearestSection * SECTION_WIDTH + SECTION_WIDTH / 2 + 40;
            g.playerX += (tx - g.playerX) * 0.06;
          }

          if (g.jumpY <= 0 && g.jumpVelY <= 0) { // landed
            g.jumpY = 0; g.jumpVelY = 0;
            const wasDoubleJump = g.jumpsLeft === 0 && (gs as GameState & { fallFromRoom?: boolean }).fallFromRoom !== true;
            (gs as GameState & { fallFromRoom?: boolean }).fallFromRoom = false;
            g.jumpsLeft = 2;
            if (wasDoubleJump) enterSection(g.jumpNearestSection);
          }
        }
        // (jumpsLeft reset handled in landing block above)

        // Fire enterSection after double-jump lands near section
        if (!inAir && g.jumpsLeft === 2) {
          // handled above
        }

        // Camera
        const tc = g.playerX - W / 2;
        g.cameraX += (tc - g.cameraX) * 0.08;
        g.cameraX = Math.max(0, Math.min(g.cameraX, TOTAL_WIDTH - W));

        const nearIdx = (() => {
          for (let i = 0; i < sections.length; i++) {
            if (Math.abs(g.playerX - (i * SECTION_WIDTH + SECTION_WIDTH / 2 + 40)) < SHELF_INTERACT_DISTANCE) return i;
          }
          return -1;
        })();

        // Squash & stretch
        let pSx = 1, pSy = 1;
        if (inAir) {
          if (g.jumpVelY > 2) {      // rising
            pSy = 1 + 0.22 * (g.jumpVelY / CORR_JUMP1_VEL);
            pSx = 1 - 0.14 * (g.jumpVelY / CORR_JUMP1_VEL);
          } else if (g.jumpVelY < -2) { // falling
            pSy = 0.92; pSx = 1.06;
          }
        }
        const playerFloorY = FLOOR_Y - g.jumpY;

        // Draw
        ctx.clearRect(0, 0, W, H);
        drawCorridorBackground(ctx, g.cameraX, W);
        sections.forEach((_, i) => drawCorridorSection(ctx, i, g.cameraX, i === nearIdx, shelfLayouts[i]));
        ctx.fillStyle = "#3d1f00";
        ctx.fillRect(sections.length * SECTION_WIDTH - g.cameraX + 40, 100, 60, FLOOR_Y - 100);

        const px = g.playerX - g.cameraX;

        // Takeoff dust
        if (inAir && g.jumpVelY > CORR_JUMP1_VEL * 0.7) {
          ctx.globalAlpha = 0.55;  ctx.fillStyle = "#c8a96e";
          for (let d = 0; d < 6; d++) {
            const a = (d / 6) * Math.PI, r = 12 + d * 5;
            ctx.beginPath(); ctx.ellipse(px + Math.cos(a)*r, FLOOR_Y + Math.sin(a)*r*0.2 - 4, 4, 2, a, 0, Math.PI*2); ctx.fill();
          }
          ctx.globalAlpha = 1;
        }

        // Double-jump ring burst
        if (g.jumpsLeft === 0 && inAir) {
          ctx.globalAlpha = 0.5 * (g.jumpVelY / CORR_JUMP2_VEL);
          ctx.strokeStyle = sections[g.jumpNearestSection].lightColor; ctx.lineWidth = 3;
          const r = (1 - g.jumpVelY / CORR_JUMP2_VEL) * 60;
          ctx.beginPath(); ctx.arc(px, playerFloorY - PLAYER_H * 0.5, r, 0, Math.PI * 2); ctx.stroke();
          ctx.globalAlpha = 1;
        }

        // Ghost trail
        if (inAir && g.jumpsLeft <= 1) {
          for (let k = 1; k <= 3; k++) {
            ctx.globalAlpha = 0.12 * (4-k);
            ctx.fillStyle = sections[g.jumpNearestSection].lightColor;
            ctx.beginPath(); ctx.ellipse(px - g.playerDir * k * 12, playerFloorY - PLAYER_H * 0.4, 8, 16, 0, 0, Math.PI * 2); ctx.fill();
          }
          ctx.globalAlpha = 1;
        }

        // Floor shadow when airborne
        if (inAir) {
          const s = Math.max(0.2, 1 - g.jumpY / 220);
          ctx.globalAlpha = s * 0.3; ctx.fillStyle = "#000";
          ctx.beginPath(); ctx.ellipse(px, FLOOR_Y - 2, 20 * s, 5 * s, 0, 0, Math.PI * 2); ctx.fill();
          ctx.globalAlpha = 1;
        }

        drawPlayer(ctx, px, playerFloorY, g.playerDir, g.walkFrame, moved, pSx, pSy);
        drawMinimap(ctx, W, g.playerX);

        // HUD
        if (!inAir) {
          if (nearIdx >= 0) {
            const s = sections[nearIdx];
            const hudText = `${s.icon} ${s.title}  —  double-SPACE to fly in  ·  E / Enter to walk in`;
            ctx.font = "bold 14px Georgia";
            const tw = ctx.measureText(hudText).width;
            const pad = 24;
            ctx.fillStyle = s.color + "dd";
            ctx.beginPath(); ctx.roundRect(W/2 - tw/2 - pad, H-65, tw + pad*2, 38, 10); ctx.fill();
            ctx.fillStyle = "#fff"; ctx.textAlign = "center";
            ctx.fillText(hudText, W/2, H-40);
          } else {
            ctx.fillStyle = "rgba(255,255,255,0.28)";
            ctx.font = "12px Georgia"; ctx.textAlign = "center";
            ctx.fillText("SPACE — jump  ·  double-SPACE in air — fly into section  ·  E near shelf — enter", W/2, H-42);
          }
        }
      }

      // ── ROOM ──────────────────────────────────────────────────────────────
      if (g.mode === "room") {
        const section   = sections[g.roomSectionIdx];
        const bprRow    = Math.ceil(section.books.length / 2);
        const roomW     = ROOM_START_X + bprRow * ROOM_BOOK_SPACING + 200;
        const { sx: shelfSX, ex: shelfEX } = getShelfXRange(g.roomSectionIdx);

        // Auto-exit when player walks into the exit door
        if (!g.transitioning && g.roomPlayerX < 100) {
          g.transitioning = true;
          g.transitionDir = -1;
          g.transitionCallback = () => {
            g.mode = "corridor";
            g.jumpY = 420; g.jumpVelY = -6; g.jumpsLeft = 0;
            (g as GameState & { fallFromRoom?: boolean }).fallFromRoom = true;
            setUiMode("corridor");
          };
        }

        // Horizontal walk
        let moved = false;
        if (!g.transitioning) {
          if (keys.has("ArrowRight") || keys.has("d") || keys.has("D")) {
            g.roomPlayerX = Math.min(g.roomPlayerX + WALK_SPEED, roomW - 40);
            g.roomPlayerDir = 1; moved = true;
          }
          if (keys.has("ArrowLeft") || keys.has("a") || keys.has("A")) {
            g.roomPlayerX = Math.max(g.roomPlayerX - WALK_SPEED, 30);
            g.roomPlayerDir = -1; moved = true;
          }
        }
        if (moved) g.roomWalkFrame++;

        // ── Ladder climbing (overrides normal physics) ──────────────────────
        const gsClimb = g as GsClimb;
        if (gsClimb.roomClimbing) {
          gsClimb.climbFrame = (gsClimb.climbFrame ?? 0) + 1;
          g.roomPlayerX = gsClimb.climbLadderX!;        // lock to ladder X
          g.roomPlayerY += (gsClimb.climbDir ?? -1) * CLIMB_SPEED;
          g.roomVelY = 0;

          const target = gsClimb.climbTargetY ?? FLOOR_Y;
          const reached = gsClimb.climbDir === -1
            ? g.roomPlayerY <= target
            : g.roomPlayerY >= target;

          if (reached) {
            g.roomPlayerY   = target;
            g.roomVelY      = 0;
            g.roomOnGround  = true;
            g.roomJumpsLeft = 2;
            gsClimb.roomClimbing = false;
          }
        }

        // Vertical physics
        const prevY = g.roomPlayerY;
        if (!gsClimb.roomClimbing) {
        g.roomVelY += GRAVITY;
        g.roomPlayerY += g.roomVelY;
        }
        g.roomOnGround = gsClimb.roomClimbing ? g.roomOnGround : false;

        const inShelf = g.roomPlayerX >= shelfSX && g.roomPlayerX <= shelfEX;

        // Platform collision (check top shelf first, then bottom, then floor)
        type GsExt2 = GameState & { dropFrames?: number; dropMode?: "one" | "all" };
        const gsDrop = g as GsExt2;
        if ((gsDrop.dropFrames ?? 0) > 0) gsDrop.dropFrames!--;
        const dropping   = (gsDrop.dropFrames ?? 0) > 0;
        const dropMode   = gsDrop.dropMode ?? "one";
        // "one"→skip only the shelf we're currently on (top shelf, land on bottom)
        // "all"→skip all shelves, land on floor
        const skipTop    = dropping;
        const skipBottom = dropping && dropMode === "all";

        if (g.roomVelY > 0) { // only when falling
          if (!skipTop && inShelf && prevY <= SHELF_T_Y && g.roomPlayerY >= SHELF_T_Y) {
            g.roomPlayerY = SHELF_T_Y; g.roomVelY = 0; g.roomOnGround = true; g.roomJumpsLeft = 2;
          } else if (!skipBottom && inShelf && prevY <= SHELF_B_Y && g.roomPlayerY >= SHELF_B_Y) {
            g.roomPlayerY = SHELF_B_Y; g.roomVelY = 0; g.roomOnGround = true; g.roomJumpsLeft = 2;
          } else if (g.roomPlayerY >= FLOOR_Y) {
            g.roomPlayerY = FLOOR_Y; g.roomVelY = 0; g.roomOnGround = true; g.roomJumpsLeft = 2;
          }
        }

        // Walk off shelf edge
        if (g.roomOnGround && g.roomPlayerY < FLOOR_Y && !inShelf) {
          g.roomOnGround = false; // gravity will take over next frame
        }

        // Near book — row 0 (top shelf) reachable only from that shelf level
        let nearBook = -1;
        roomLayouts[g.roomSectionIdx].forEach((rb) => {
          const onCorrectLevel =
            (rb.row === 1 && g.roomPlayerY >= SHELF_B_Y - 20) ||
            (rb.row === 0 && g.roomPlayerY <= SHELF_T_Y + 20);
          if (Math.abs(g.roomPlayerX - rb.x) < BOOK_INTERACT_DISTANCE && onCorrectLevel)
            nearBook = rb.bookIdx;
        });
        g.nearBookIdx = nearBook;

        // Camera X follow
        const tc = g.roomPlayerX - W / 2;
        g.roomCameraX += (tc - g.roomCameraX) * 0.08;
        g.roomCameraX = Math.max(0, Math.min(g.roomCameraX, roomW - W));

        // Draw
        ctx.clearRect(0, 0, W, H);
        drawRoomBackground(ctx, g.roomSectionIdx, g.roomCameraX, W, H);
        drawRoomShelf(ctx, g.roomSectionIdx, g.roomCameraX, g.nearBookIdx);
        drawLadders(ctx, g.roomSectionIdx, g.roomCameraX, W, g.roomPlayerX, section);

        const rpx = g.roomPlayerX - g.roomCameraX;
        const rpy = g.roomPlayerY;

        // Floor shadow when airborne
        if (!g.roomOnGround) {
          const nearestPlatform = (inShelf && rpy < SHELF_T_Y + 100) ? SHELF_T_Y :
                                  (inShelf && rpy < SHELF_B_Y + 100) ? SHELF_B_Y : FLOOR_Y;
          const dist = nearestPlatform - rpy;
          const sc = Math.max(0.2, 1 - dist / 200);
          ctx.globalAlpha = sc * 0.3; ctx.fillStyle = "#000";
          ctx.beginPath(); ctx.ellipse(rpx, nearestPlatform - 2, 18 * sc, 4 * sc, 0, 0, Math.PI * 2); ctx.fill();
          ctx.globalAlpha = 1;
        }

        // Double-jump star burst (uses temporary gs.airJumpFlash counter)
        if ((gs.airJumpFlash ?? 0) > 0) {
          gs.airJumpFlash!--;
          const t = 1 - gs.airJumpFlash! / 8;
          ctx.globalAlpha = (1 - t) * 0.9;
          for (let s = 0; s < 8; s++) {
            const a = (s / 8) * Math.PI * 2;
            const r = t * 45;
            ctx.fillStyle = s % 2 === 0 ? "#ffd700" : section.lightColor;
            ctx.beginPath(); ctx.arc(rpx + Math.cos(a)*r, rpy - PLAYER_H*0.5 + Math.sin(a)*r, 4, 0, Math.PI*2); ctx.fill();
          }
          ctx.globalAlpha = 1;
        }

        // Jump squash/stretch
        let rSx = 1, rSy = 1;
        if (!g.roomOnGround) {
          if (g.roomVelY < -2) { rSy = 1.22; rSx = 0.84; }  // rising
          else if (g.roomVelY > 2) { rSy = 0.9; rSx = 1.08; } // falling
        }

        if (gsClimb.roomClimbing) {
          drawPlayerClimbing(ctx, rpx, rpy, gsClimb.climbFrame ?? 0, gsClimb.climbDir ?? -1);
        } else {
          drawPlayer(ctx, rpx, rpy, g.roomPlayerDir, g.roomWalkFrame, moved, rSx * 1.2, rSy * 1.2);
        }

        // Shelf level indicator
        const levelLabel = g.roomPlayerY <= SHELF_T_Y + 5 ? "Top Shelf" :
                           g.roomPlayerY <= SHELF_B_Y + 5 ? "Lower Shelf" : "Floor";
        const levelColor = g.roomPlayerY <= SHELF_T_Y + 5 ? "#ffd700" :
                           g.roomPlayerY <= SHELF_B_Y + 5 ? "#c8a96e" : "#ffffff88";
        ctx.fillStyle = levelColor; ctx.font = "bold 12px Georgia"; ctx.textAlign = "left";
        ctx.fillText(`📍 ${levelLabel}`, 16, H - 42);

        // Jump count indicator
        for (let j = 0; j < 2; j++) {
          ctx.fillStyle = j < g.roomJumpsLeft ? "#ffd700" : "#ffffff22";
          ctx.beginPath(); ctx.arc(16 + j * 18, H - 22, 6, 0, Math.PI * 2); ctx.fill();
        }
        ctx.fillStyle = "#fff"; ctx.font = "9px Georgia"; ctx.textAlign = "left";
        ctx.fillText("jumps", 42, H - 18);

        // Near exit prompt
        if (g.roomPlayerX < 120) {
          ctx.globalAlpha = 0.8 + 0.2 * Math.sin(Date.now() / 300);
          ctx.fillStyle = "#fff"; ctx.font = "bold 13px Georgia"; ctx.textAlign = "center";
          ctx.fillText("ESC — Back to Library", W/2, H - 42);
          ctx.globalAlpha = 1;
        }

        // Near book (top shelf) hint when on floor
        if (g.roomPlayerY > SHELF_B_Y + 10) {
          const topBookNearby = roomLayouts[g.roomSectionIdx].some(
            rb => rb.row === 0 && Math.abs(g.roomPlayerX - rb.x) < BOOK_INTERACT_DISTANCE * 2
          );
          if (topBookNearby) {
            ctx.fillStyle = "rgba(255,215,0,0.7)"; ctx.font = "12px Georgia"; ctx.textAlign = "center";
            ctx.fillText("↑ Jump to reach top shelf books", W/2, H - 68);
          }
        }

        // ESC badge
        ctx.fillStyle = section.color + "cc";
        ctx.beginPath(); ctx.roundRect(W - 190, H - 55, 180, 38, 8); ctx.fill();
        ctx.fillStyle = "#fff"; ctx.font = "bold 12px Georgia"; ctx.textAlign = "right";
        ctx.fillText("ESC — Return to Corridor", W - 16, H - 30);
      }

      // Transition overlay
      if (g.transitionAlpha < 1 || g.transitioning) {
        ctx.fillStyle = `rgba(0,0,0,${1 - g.transitionAlpha})`;
        ctx.fillRect(0, 0, W, H);
      }

      rafRef.current = requestAnimationFrame(loop);
    };

    rafRef.current = requestAnimationFrame(loop);

    return () => {
      cancelAnimationFrame(rafRef.current);
      window.removeEventListener("resize",   resize);
      window.removeEventListener("keydown",  onKey);
      window.removeEventListener("keyup",    onKeyUp);
      window.removeEventListener("keydown",  onSpace);
      window.removeEventListener("keydown",  onInteract);
      window.removeEventListener("keydown",  onUp);
      window.removeEventListener("keydown",  onDown);
      window.removeEventListener("keydown",  onEscape);
    };
  }, [enterSection, exitSection]);

  const handleCanvasClick = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current; if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const cx = e.clientX - rect.left, cy = e.clientY - rect.top;
    const g = gameRef.current;
    if (g.mode === "corridor") {
      sections.forEach((_, i) => {
        const sx = i * SECTION_WIDTH - g.cameraX + 100;
        if (cx >= sx && cx <= sx + 230 && cy >= 108 && cy <= 152) enterSection(i);
      });
    }
  }, [enterSection]);

  return (
    <div className="relative w-full h-full select-none">
      <canvas ref={canvasRef} className="w-full h-full cursor-crosshair"
        style={{ display: "block" }} onClick={handleCanvasClick} />

      {uiMode === "corridor" && (
        <div className="absolute top-0 left-0 right-0 flex justify-center pointer-events-none" style={{ top: 8 }}>
          <div className="px-5 py-1.5 rounded-full text-sm font-bold text-white/90"
            style={{ background: "rgba(0,0,0,0.5)", letterSpacing: "0.1em" }}>
            المكتبة الإسلامية الشاملة &nbsp;·&nbsp; The Islamic Library
          </div>
        </div>
      )}

      {showControls && (
        <div className="absolute bottom-6 right-6 text-xs text-white/70 bg-black/60 rounded-xl p-3 space-y-1 max-w-[210px]"
          onClick={() => setShowControls(false)}>
          <p className="font-bold text-white/90 mb-1">Controls</p>
          <p>← → / A D — Walk</p>
          <p>SPACE — Jump onto shelf</p>
          <p>↓ / S — Drop one shelf down</p>
          <p>↑ / W at ladder — Climb up</p>
          <p>↓ / S at ladder — Drop to floor</p>
          <p>SPACE × 2 in air — Fly into section</p>
          <p>E / Enter — Enter / Read book</p>
          <p>ESC — Exit section</p>
          <p className="text-white/40 text-xs mt-2">Click to dismiss</p>
        </div>
      )}

      {/* Mobile jump + walk */}
      <div className="absolute bottom-6 left-6 flex gap-2 md:hidden">
        {(["left","right"] as const).map(dir => (
          <button key={dir}
            className="w-12 h-12 rounded-full bg-white/20 backdrop-blur text-white text-xl active:bg-white/40"
            onPointerDown={() => keysRef.current.add(dir==="left"?"ArrowLeft":"ArrowRight")}
            onPointerUp={()   => keysRef.current.delete(dir==="left"?"ArrowLeft":"ArrowRight")}
            onPointerLeave={()=> keysRef.current.delete(dir==="left"?"ArrowLeft":"ArrowRight")}>
            {dir==="left"?"←":"→"}
          </button>
        ))}
        <button className="w-12 h-12 rounded-full bg-yellow-400/80 text-black font-bold text-sm active:bg-yellow-300"
          onClick={() => {
            const e = new KeyboardEvent("keydown",{key:" ",bubbles:true});
            window.dispatchEvent(e);
          }}>↑</button>
        <button className="w-12 h-12 rounded-full bg-white/20 backdrop-blur text-white text-xs active:bg-white/40"
          onClick={() => {
            const e = new KeyboardEvent("keydown",{key:"e",bubbles:true});
            window.dispatchEvent(e);
          }}>E</button>
      </div>

      {selectedBook && (
        <BookDetailModal book={selectedBook} section={sections[bookSectionIdx]}
          onClose={() => setSelectedBook(null)} onBack={() => setSelectedBook(null)} />
      )}
    </div>
  );
}
