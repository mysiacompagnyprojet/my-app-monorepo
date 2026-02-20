//backend/src/middleware/limitGate

const { checkAndIncrementLimit } = require('../services/importLimits')

function limitGate(kind) {
  return async (req, res, next) => {
    try {
      const userId = req.user?.userId;
      if (!userId) return res.status(401).json({ error: 'Unauthorized' });
      const gate = await checkAndIncrementLimit(userId, kind);
      if (!gate.allowed) {
        return res.status(402).json({ ok: false, error: 'limit_reached' });
      }
      next();
    } catch (e) {
      console.error('limitGate error:', e);
      return res.status(500).json({ ok: false, error: 'internal error' });
    }
  };
}

module.exports = { limitGate };