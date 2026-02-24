//backend/src/middleware/auth
const { verifyToken } = require('../lib/jwt');
const DEBUG_OCR = process.env.OCR_DEBUG === '1';
const dlog = (...args) => { if (DEBUG_OCR) console.log(...args); };

function authRequired(req, res, next) {
    if (process.env.DEV_BYPASS_AUTH === 'true') {
        req.user = {
            userId: process.env.DEV_USER_ID || 'dev-user',
            email: process.env.DEV_USER_EMAIL || 'shirley.valeton88@icloud.com',
        }
        dlog('[auth]'), {
            bypass: process.env.DEV_BYPASS_AUTH,
            user: req.user,
        }
        req.userId = req.user.userId
        return next()
    }
const header = req.headers['authorization'];
if (!header) {
return res.status(401).json({ error: 'Bearer token missing' });
}
const [type, token] = header.split(' ');
if (type !== 'Bearer' || !token) {
return res.status(401).json({ error: 'Invalid Authorization header' });
}
try {
const payload = verifyToken(token);
req.user = payload; // { userId, email, ... }
next();
} catch (e) {
return res.status(401).json({ error: 'Invalid or expired token' });
}
}

module.exports = { authRequired };