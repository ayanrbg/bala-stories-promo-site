"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const fairyProxy_1 = require("../lib/fairyProxy");
const auth_1 = require("../middleware/auth");
// Additive BFF: proxies the (read-only) analytics mirror of the Fairy-Tales
// backend so the admin site can show app analytics in-page. The human is
// authenticated by the existing admin login (JWT + role); the Fairy admin key
// is injected server-side by fairyProxy and never reaches the browser.
const router = (0, express_1.Router)();
router.use(auth_1.authenticateToken, (0, auth_1.requireRole)('admin'));
// Воронка, дочитывание и здоровье данных — всё, что нужно вкладке «Аналитика»,
// чтобы отвечать на вопрос «где отсеиваются люди», а не только «сколько событий».
router.get('/funnel', (req, res) => (0, fairyProxy_1.fairyProxy)(req, res, '/api/analytics/funnel'));
router.get('/reading', (req, res) => (0, fairyProxy_1.fairyProxy)(req, res, '/api/analytics/reading'));
router.get('/health', (req, res) => (0, fairyProxy_1.fairyProxy)(req, res, '/api/analytics/health'));
router.get('/summary', (req, res) => (0, fairyProxy_1.fairyProxy)(req, res, '/api/analytics/summary'));
router.get('/events', (req, res) => (0, fairyProxy_1.fairyProxy)(req, res, '/api/analytics/events'));
router.get('/insights', (req, res) => (0, fairyProxy_1.fairyProxy)(req, res, '/api/analytics/insights'));
router.get('/tale/:id', (req, res) => (0, fairyProxy_1.fairyProxy)(req, res, '/api/analytics/tale/' + encodeURIComponent(req.params.id)));
exports.default = router;
