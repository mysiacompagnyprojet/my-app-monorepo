const { verifyToken } = require('../lib/jwt');

function authRequired(req, res, next) {
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