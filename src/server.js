require('dotenv').config();
const app = require('./app');
const config = require('./config');
const connectDB = require('./config/database');
const logger = require('./utils/logger');

let server;

const startServer = async () => {
  try {
    // Use in-memory MongoDB when no real URI is available (development)
    if (config.env !== 'production' && (!process.env.MONGODB_URI || process.env.MONGODB_URI.includes('localhost'))) {
      const { MongoMemoryServer } = require('mongodb-memory-server');
      const mongod = await MongoMemoryServer.create();
      const uri = mongod.getUri();
      process.env.MONGODB_URI = uri;
      logger.info(`[DEV] Using in-memory MongoDB at: ${uri}`);
    }

    await connectDB();
    
    server = app.listen(config.port, () => {
      logger.info(`
╔═══════════════════════════════════════════════════════════╗
║                                                           ║
║   💳 GFGPay API Server                                    ║
║                                                           ║
║   Environment: ${config.env.padEnd(40)}║
║   Port: ${String(config.port).padEnd(47)}║
║   URL: http://localhost:${config.port}${' '.repeat(31)}║
║                                                           ║
║   API Health: http://localhost:${config.port}/api/v1/health${' '.repeat(12)}║
║                                                           ║
╚═══════════════════════════════════════════════════════════╝
      `);
    });
  } catch (error) {
    logger.error('Failed to start server:', error);
    process.exit(1);
  }
};

process.on('unhandledRejection', (err) => {
  logger.error('UNHANDLED REJECTION! Shutting down...');
  logger.error(err);
  if (server) {
    server.close(() => process.exit(1));
  } else {
    process.exit(1);
  }
});

process.on('uncaughtException', (err) => {
  logger.error('UNCAUGHT EXCEPTION! Shutting down...');
  logger.error(err);
  process.exit(1);
});

process.on('SIGTERM', () => {
  logger.info('SIGTERM received. Shutting down gracefully');
  if (server) {
    server.close(() => logger.info('Process terminated'));
  }
});

startServer();
