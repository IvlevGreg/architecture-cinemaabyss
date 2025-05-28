require('dotenv').config();
const express = require('express');
const morgan = require('morgan');
const proxy = require('express-http-proxy');

const app = express();

app.use(morgan('combined'));

const config = {
    monolithUrl: process.env.MONOLITH_URL,
    moviesServiceUrl: process.env.MOVIES_SERVICE_URL,
    gradualMigration: process.env.GRADUAL_MIGRATION === 'true',
    migrationPercent: getMigrationPercent(process.env.MOVIES_MIGRATION_PERCENT)
};

if (!config.monolithUrl || !config.moviesServiceUrl) {
    throw new Error('Missing required environment variables');
}

const createProxyMiddleware = (targetBaseUrl) =>
    proxy(targetBaseUrl, {
        proxyReqPathResolver: (req) => req.originalUrl,
        proxyErrorHandler: (err, res) => {
            console.error(`Proxy error: ${err.message}`);
            res.status(502).json({ error: 'Bad Gateway' });
        }
    });

const monolithProxy = createProxyMiddleware(config.monolithUrl);
const moviesServiceProxy = createProxyMiddleware(config.moviesServiceUrl);

app.get('/proxy/health', (req, res) => res.status(200).json({ status: 'OK' }));
app.get('/api/movies/health', moviesServiceProxy);

app.use('*', monolithProxy);


app.use('/api/movies', (req, res, next) => {
    if (!config.gradualMigration) {
        return monolithProxy(req, res, next);
    }

    const shouldMigrate = Math.random() * 100 < config.migrationPercent;
    const targetService = shouldMigrate
        ? config.moviesServiceUrl
        : config.monolithUrl;

    console.log(`Movies proxying to ${targetService}${req.originalUrl}`);

    if (shouldMigrate) {
        return moviesServiceProxy(req, res, next);
    } else {
        return monolithProxy(req, res, next);
    }
});

const PORT = process.env.PORT || 8000;
app.listen(PORT, () => {
    console.log(`Proxy server running on port ${PORT}`);
    console.log('Current configuration:', config);
});

function getMigrationPercent(value) {
    return isValidPercent(value) ? Number(value) : 0;
}

function isValidPercent(val) {
    const num = Number(val);
    return !isNaN(num) && num >= 0 && num <= 100;
}
