//backend/src/utils/constants
// LEVEL: UTIL
// import autorisés : AUCUN
// import interdits : AUCUN
// importé par tout le monde

const QTY_USED = '([0-9]+(?:[.,][0-9]+)?|[0-9]+\\s+[0-9]+\\/[0-9]+|[0-9]+\\/[0-9]+|½|⅓|⅔|¼|¾|⅛|⅜|⅝|⅞)';
const CUILL_RE = 'cuill(?:e|è)re(?:s)?';

module.exports = {
    QTY_USED,
    CUILL_RE
}    