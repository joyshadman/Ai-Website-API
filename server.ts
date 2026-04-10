import express from 'express';
import cors from 'cors';
import 'dotenv/config'
 
const app = express();

const port = 3000;

const corsOptions = {
  origin: (process.env.TRUSTED_ORIGINS || '').split(',') || [''],
  credentials: true
};

app.use(cors(corsOptions));

app.get('/', (req, res) => {
  res.send('Server is running!');
});

app.listen(port, () => {
  console.log(`Server is running on http://localhost:${port}`);
});