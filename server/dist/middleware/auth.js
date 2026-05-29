"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.authenticateToken = authenticateToken;
exports.requireRole = requireRole;
exports.requireApiKey = requireApiKey;
const jsonwebtoken_1 = __importDefault(require("jsonwebtoken"));
function authenticateToken(req, res, next) {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];
    if (!token) {
        res.status(401).json({ error: 'Токен не предоставлен' });
        return;
    }
    try {
        const payload = jsonwebtoken_1.default.verify(token, process.env.JWT_SECRET);
        req.user = payload;
        next();
    }
    catch {
        res.status(403).json({ error: 'Невалидный токен' });
    }
}
function requireRole(role) {
    return (req, res, next) => {
        if (!req.user || req.user.role !== role) {
            res.status(403).json({ error: 'Недостаточно прав' });
            return;
        }
        next();
    };
}
function requireApiKey(req, res, next) {
    const apiKey = req.headers['x-api-key'];
    if (!apiKey || apiKey !== process.env.API_KEY) {
        res.status(401).json({ error: 'Невалидный API ключ' });
        return;
    }
    next();
}
