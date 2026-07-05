"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const fairyProxy_1 = require("../lib/fairyProxy");
const auth_1 = require("../middleware/auth");
// Additive BFF: proxies the remote log mirror of the Fairy-Tales backend so the
// admin site can read device logs in-page and drive the server-side kill-switch.
// The Fairy admin key stays server-side (in fairyProxy); the browser never sees it.
const router = (0, express_1.Router)();
router.use(auth_1.authenticateToken, (0, auth_1.requireRole)('admin'));
// Mirrored Unity log lines (oldest->newest). Filters (userId/session/level/limit)
// are forwarded as the query string by fairyProxy.
router.get('/', (req, res) => (0, fairyProxy_1.fairyProxy)(req, res, '/api/debug/logs'));
// Logging policy / kill-switch: list, upsert (global or per-user), delete override.
router.get('/config', (req, res) => (0, fairyProxy_1.fairyProxy)(req, res, '/api/admin/debug/log-config'));
router.put('/config', (req, res) => (0, fairyProxy_1.fairyProxy)(req, res, '/api/admin/debug/log-config'));
router.delete('/config', (req, res) => (0, fairyProxy_1.fairyProxy)(req, res, '/api/admin/debug/log-config'));
exports.default = router;
