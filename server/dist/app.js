"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const cors_1 = __importDefault(require("cors"));
const path_1 = __importDefault(require("path"));
const auth_1 = __importDefault(require("./routes/auth"));
const admin_1 = __importDefault(require("./routes/admin"));
const blogger_1 = __importDefault(require("./routes/blogger"));
const promo_1 = __importDefault(require("./routes/promo"));
const app = (0, express_1.default)();
app.use((0, cors_1.default)());
app.use(express_1.default.json());
// Serve static frontend files
app.use(express_1.default.static(path_1.default.join(__dirname, '../../client')));
// API routes
app.use('/api/auth', auth_1.default);
app.use('/api/admin', admin_1.default);
app.use('/api/blogger', blogger_1.default);
app.use('/api/promo', promo_1.default);
// SPA fallback
app.get('*', (_req, res) => {
    res.sendFile(path_1.default.join(__dirname, '../../client/index.html'));
});
exports.default = app;
