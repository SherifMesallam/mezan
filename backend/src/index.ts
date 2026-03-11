import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import { authRouter } from './routes/auth';
import { ingestRouter } from './routes/ingest';
import { transactionsRouter } from './routes/transactions';
import { categoriesRouter } from './routes/categories';
import { tagsRouter } from './routes/tags';
import { budgetsRouter } from './routes/budgets';
import { insightsRouter } from './routes/insights';
import { usersRouter } from './routes/users';
import { feedbackRouter } from './routes/feedback';
import { setupRouter } from './routes/setup';
import { importRouter } from './routes/import';

const app = express();
const port = process.env.PORT || 3000;

app.use(cors());
// Allow large payloads for setup wizard (paste many messages) and ingest
app.use(express.json({ limit: '50mb' }));

app.use('/v1/auth', authRouter);
app.use('/v1/ingest', ingestRouter);
app.use('/v1/transactions', transactionsRouter);
app.use('/v1/categories', categoriesRouter);
app.use('/v1/tags', tagsRouter);
app.use('/v1/budgets', budgetsRouter);
app.use('/v1/insights', insightsRouter);
app.use('/v1/users', usersRouter);
app.use('/v1/feedback', feedbackRouter);
app.use('/v1/setup', setupRouter);
app.use('/v1/import', importRouter);

app.get('/health', (_req, res) => res.json({ status: 'ok' }));

app.listen(port, () => {
  console.log(`Mezan API listening on port ${port}`);
});
