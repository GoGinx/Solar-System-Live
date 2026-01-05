import { Router, Request, Response } from 'express';
import { getCatalog } from '../services/catalogService';

const router = Router();

function parseForceRefresh(req: Request): boolean {
  const refreshParam = req.query?.refresh;
  const refreshParamValue =
    typeof refreshParam === 'string'
      ? refreshParam
      : Array.isArray(refreshParam)
      ? refreshParam.find((v) => v === '1' || v === 'true')
      : undefined;
  const refreshHeaderRaw = req.headers['x-refresh-cache'];
  const refreshHeader = Array.isArray(refreshHeaderRaw)
    ? refreshHeaderRaw[0]
    : refreshHeaderRaw;

  return (
    refreshParamValue === '1' ||
    refreshParamValue === 'true' ||
    refreshHeader === '1' ||
    refreshHeader === 'true'
  );
}

router.get('/', async (req: Request, res: Response) => {
  const requestId = req.requestId;
  const forceRefresh = parseForceRefresh(req);
  const lang = typeof req.query?.lang === 'string' ? req.query.lang : undefined;

  try {
    const payload = await getCatalog({ forceRefresh, requestId, lang });
    res.setHeader('X-Request-Id', requestId ?? '');
    res.json(payload);
  } catch (err: any) {
    res.status(500).json({
      error: 'Erreur lors de la recuperation du catalogue',
      requestId
    });
  }
});

export default router;
