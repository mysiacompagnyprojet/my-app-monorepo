// backend/src/services/guestDemoLimits.js
// LEVEL: SERVICE
// Limites du mode test gratuit sans compte (par IP hashée + jour Europe/Paris)

'use strict';

const crypto = require('crypto');
const { prisma } = require('../lib/prisma');

const GUEST_DEMO_DAILY_CAP = Number(process.env.GUEST_DEMO_DAILY_CAP ?? 2);
const PARIS_TIME_ZONE = 'Europe/Paris';

function getDailyCap() {
  return Number.isFinite(GUEST_DEMO_DAILY_CAP) && GUEST_DEMO_DAILY_CAP > 0
    ? GUEST_DEMO_DAILY_CAP
    : 2;
}

function getParisDayKey(date = new Date()) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: PARIS_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date);
}

function extractClientIp(req) {
  const xForwardedFor = req.headers['x-forwarded-for'];

  if (typeof xForwardedFor === 'string' && xForwardedFor.trim()) {
    return xForwardedFor.split(',')[0].trim();
  }

  if (Array.isArray(xForwardedFor) && xForwardedFor.length > 0) {
    return String(xForwardedFor[0] || '').trim();
  }

  const xRealIp = req.headers['x-real-ip'];
  if (typeof xRealIp === 'string' && xRealIp.trim()) {
    return xRealIp.trim();
  }

  if (typeof req.ip === 'string' && req.ip.trim()) {
    return req.ip.trim();
  }

  if (typeof req.socket?.remoteAddress === 'string' && req.socket.remoteAddress.trim()) {
    return req.socket.remoteAddress.trim();
  }

  return 'unknown';
}

function hashIp(ip) {
  return crypto.createHash('sha256').update(String(ip || 'unknown')).digest('hex');
}

async function checkAndIncrementGuestDemoLimit(req) {
  const ip = extractClientIp(req);
  const ipHash = hashIp(ip);
  const dayKey = getParisDayKey();
  const limit = getDailyCap();

  const result = await prisma.$transaction(async (tx) => {
    const existing = await tx.guestDemoLimit.upsert({
      where: {
        ipHash_dayKey: {
          ipHash,
          dayKey,
        },
      },
      create: {
        ipHash,
        dayKey,
        count: 0,
      },
      update: {},
    });

    const usedBefore = Number(existing?.count ?? 0);

    if (usedBefore >= limit) {
      return {
        allowed: false,
        used: usedBefore,
        limit,
        remaining: 0,
        dayKey,
      };
    }

    const updated = await tx.guestDemoLimit.update({
      where: { id: existing.id },
      data: { count: { increment: 1 } },
      select: { count: true },
    });

    const used = Number(updated?.count ?? 0);
    const remaining = Math.max(0, limit - used);

    return {
      allowed: true,
      used,
      limit,
      remaining,
      dayKey,
    };
  });

  return result;
}

module.exports = {
  checkAndIncrementGuestDemoLimit,
};