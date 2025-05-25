require('dotenv').config();

const express = require('express');
const morgan = require('morgan');
const httpProxy = require('http-proxy-middleware');

const app = express();
app.use(morgan('combined'));

app.use(express.json({
    verify: (req, res, buf, encoding) => {
        try {
            JSON.parse(buf.toString());
        } catch (e) {
            const errorPosition = e.message.match(/position (\d+)/)?.[1] || 'unknown';
            const invalidJson = buf.toString();

            console.error('Invalid JSON detected:', {
                url: req.url,
                method: req.method,
                error: e.message,
                position: errorPosition,
                rawBody: invalidJson,
                preview: invalidJson.slice(Math.max(0, errorPosition - 20), errorPosition + 20)
            });

            res.status(400).json({
                error: "Invalid JSON",
                details: {
                    message: e.message,
                    position: parseInt(errorPosition)
                }
            });
            throw e; // Остановить дальнейшую обработку
        }
    }
}));
app.use(express.json());

// Конфигурация
const config = {
    monolithUrl: process.env.MONOLITH_URL,
    moviesServiceUrl: process.env.MOVIES_SERVICE_URL,
    gradualMigration: process.env.GRADUAL_MIGRATION === 'true',
    migrationPercent: getMigrationPercent(process.env.MOVIES_MIGRATION_PERCENT)
};

// Валидация конфигурации
if (!config.monolithUrl || !config.moviesServiceUrl) {
    throw new Error('Missing required environment variables');
}

// Фабрика прокси
const createProxy = (target) => httpProxy.createProxyMiddleware({
    target,
    changeOrigin: true,
    pathRewrite: {'/?': '',},
    onError: (err, req, res) => {
        console.error(`Proxy error: ${err.message}`);
        res.status(502).json({ error: 'Bad Gateway' });
    },
    logger: console
});

// Роутинг
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
// const target =  config.moviesServiceUrl
//
// app.use(createProxy(target))

// Запуск сервера
const PORT = process.env.PORT || 8000;
app.listen(PORT, () => {
    console.log(`Proxy server running on port ${PORT}`);
    console.log('Current configuration:', config);
});

// Утилиты
function getMigrationPercent(value) {
    return isValidPercent(value) ? Number(value) : 0;
}

function isValidPercent(val) {
    const num = Number(val);
    return !isNaN(num) && num >= 0 && num <= 100;
}
