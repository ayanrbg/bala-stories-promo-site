import dotenv from 'dotenv';
dotenv.config();

import app from './app';
import { startFinalizeTimer } from './lib/contestStandings';

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
  // Конкурс заканчивается ночью, и итоги должны замереть сами — ждать, пока
  // кто-то откроет админку, нельзя.
  startFinalizeTimer();
});
