"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const catalogService_1 = require("../services/catalogService");
const router = (0, express_1.Router)();
function parseForceRefresh(req) {
    const refreshParam = req.query?.refresh;
    const refreshParamValue = typeof refreshParam === 'string'
        ? refreshParam
        : Array.isArray(refreshParam)
            ? refreshParam.find((v) => v === '1' || v === 'true')
            : undefined;
    const refreshHeaderRaw = req.headers['x-refresh-cache'];
    const refreshHeader = Array.isArray(refreshHeaderRaw)
        ? refreshHeaderRaw[0]
        : refreshHeaderRaw;
    return (refreshParamValue === '1' ||
        refreshParamValue === 'true' ||
        refreshHeader === '1' ||
        refreshHeader === 'true');
}
router.get('/', async (req, res) => {
    const requestId = req.requestId;
    const forceRefresh = parseForceRefresh(req);
    const lang = typeof req.query?.lang === 'string' ? req.query.lang : undefined;
    try {
        const payload = await (0, catalogService_1.getCatalog)({ forceRefresh, requestId, lang });
        res.setHeader('X-Request-Id', requestId ?? '');
        res.json(payload);
    }
    catch (err) {
        res.status(500).json({
            error: 'Erreur lors de la recuperation du catalogue',
            requestId
        });
    }
});
exports.default = router;
