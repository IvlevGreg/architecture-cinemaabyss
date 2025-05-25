require('dotenv').config();
const express = require('express');
const morgan = require('morgan');
const { Kafka, Partitioners } = require('kafkajs');

const app = express();
app.use(morgan('combined'));

app.use((req, res, next) => {
    console.log('Incoming request:', {
        method: req.method,
        url: req.url,
        body: req.body
    });
    next();
});
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

// Configuration
const KAFKA_BROKERS = process.env.KAFKA_BROKERS;
if (!KAFKA_BROKERS) throw new Error('KAFKA_BROKERS not defined!');
const PORT = process.env.PORT || 8082;

// Kafka client
const kafka = new Kafka({
    clientId: 'events-service',
    brokers: [KAFKA_BROKERS],
    producer: {
        createPartitioner: Partitioners.LegacyPartitioner
    }
});

// Producer instance
const producer = kafka.producer();

// Consumer factory
const createConsumer = (groupId, topic) => {
    const consumer = kafka.consumer({
        groupId: `${groupId}-${Date.now()}`,
        allowAutoTopicCreation: true
    });

    return {
        run: async () => {
            await consumer.connect();
            await consumer.subscribe({ topic, fromBeginning: true });
            await consumer.run({
                eachMessage: async ({ topic, partition, message }) => {
                    try {
                        const event = JSON.parse(message.value.toString());
                        console.log(`Processed ${topic} event:`, {
                            offset: message.offset,
                            partition,
                            value: event
                        });
                    } catch (err) {
                        console.error('Error processing message:', err);
                    }
                }
            });
        }
    };
};

// Unified event handler
const createEventHandler = (eventType, topic) => async (req, res) => {
    try {
        const event = {
            type: eventType,
            data: req.body,
            timestamp: new Date().toISOString()
        };

        await producer.send({
            topic,
            messages: [{ value: JSON.stringify(event) }]
        });

        res.status(201).json({ status: 'success' });
    } catch (error) {
        console.error(`Failed to produce ${eventType} event:`, error);
        res.status(500).json({ error: 'Failed to produce event' });
    }
};

// Routes
app.post('/api/events/movie', createEventHandler('MOVIE_EVENT', 'movie-events'));
app.post('/api/events/user', createEventHandler('USER_EVENT', 'user-events'));
app.post('/api/events/payment', createEventHandler('PAYMENT_EVENT', 'payment-events'));

// Health check
app.get('/api/events/health', (req, res) => {
    res.status(200).json({
        status: true, // Исправлено с 'true' на true
        kafka: {
            brokers: KAFKA_BROKERS,
            connected: true
        }
    });
});

// Startup
const start = async () => {
    try {
        // Initialize producer
        await producer.connect();

        // Initialize consumers
        const consumers = [
            createConsumer('movie-events-group', 'movie-events'),
            createConsumer('user-events-group', 'user-events'),
            createConsumer('payment-events-group', 'payment-events')
        ];

        for (const consumer of consumers) {
            await consumer.run();
        }

        // Start server
        app.listen(PORT, () => {
            console.log(`Events Service running on port ${PORT}`);
            console.log(`Connected to Kafka brokers: ${KAFKA_BROKERS}`);
        });
    } catch (error) {
        console.error('Bootstrap failed:', error);
        process.exit(1);
    }
};

start();
