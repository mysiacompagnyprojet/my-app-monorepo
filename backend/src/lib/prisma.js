const {PrismaClient} = require ('@prisma/client')

const globalForPrisma = globalThis

const prisma =
globalForPrisma.prisma ||
new PrismaClient({
log: ['error', 'warn'],
})

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = prisma;
module.exports = { prisma };