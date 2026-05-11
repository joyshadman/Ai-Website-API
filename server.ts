import express from 'express';
import cors from 'cors';
import 'dotenv/config'
import { auth } from './lib/auth.ts';
import { toNodeHandler } from 'better-auth/node';
import userRoutes from 'routes/userRoutes.js';


const app = express();
const port = 3000;
const corsOptions = {
  origin: (process.env.TRUSTED_ORIGINS || '').split(',') || [''],
  credentials: true
};

app.use(cors(corsOptions));
app.all('/api/auth/{*any}', toNodeHandler(auth));

app.use(express.json({ limit: '50mb' }));

app.get('/', (req, res) => {
  res.send('Server is running!');
});

app.use('/api/user', userRoutes);

app.listen(port, () => {
  console.log(`Server is running on http://localhost:${port}`);
});