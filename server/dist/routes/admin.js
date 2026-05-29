"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const bcrypt_1 = __importDefault(require("bcrypt"));
const crypto_1 = __importDefault(require("crypto"));
const client_1 = require("@prisma/client");
const auth_1 = require("../middleware/auth");
const router = (0, express_1.Router)();
const prisma = new client_1.PrismaClient();
router.use(auth_1.authenticateToken, (0, auth_1.requireRole)('admin'));
// Get all bloggers with stats
router.get('/bloggers', async (_req, res) => {
    const bloggers = await prisma.blogger.findMany({
        include: {
            promoUses: {
                select: { action: true, app: true }
            }
        },
        orderBy: { createdAt: 'desc' }
    });
    const result = bloggers.map(b => {
        const entered = b.promoUses.filter(u => u.action === 'ENTERED').length;
        const purchased = b.promoUses.filter(u => u.action === 'PURCHASED').length;
        // Per-app stats
        const appStats = {};
        for (const u of b.promoUses) {
            if (!appStats[u.app])
                appStats[u.app] = { entered: 0, purchased: 0 };
            if (u.action === 'ENTERED')
                appStats[u.app].entered++;
            else
                appStats[u.app].purchased++;
        }
        return {
            id: b.id,
            login: b.login,
            name: b.name,
            promoCode: b.promoCode,
            apps: b.apps,
            entered,
            purchased,
            conversion: entered > 0 ? Math.round((purchased / entered) * 100) : 0,
            appStats,
            createdAt: b.createdAt
        };
    });
    res.json(result);
});
// Create blogger
router.post('/bloggers', async (req, res) => {
    const { name, login, password, promoCode, apps } = req.body;
    if (!name || !login || !password || !promoCode) {
        res.status(400).json({ error: 'Все поля обязательны: name, login, password, promoCode' });
        return;
    }
    const validApps = ['BALA_STORIES', 'ISLAMIC_TALES'];
    const bloggerApps = Array.isArray(apps) && apps.length > 0
        ? apps.filter((a) => validApps.includes(a))
        : ['BALA_STORIES'];
    if (bloggerApps.length === 0) {
        res.status(400).json({ error: 'Нужно выбрать хотя бы одно приложение' });
        return;
    }
    const existing = await prisma.blogger.findFirst({
        where: { OR: [{ login }, { promoCode }] }
    });
    if (existing) {
        res.status(409).json({ error: 'Блогер с таким логином или промокодом уже существует' });
        return;
    }
    const passwordHash = await bcrypt_1.default.hash(password, 10);
    const blogger = await prisma.blogger.create({
        data: { name, login, passwordHash, promoCode, apps: bloggerApps }
    });
    res.status(201).json({
        id: blogger.id,
        name: blogger.name,
        login: blogger.login,
        promoCode: blogger.promoCode,
        apps: blogger.apps,
        createdAt: blogger.createdAt
    });
});
// Delete blogger
router.delete('/bloggers/:id', async (req, res) => {
    try {
        await prisma.blogger.delete({ where: { id: req.params.id } });
        res.json({ success: true });
    }
    catch {
        res.status(404).json({ error: 'Блогер не найден' });
    }
});
// Overall stats
router.get('/stats', async (_req, res) => {
    const [totalBloggers, entered, purchased] = await Promise.all([
        prisma.blogger.count(),
        prisma.promoUse.count({ where: { action: 'ENTERED' } }),
        prisma.promoUse.count({ where: { action: 'PURCHASED' } }),
    ]);
    // Per-app stats
    const appStatsRaw = await prisma.promoUse.groupBy({
        by: ['app', 'action'],
        _count: true
    });
    const appStats = {};
    for (const row of appStatsRaw) {
        if (!appStats[row.app])
            appStats[row.app] = { entered: 0, purchased: 0, conversion: 0 };
        if (row.action === 'ENTERED')
            appStats[row.app].entered = row._count;
        else
            appStats[row.app].purchased = row._count;
    }
    for (const app of Object.keys(appStats)) {
        const s = appStats[app];
        s.conversion = s.entered > 0 ? Math.round((s.purchased / s.entered) * 100) : 0;
    }
    res.json({
        totalBloggers,
        totalEntered: entered,
        totalPurchased: purchased,
        conversion: entered > 0 ? Math.round((purchased / entered) * 100) : 0,
        appStats
    });
});
// Create premium promo
router.post('/premium-promos', async (req, res) => {
    const { durationDays, code } = req.body;
    if (!durationDays || durationDays < 1) {
        res.status(400).json({ error: 'durationDays обязателен и должен быть >= 1' });
        return;
    }
    const promoCode = code || crypto_1.default.randomBytes(4).toString('hex').toUpperCase();
    const existing = await prisma.premiumPromo.findUnique({ where: { code: promoCode } });
    if (existing) {
        res.status(409).json({ error: 'Промокод с таким кодом уже существует' });
        return;
    }
    const promo = await prisma.premiumPromo.create({
        data: { code: promoCode, durationDays }
    });
    res.status(201).json(promo);
});
// List premium promos
router.get('/premium-promos', async (_req, res) => {
    const promos = await prisma.premiumPromo.findMany({
        orderBy: { createdAt: 'desc' }
    });
    res.json(promos);
});
exports.default = router;
