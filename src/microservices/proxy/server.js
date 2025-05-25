require('dotenv').config();

const express = require('express');
const httpProxy = require('http-proxy-middleware');
const morgan = require('morgan');

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

const createProxy = (target) => httpProxy.createProxyMiddleware({
    target,
    changeOrigin: true,
    pathRewrite: {'/?': '',},
    onError: (err, req, res) => {
        console.error(`Proxy error: ${err.message}`);
        res.status(502).json({ error: 'Bad Gateway' });
    },
    logger: console,
    buffer: false, // Отключает буферизацию тела
    proxyReqOptDecorator: (proxyReqOpts, srcReq) => {
        // Сохраняем оригинальные заголовки
        proxyReqOpts.headers['Content-Type'] = srcReq.headers['content-type'];
        return proxyReqOpts;
    }
});

app.use('/health', (req, res) => res.status(200).json({ status: 'OK' }));

app.use('/api/*', (req, res) => {
    if (!config.gradualMigration) {
        return createProxy(config.monolithUrl + req.originalUrl)(req, res);
    }
    const shouldMigrate = Math.random() * 100 < config.migrationPercent;
    const target = (shouldMigrate ? config.moviesServiceUrl : config.monolithUrl ) + req.originalUrl;
    console.log(`Proxying to ${target}`);
    return createProxy(target)(req, res);
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
