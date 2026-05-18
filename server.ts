import express from 'express';
import cors from 'cors';
import 'dotenv/config'
import { auth } from './lib/auth.js';
import { toNodeHandler } from 'better-auth/node';
import userRoutes from './routes/userRoutes.js';
import projectRoutes from './routes/ProjectRoutes.js';


const app = express();
const port = 3000;
const trustedOrigins = (process.env.TRUSTED_ORIGINS || 'http://localhost:5173')
  .split(',')
  .map((origin) => origin.trim().replace(/^["']|["']$/g, ''))
  .filter(Boolean);

const corsOptions = {
  origin: trustedOrigins,
  credentials: true,
};

app.use(cors(corsOptions));
app.all('/api/auth/{*any}', toNodeHandler(auth));

app.use(express.json({ limit: '50mb' }));

app.get('/', (req, res) => {
  res.send('Server is running!');
});

app.use('/api/user', userRoutes);
app.use('/api/project', projectRoutes);

app.listen(port, () => {
  console.log(`Server is running on http://localhost:${port}`);
});