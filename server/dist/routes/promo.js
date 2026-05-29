"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const client_1 = require("@prisma/client");
const auth_1 = require("../middleware/auth");
const router = (0, express_1.Router)();
const prisma = new client_1.PrismaClient();
router.use(auth_1.requireApiKey);
// Check/apply promo code (unified endpoint)
router.post('/check', async (req, res) => {
    const { code, externalUserId, app } = req.body;
    if (!code) {
        res.status(400).json({ error: 'Код обязателен' });
        return;
    }
    const validApps = ['BALA_STORIES', 'ISLAMIC_TALES'];
    if (!app || !validApps.includes(app)) {
        res.status(400).json({ error: 'Поле app обязательно: BALA_STORIES или ISLAMIC_TALES' });
        return;
    }
    // Check if it's a blogger promo code
    const blogger = await prisma.blogger.findUnique({
        where: { promoCode: code }
    });
    if (blogger) {
        await prisma.promoUse.create({
            data: {
                bloggerId: blogger.id,
                action: 'ENTERED',
                app,
                externalUserId: externalUserId || null
            }
        });
        res.json({
            type: 'blogger',
            bloggerName: blogger.name
        });
        return;
    }
    // Check if it's a premium promo code
    const premiumPromo = await prisma.premiumPromo.findUnique({
        where: { code }
    });
    if (premiumPromo) {
        if (premiumPromo.used) {
            res.status(410).json({ error: 'Промокод уже использован' });
            return;
        }
        await prisma.premiumPromo.update({
            where: { id: premiumPromo.id },
            data: {
                used: true,
                usedBy: externalUserId || null,
                usedAt: new Date()
            }
        });
        res.json({
            type: 'premium',
            durationDays: premiumPromo.durationDays
        });
        return;
    }
    res.status(404).json({ error: 'Промокод не найден' });
});
// Record purchase for blogger promo code
router.post('/purchase', async (req, res) => {
    const { code, externalUserId, app } = req.body;
    if (!code) {
        res.status(400).json({ error: 'Код обязателен' });
        return;
    }
    const validApps = ['BALA_STORIES', 'ISLAMIC_TALES'];
    if (!app || !validApps.includes(app)) {
        res.status(400).json({ error: 'Поле app обязательно: BALA_STORIES или ISLAMIC_TALES' });
        return;
    }
    const blogger = await prisma.blogger.findUnique({
        where: { promoCode: code }
    });
    if (!blogger) {
        res.status(404).json({ error: 'Промокод блогера не найден' });
        return;
    }
    await prisma.promoUse.create({
        data: {
            bloggerId: blogger.id,
            action: 'PURCHASED',
            app,
            externalUserId: externalUserId || null
        }
    });
    res.json({ success: true });
});
exports.default = router;
