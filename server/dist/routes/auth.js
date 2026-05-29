"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const bcrypt_1 = __importDefault(require("bcrypt"));
const jsonwebtoken_1 = __importDefault(require("jsonwebtoken"));
const client_1 = require("@prisma/client");
const router = (0, express_1.Router)();
const prisma = new client_1.PrismaClient();
router.post('/login', async (req, res) => {
    const { login, password } = req.body;
    if (!login || !password) {
        res.status(400).json({ error: 'Логин и пароль обязательны' });
        return;
    }
    // Check admin credentials
    if (login === process.env.ADMIN_LOGIN && password === process.env.ADMIN_PASSWORD) {
        const accessToken = jsonwebtoken_1.default.sign({ id: 'admin', role: 'admin' }, process.env.JWT_SECRET, { expiresIn: '24h' });
        const refreshToken = jsonwebtoken_1.default.sign({ id: 'admin', role: 'admin' }, process.env.JWT_REFRESH_SECRET, { expiresIn: '7d' });
        res.json({ accessToken, refreshToken, role: 'admin' });
        return;
    }
    // Check blogger credentials
    const blogger = await prisma.blogger.findUnique({ where: { login } });
    if (!blogger) {
        res.status(401).json({ error: 'Неверный логин или пароль' });
        return;
    }
    const validPassword = await bcrypt_1.default.compare(password, blogger.passwordHash);
    if (!validPassword) {
        res.status(401).json({ error: 'Неверный логин или пароль' });
        return;
    }
    const accessToken = jsonwebtoken_1.default.sign({ id: blogger.id, role: 'blogger' }, process.env.JWT_SECRET, { expiresIn: '24h' });
    const refreshToken = jsonwebtoken_1.default.sign({ id: blogger.id, role: 'blogger' }, process.env.JWT_REFRESH_SECRET, { expiresIn: '7d' });
    res.json({ accessToken, refreshToken, role: 'blogger' });
});
router.post('/refresh', async (req, res) => {
    const { refreshToken } = req.body;
    if (!refreshToken) {
        res.status(400).json({ error: 'Refresh token обязателен' });
        return;
    }
    try {
        const payload = jsonwebtoken_1.default.verify(refreshToken, process.env.JWT_REFRESH_SECRET);
        const accessToken = jsonwebtoken_1.default.sign({ id: payload.id, role: payload.role }, process.env.JWT_SECRET, { expiresIn: '24h' });
        res.json({ accessToken });
    }
    catch {
        res.status(403).json({ error: 'Невалидный refresh token' });
    }
});
exports.default = router;
